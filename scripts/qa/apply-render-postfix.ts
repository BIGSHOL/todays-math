/**
 * 본문 후보정 **적용기** — 계획 → 검토 → 적용 → 되돌리기.
 *
 * 공유 Supabase 다. 그래서 `apply-answer-corrections.ts` 의 규율을 그대로 따른다.
 *
 *   1. **드라이런이 기본.** 계획 파일과 표본만 만든다. 아무것도 안 바꾼다.
 *   2. **현재 값이 `before` 와 정확히 같을 때만 바꾼다.** 그 사이 누가 고쳤으면
 *      건드리지 않고 보고만 한다(SQL 의 `WHERE p.content = v.before` 가 보증한다).
 *   3. **적용 로그를 남긴다.** `--revert` 가 그 로그만 보고 되돌린다.
 *      로그 없이는 적용하지 않는다.
 *
 * 규칙 자체는 `renderPostfixRules.ts` 에 있고 단위 테스트가 지킨다. 이 파일은
 * 규칙을 DB 에 옮기는 배관일 뿐이다.
 *
 *   npx tsx scripts/qa/apply-render-postfix.ts --kind label
 *   npx tsx scripts/qa/apply-render-postfix.ts --kind label --samples 40
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-render-postfix.ts --kind label --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-render-postfix.ts --kind label --revert
 *
 * `--kind` : label(유형 라벨) | residue(HWP 잔재) | dollar($ 홀수)
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import {
  fixHwpResidue,
  fixStrayDollar,
  stripQuestionLabel,
  wholesaleMarkers,
} from "./renderPostfixRules";

const KINDS = ["label", "residue", "dollar"] as const;
type Kind = (typeof KINDS)[number];

const REPORT_DIR = "scripts/qa/reports";
const planPath = (kind: Kind) => `${REPORT_DIR}/render-postfix-${kind}.json`;
const logPath = (kind: Kind) =>
  `${REPORT_DIR}/render-postfix-${kind}-applied.json`;

interface PlanItem {
  id: string;
  before: string;
  after: string;
  /** 어떤 규칙이 걸렸는지 — 표본을 눈으로 볼 때 이게 있어야 판단이 된다. */
  why: string;
  /** 참고용 메타. 라벨이면 뗀 유형, 그 유형과 questionType 이 어긋나는지. */
  meta?: Record<string, string | null | boolean>;
}

interface HoldItem {
  id: string;
  reason: string;
  excerpt: string;
}

interface Plan {
  kind: Kind;
  scanned: number;
  items: PlanItem[];
  holds: HoldItem[];
}

/** 라벨이 말하는 유형과 `questionType` 컬럼이 **양립하는가**. */
function typeAgrees(kind: string, questionType: string | null): boolean {
  if (!questionType) return false;
  // `서답형` 은 학교에 따라 단답형·서술형을 함께 가리키는 상위어다.
  if (kind === "서답형")
    return questionType === "서술형" || questionType === "단답형";
  if (kind === "주관식")
    return questionType === "서술형" || questionType === "단답형";
  if (kind === "선택형") return questionType === "객관식";
  return questionType === kind;
}

async function buildPlan(prisma: PrismaClient, kind: Kind): Promise<Plan> {
  const total = await prisma.problem.count();
  const items: PlanItem[] = [];
  const holds: HoldItem[] = [];
  let scanned = 0;

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true, questionType: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;

    for (const row of rows) {
      scanned += 1;
      const before = row.content ?? "";

      if (kind === "label") {
        const r = stripQuestionLabel(before);
        if (r.kind) {
          items.push({
            id: row.id,
            before,
            after: r.content,
            why: `라벨 「${r.kind}」 제거`,
            meta: {
              kind: r.kind,
              questionType: row.questionType,
              // 라벨과 컬럼이 어긋나는 행 — 지면 라벨은 컬럼을 따라간다.
              // 값은 안 바꾸고 세기만 한다(다른 트랙 소유 컬럼).
              typeAgrees: typeAgrees(r.kind, row.questionType),
            },
          });
        } else if (r.hold) {
          holds.push({
            id: row.id,
            reason: r.hold,
            excerpt: before.slice(0, 200),
          });
        }
        continue;
      }

      if (kind === "residue") {
        const r = fixHwpResidue(before);
        if (r.applied.length > 0) {
          // 고친 뒤에도 잔재가 남는 행이 있다(`4DIVIDEunder…` → `4\div under…`).
          // 개선이긴 하나 **다 고친 게 아니다** — 조용히 «완료»로 세지 않는다.
          const left = residualKeywords(r.content);
          items.push({
            id: row.id,
            before,
            after: r.content,
            why:
              r.applied.join(",") +
              (left.length ? ` (잔재남음:${left.join("/")})` : ""),
          });
        } else if (r.hold === "wholesale" && hasResidueKeyword(before)) {
          holds.push({
            id: row.id,
            reason: `wholesale:${wholesaleMarkers(before).join("+")}`,
            excerpt: before.slice(0, 200),
          });
        } else if (hasResidueKeyword(before)) {
          holds.push({
            id: row.id,
            reason: "규칙 없음",
            excerpt: before.slice(0, 200),
          });
        }
        continue;
      }

      // dollar
      if ((before.match(/\$/g) ?? []).length % 2 === 0) continue;
      const r = fixStrayDollar(before);
      if (r.applied)
        items.push({ id: row.id, before, after: r.content, why: r.applied });
      else
        holds.push({
          id: row.id,
          reason: "unresolved",
          excerpt: before.slice(0, 200),
        });
    }
  }
  return { kind, scanned, items, holds };
}

