/**
 * 트랙 D — 판정이 「교체」인 행의 **본문만** HWP 원본으로 바꾼다.
 *
 *   npx tsx scripts/qa/apply-hwp-replacement.ts                                    드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-hwp-replacement.ts --backup-only 백업만 뜬다
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-hwp-replacement.ts --apply       실제 적용
 *   npx tsx scripts/qa/apply-hwp-replacement.ts --verify                            적용 후 검증
 *
 * ## 지키는 것
 *
 * 1. **드라이런이 기본.** `--apply` 와 `ALLOW_SHARED_IMPORT=1` 이 **둘 다** 있어야 쓴다.
 *    게이트는 PrismaClient 를 만들기 **전에** 본다(tracks/README §2).
 * 2. **백업이 먼저다.** `--apply` 는 백업 파일이 없으면 **한 행도 건드리지 않고 멈춘다.**
 *    백업은 `--backup-only` 로 따로 뜬다 — 적용 전에 사람이 경로와 행 수를 확인할 수 있어야
 *    하기 때문이다(코디네이터 조건, 2026-08-16).
 * 3. **백업은 내가 쓰는 컬럼만이 아니라 남의 컬럼도 담는다.** `answer`(트랙 B) ·
 *    `figureUrls`(A) · `externalId`(C) · `unitId` 를 같이 떠 둬야 **"안 바뀌었다" 를
 *    증명**할 수 있다. 이전 값이 없으면 사후에 대조할 방법이 없다.
 * 4. **내 컬럼만 쓴다** — `content`, (옵션) `problemType`. 나머지는 손대지 않는다.
 * 5. **판정에 쓴 스냅샷이 낡았으면 그 행은 건너뛴다.** 공유 DB 는 트랙이 넷이 쓴다.
 * 6. **렌더가 나빠지면 쓰지 않는다.** 교체 대상 전체의 KaTeX 실패율을 교체 전/후로
 *    재서, 후가 전보다 나쁘면 중단한다.
 *
 * `problemType` 은 `--fix-type` 을 줄 때만 바꾼다. HWP 의 `type` 은 형식 라벨
 * (객관식·서술형·단답형)이고 우리 `problemType` 은 내용 분류(계산·개념·활용·서술형)라
 * 1:1 이 아니다. **보기가 4개 이상인데 DB 가 `서술형`** 인, 라벨이 확실히 틀린 것만
 * `mapProblemType` 으로 다시 매긴다 — `convertPastExam` 이 HWP 에서 적재했을 때와 같은 값이다.
 * ⚠️ 본문 교체와 같은 실행에 섞지 마라 — 어느 쪽이 무엇을 바꿨는지 못 가른다.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { mapProblemType } from "../../src/lib/import/mapProblemType";
import { renderKatexSafe } from "../../src/lib/math/katexRender";
import { tokenizeMath } from "../../src/lib/math/segments";
import { buildHwpContent, type HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const BACKUP = "scripts/qa/reports/hwp-replace-backup.json";
const PLAN = "scripts/qa/reports/hwp-replace-plan.json";

/** 백업·검증에 쓰는 컬럼. **내가 안 쓰는 컬럼까지 담는 게 요점이다.** */
const ROW_SELECT = {
  id: true,
  content: true,
  problemType: true,
  answer: true,
  solution: true,
  figureUrls: true,
  figureSource: true,
  externalId: true,
  unitId: true,
  score: true,
  difficulty: true,
  reviewStatus: true,
} as const;

type BackupRow = {
  id: string;
  content: string;
  problemType: string;
  answer: string;
  solution: string | null;
  figureUrls: string[];
  figureSource: string | null;
  externalId: string | null;
  unitId: string;
  score: number | null;
  difficulty: string;
  reviewStatus: string;
};

function mathFail(text: string): { fail: number; total: number } {
  let fail = 0;
  let total = 0;
  for (const seg of tokenizeMath(text ?? "")) {
    if (seg.type === "text") continue;
    total += 1;
    if (renderKatexSafe(seg.value, seg.type === "display").includes("math-raw")) {
      fail += 1;
    }
  }
  return { fail, total };
}

/** 게이트 — DB 에 붙기 전에 본다. */
async function gateOrExit(): Promise<boolean> {
  const { allowSharedImport } = await import(
    "../../src/lib/import/classifyDatabaseUrl"
  );
  const { inspectDatabaseTargets } = await import("../import/resolveDbTarget");
  const target = (await inspectDatabaseTargets()).selected;
  if (!target.canMigrateOrLoad && !allowSharedImport(target)) {
    console.log(
      `차단 — ${target.reason}\n` +
        "ALLOW_SHARED_IMPORT=1 을 명시하세요. DB 에 접속하지 않고 끝냅니다.",
    );
    return false;
  }
  console.log(`대상 DB — ${target.kind} (${target.host})`);
  return true;
}

interface PlanRow {
  id: string;
  externalId: string | null;
  examId: string;
  n: number;
  content: string;
  problemType?: string;
  beforeType: string;
  S: string[];
}

/** 판정 결과 + HWP 산출물로 교체 계획을 세운다. 전부 로컬 파일이다. */
async function buildPlan(fixType: boolean): Promise<{
  plan: PlanRow[];
  snapshot: Map<string, { content: string; problemType: string }>;
  missingHwp: number;
  before: { fail: number; total: number };
  after: { fail: number; total: number };
}> {
  const verdicts = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id && v.verdict === "교체");

  const wanted = new Map<string, (typeof verdicts)[number]>();
  for (const v of verdicts) wanted.set(v.id, v);

  const snapshot = new Map<string, { content: string; problemType: string }>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (wanted.has(r.id)) {
      snapshot.set(r.id, { content: r.content, problemType: r.problemType });
    }
  }

  const hwpCache = new Map<string, HwpQ[]>();
  const plan: PlanRow[] = [];
  let missingHwp = 0;
  const before = { fail: 0, total: 0 };
  const after = { fail: 0, total: 0 };

  for (const v of wanted.values()) {
    if (!hwpCache.has(v.examId)) {
      hwpCache.set(
        v.examId,
        JSON.parse(await readFile(`${HWP_DIR}/${v.examId}.json`, "utf-8")).questions ?? [],
      );
    }
    const q = hwpCache.get(v.examId)!.find((x) => x.number === v.hwpNumber);
    const snap = snapshot.get(v.id);
    if (!q || !snap) {
      missingHwp += 1;
      continue;
    }
    const content = buildHwpContent(q);
    if (!content.trim()) {
      missingHwp += 1;
      continue;
    }
    const b = mathFail(snap.content);
    const a = mathFail(content);
    before.fail += b.fail;
    before.total += b.total;
    after.fail += a.fail;
    after.total += a.total;

    const entry: PlanRow = {
      id: v.id,
      externalId: v.externalId,
      examId: v.examId,
      n: v.n,
      content,
      beforeType: snap.problemType,
      S: v.S,
    };
    if (fixType && snap.problemType === "서술형" && (q.choices?.length ?? 0) >= 4) {
      entry.problemType = mapProblemType(q.type ?? undefined);
    }
    plan.push(entry);
  }
  return { plan, snapshot, missingHwp, before, after };
}