/** 잔재 키워드가 실제로 있는 행만 보류 목록에 넣기 위한 값싼 판정. */
const RESIDUE_PROBE =
  /(?<!\\)(?:DIVIDE|divide|TIMES|CDOT|TRIANGLE|ANGLE|SQRT|ROOT|RIGHT|LEFT|OVER)|(?<![A-Za-z\\])(?:over|atop|pile|sqrt|root|bar|hat|vec)(?![A-Za-z])/;
function hasResidueKeyword(text: string): boolean {
  for (const m of text.matchAll(/\$([^$]+)\$/g)) {
    if (RESIDUE_PROBE.test(m[1])) return true;
  }
  return false;
}

/** 고친 **뒤에도** 수식 안에 남아 있는 HWP 키워드. 반쪽짜리 수리를 드러낸다. */
const RESIDUAL_PROBE =
  /(?<!\\)(?:DIVIDE|divide|TIMES|CDOTS?|TRIANGLE|ANGLE|SQRT|ROOT|RIGHT|LEFT|OVER|UNDER)|(?<![A-Za-z\\])(?:over|under|atop|pile|sqrt|root|bar|hat|vec)(?![A-Za-z])/g;
function residualKeywords(text: string): string[] {
  const found = new Set<string>();
  for (const m of text.matchAll(/\$([^$]+)\$/g)) {
    for (const hit of m[1].matchAll(RESIDUAL_PROBE)) found.add(hit[0]);
  }
  return [...found];
}

/** 현재 값이 `before` 와 같을 때만 바꾼다 — 그 판정을 SQL 안에 둔다. */
async function applyChunk(
  prisma: PrismaClient,
  chunk: Array<{ id: string; before: string; after: string }>,
): Promise<number> {
  const values = chunk
    .map(
      (_, i) =>
        `($${i * 3 + 1}::uuid, $${i * 3 + 2}::text, $${i * 3 + 3}::text)`,
    )
    .join(",");
  const params = chunk.flatMap((c) => [c.id, c.before, c.after]);
  const sql = `UPDATE problem AS p
     SET content = v.after, updated_at = now()
     FROM (VALUES ${values}) AS v(id, before, after)
     WHERE p.id = v.id AND p.content = v.before`;
  return prisma.$executeRawUnsafe(sql, ...params);
}

function preview(text: string, len = 150): string {
  return text.slice(0, len).replace(/\n/g, "⏎");
}