async function fetchRows(
  prisma: { problem: { findMany: (a: unknown) => Promise<BackupRow[]> } },
  ids: string[],
): Promise<Map<string, BackupRow>> {
  const out = new Map<string, BackupRow>();
  for (let i = 0; i < ids.length; i += 500) {
    const rows = await prisma.problem.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: ROW_SELECT,
    });
    for (const r of rows) out.set(r.id, r);
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const backupOnly = process.argv.includes("--backup-only");
  const verify = process.argv.includes("--verify");
  const fixType = process.argv.includes("--fix-type");

  // ── 검증 모드: 백업과 현재 DB 를 대조한다 ────────────────────────────
  if (verify) {
    if (!existsSync(BACKUP)) {
      console.log(`백업 파일이 없습니다: ${BACKUP}`);
      return;
    }
    const backup = JSON.parse(await readFile(BACKUP, "utf-8")) as {
      takenAt: string;
      rows: BackupRow[];
    };
    const { plan } = await buildPlan(false);
    const intended = new Map(plan.map((p) => [p.id, p.content]));

    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const now = await fetchRows(prisma as never, backup.rows.map((r) => r.id));
      const t = {
        백업행: backup.rows.length,
        현재조회: now.size,
        본문_의도대로바뀜: 0,
        본문_그대로: 0,
        본문_제3의값: 0,
        행없음: 0,
      };
      const otherChanged: Record<string, number> = {};
      const OTHER: Array<keyof BackupRow> = [
        "answer", "figureUrls", "figureSource", "externalId",
        "unitId", "score", "difficulty", "reviewStatus", "solution",
        "problemType",
      ];
      for (const b of backup.rows) {
        const cur = now.get(b.id);
        if (!cur) {
          t.행없음 += 1;
          continue;
        }
        const want = intended.get(b.id);
        if (want != null && cur.content === want) t.본문_의도대로바뀜 += 1;
        else if (cur.content === b.content) t.본문_그대로 += 1;
        else t.본문_제3의값 += 1;

        for (const k of OTHER) {
          const same =
            k === "figureUrls"
              ? JSON.stringify(cur[k]) === JSON.stringify(b[k])
              : cur[k] === b[k];
          if (!same) otherChanged[k] = (otherChanged[k] ?? 0) + 1;
        }
      }
      console.log("── 적용 후 검증 ──");
      console.log(`백업 시각 ${backup.takenAt}`);
      console.log(
        `백업 ${t.백업행}행 · 현재 조회 ${t.현재조회} · 행 없음 ${t.행없음}`,
      );
      console.log(
        `본문 — 의도대로 바뀜 ${t.본문_의도대로바뀜} · 그대로 ${t.본문_그대로}` +
          ` · 제3의 값 ${t.본문_제3의값}`,
      );
      const others = Object.entries(otherChanged);
      if (others.length === 0) {
        console.log(
          "의도 밖 컬럼 — answer · figureUrls · figureSource · externalId · unitId ·" +
            " score · difficulty · reviewStatus · solution · problemType: **전부 0건 변경**",
        );
      } else {
        console.log("⚠️ 의도 밖 컬럼 변경:", JSON.stringify(Object.fromEntries(others)));
      }
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  if ((apply || backupOnly) && !(await gateOrExit())) return;

  const { plan, snapshot, missingHwp, before, after } = await buildPlan(fixType);
  const pct = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(2) : "0.00");

  // ── 백업만 뜨고 끝낸다 ──────────────────────────────────────────────
  if (backupOnly) {
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const current = await fetchRows(prisma as never, plan.map((p) => p.id));
      await mkdir("scripts/qa/reports", { recursive: true });
      await writeFile(
        BACKUP,
        JSON.stringify({
          takenAt: new Date().toISOString(),
          note:
            "트랙 D 본문 교체 직전 상태. 되돌리려면 content/problemType 을 그대로 되쓴다. " +
            "answer·figureUrls·externalId·unitId 는 되돌리기용이 아니라 **안 바뀌었음을 증명**하려고 담았다.",
          rows: [...current.values()],
        }),
        "utf-8",
      );
      console.log(
        `백업 완료 — ${BACKUP} · ${current.size}행 (계획 ${plan.length}행)`,
      );
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  console.log("── D-2 본문 교체 계획 ──");
  console.log(`계획 ${plan.length}행 · HWP 대응 없음 ${missingHwp}`);
  console.log(
    `KaTeX 실패 — 교체 전 ${before.fail}/${before.total} (${pct(before.fail, before.total)}%) → ` +
      `교체 후 ${after.fail}/${after.total} (${pct(after.fail, after.total)}%)`,
  );
  const typeFix = plan.filter((p) => p.problemType).length;
  if (fixType) console.log(`problemType 정정 ${typeFix}행`);

  await mkdir("scripts/qa/reports", { recursive: true });
  await writeFile(
    PLAN,
    JSON.stringify(
      plan.map((p) => ({ ...p, content: undefined, contentLen: p.content.length })),
    ),
    "utf-8",
  );

  const worse =
    after.total > 0 && after.fail / after.total > before.fail / Math.max(1, before.total);
  if (worse) {
    console.log("\n중단 — 교체 후 KaTeX 실패율이 더 높습니다. 규칙을 먼저 고치세요.");
    return;
  }

  if (!apply) {
    console.log("\n드라이런 — 변경 없음. 적용하려면 ALLOW_SHARED_IMPORT=1 ... --apply");
    return;
  }

  // ── 적용 ──────────────────────────────────────────────────────────
  if (!existsSync(BACKUP)) {
    console.log(
      `\n중단 — 백업이 없습니다(${BACKUP}).\n` +
        "먼저 --backup-only 로 백업을 뜨고 경로·행 수를 확인한 뒤 적용하세요.",
    );
    return;
  }
  const backup = JSON.parse(await readFile(BACKUP, "utf-8")) as {
    takenAt: string;
    rows: BackupRow[];
  };
  const backedUp = new Set(backup.rows.map((r) => r.id));
  const uncovered = plan.filter((p) => !backedUp.has(p.id));
  if (uncovered.length > 0) {
    console.log(
      `\n중단 — 백업이 계획을 다 덮지 못합니다(백업 ${backedUp.size} · 계획 ${plan.length}` +
        ` · 미포함 ${uncovered.length}). --backup-only 를 다시 도세요.`,
    );
    return;
  }
  console.log(`백업 확인 — ${BACKUP} · ${backup.rows.length}행 · ${backup.takenAt}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const current = await fetchRows(prisma as never, plan.map((p) => p.id));
    let updated = 0;
    let skippedStale = 0;
    let skippedGone = 0;
    let alreadyDone = 0;
    for (const p of plan) {
      const now = current.get(p.id);
      if (!now) {
        skippedGone += 1;
        continue;
      }
      if (now.content === p.content) {
        alreadyDone += 1;
        continue;
      }
      // 판정에 쓴 본문과 지금 본문이 다르면 남의 트랙이 고친 것이다 — 덮지 않는다.
      if (now.content !== snapshot.get(p.id)!.content) {
        skippedStale += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: p.id },
        data: {
          content: p.content,
          ...(p.problemType ? { problemType: p.problemType } : {}),
        },
      });
      updated += 1;
      if (updated % 500 === 0) console.log(`  … ${updated} 적용`, { flush: true });
    }
    console.log(
      `적용 ${updated}행 · 이미 같은 값 ${alreadyDone}` +
        ` · 스냅샷 이후 남이 고침 ${skippedStale} · 행 없음 ${skippedGone}`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

void main();