async function main(): Promise<void> {
  const argv = process.argv;
  const kindArg = argv[argv.indexOf("--kind") + 1] as Kind;
  if (!KINDS.includes(kindArg)) {
    console.error(`--kind 는 ${KINDS.join(" | ")} 중 하나여야 합니다.`);
    process.exitCode = 1;
    return;
  }
  const apply = argv.includes("--apply");
  const revert = argv.includes("--revert");
  const sampleAt = argv.indexOf("--samples");
  const sampleCount = sampleAt >= 0 ? Number(argv[sampleAt + 1] ?? 20) : 12;

  const prisma = new PrismaClient();
  try {
    if (revert) {
      const logAt = argv.indexOf("--log");
      await runRevert(
        prisma,
        kindArg,
        logAt >= 0 ? argv[logAt + 1] : undefined,
      );
      return;
    }

    const plan = await buildPlan(prisma, kindArg);
    await mkdir(REPORT_DIR, { recursive: true });
    await writeFile(planPath(kindArg), JSON.stringify(plan, null, 2), "utf-8");

    console.log(`── 후보정 계획 [${kindArg}] ──`);
    console.log(
      `전수 ${plan.scanned.toLocaleString()} · 바꿀 행 ${plan.items.length} · 보류 ${plan.holds.length}`,
    );
    const whyCount = new Map<string, number>();
    for (const it of plan.items)
      whyCount.set(it.why, (whyCount.get(it.why) ?? 0) + 1);
    for (const [w, c] of [...whyCount].sort((a, b) => b[1] - a[1]))
      console.log(`   ${w.padEnd(24)} ${c}`);
    const holdCount = new Map<string, number>();
    for (const h of plan.holds)
      holdCount.set(h.reason, (holdCount.get(h.reason) ?? 0) + 1);
    if (holdCount.size > 0) {
      console.log("  보류 사유");
      for (const [r, c] of [...holdCount].sort((a, b) => b[1] - a[1]))
        console.log(`   ${r.padEnd(24)} ${c}`);
    }
    if (kindArg === "label") {
      const disagree = plan.items.filter((i) => i.meta?.typeAgrees === false);
      console.log(
        `  ⚠ 라벨과 questionType 이 어긋나는 행 ${disagree.length} — 컬럼은 건드리지 않는다(다른 트랙 소유).`,
      );
    }

    // 표본은 **골고루** 뽑는다. 앞에서 20개만 보면 한 학교만 본 셈이 된다.
    console.log(
      `\n── 전/후 표본 ${Math.min(sampleCount, plan.items.length)}건 ──`,
    );
    const step = Math.max(1, Math.floor(plan.items.length / sampleCount));
    for (
      let i = 0;
      i < plan.items.length && i / step < sampleCount;
      i += step
    ) {
      const it = plan.items[i];
      console.log(`\n·${it.id.slice(0, 8)}  [${it.why}]`);
      console.log(`  전: ${preview(it.before)}`);
      console.log(`  후: ${preview(it.after)}`);
    }
    console.log(`\n계획 파일: ${planPath(kindArg)}`);

    if (!apply) {
      console.log(
        "드라이런 — 변경 없음. 적용하려면 ALLOW_SHARED_IMPORT=1 … --apply",
      );
      return;
    }

    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }

    // 되돌리기 로그를 **먼저** 쓴다. 로그 없이 DB 를 건드리지 않는다.
    await writeFile(
      logPath(kindArg),
      JSON.stringify(
        {
          kind: kindArg,
          items: plan.items.map(({ id, before, after }) => ({
            id,
            before,
            after,
          })),
        },
        null,
        2,
      ),
      "utf-8",
    );
    console.log(`되돌리기 로그: ${logPath(kindArg)}`);

    let changed = 0;
    const CHUNK = 400;
    for (let i = 0; i < plan.items.length; i += CHUNK) {
      changed += await applyChunk(prisma, plan.items.slice(i, i + CHUNK));
      process.stdout.write(
        `\r  적용 ${Math.min(i + CHUNK, plan.items.length)}/${plan.items.length}`,
      );
    }
    console.log(
      `\n적용 완료 — 실제 갱신 ${changed} / 계획 ${plan.items.length}` +
        (changed === plan.items.length
          ? ""
          : `  (현재 값이 달라 건너뛴 행 ${plan.items.length - changed})`),
    );
  } finally {
    await prisma.$disconnect();
  }
}

/**
 * `--log` 로 다른 경로를 줄 수 있다. `scripts/qa/reports/` 는 gitignore 라
 * 워크트리를 지우면 사라지므로, **적용한 로그는 추적되는 경로에 복사해 둔다**
 * (`docs/planning/tracks/reports/render-c-revert-*.json`). 그 복사본으로도
 * 되돌릴 수 있어야 되돌리기 경로가 진짜로 있는 것이다.
 */
async function runRevert(
  prisma: PrismaClient,
  kind: Kind,
  logFile?: string,
): Promise<void> {
  const log = JSON.parse(await readFile(logFile ?? logPath(kind), "utf-8")) as {
    items: Array<{ id: string; before: string; after: string }>;
  };
  const inspection = await inspectDatabaseTargets();
  if (
    !inspection.selected.canMigrateOrLoad &&
    !allowSharedImport(inspection.selected)
  ) {
    console.log(`차단 — ${inspection.selected.reason}`);
    return;
  }
  // 되돌리기도 같은 규율 — 지금 값이 `after` 일 때만 `before` 로 돌린다.
  const flipped = log.items.map((i) => ({
    id: i.id,
    before: i.after,
    after: i.before,
  }));
  let changed = 0;
  const CHUNK = 400;
  for (let i = 0; i < flipped.length; i += CHUNK) {
    changed += await applyChunk(prisma, flipped.slice(i, i + CHUNK));
  }
  console.log(`되돌림 ${changed} / ${flipped.length}`);
}

void main();
