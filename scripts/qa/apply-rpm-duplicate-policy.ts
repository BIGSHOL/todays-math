/**
 * RPM 본문 동일 88그룹 — **완비도 기준 일괄 처리**.
 *
 * 원장님 지시(2026-08-16, 코디네이터 전달): 88그룹을 한 건씩 고르는 대신 기준으로
 * 일괄 처리한다. 기준은 **값 판단이 아니라 완비도**다 — 어느 쪽 본문이 더 나은지는
 * 보지 않는다.
 *
 * ## 점수 (0~5)
 *
 *   정답 있음 · 해설 있음 · 그림 있음 · 소단원 제대로 붙음 · `externalId` 있음
 *
 * 그룹마다 점수가 가장 높은 행 **하나**를 남기고, 동점이면 **먼저 적재된 행**
 * (`createdAt` 이 이른 쪽)을 남긴다. `createdAt` 까지 같으면 `id` 로 못박아
 * 재실행해도 같은 결과가 나오게 한다(결정성).
 *
 * ⚠️ **「소단원 있음」을 글자 그대로 재면 아무것도 못 가른다.** `Problem.unitId` 는
 * NOT NULL 이라 전 행이 항상 참이다. 그래서 이 축은 **배정된 소단원의 학년이 원본
 * 교재 학년과 맞는가**로 잰다(RPM 4,629행 중 1,364행이 어긋나 있다 — 13번 문서 §8).
 * 이것도 완비도이지 값 판단이 아니다.
 *
 * ## 남기지 않는 쪽
 *
 * **행을 지우지 않는다.** `reviewStatus` 를 `approved` → `pending` 으로 내린다.
 * D-22 대로 `pending` 은 출제 풀에 안 잡히고, 되돌리려면 다시 `approved` 로 올리면
 * 된다. 삭제는 되돌릴 수 없어 쓰지 않는다.
 *
 * 강등한 행 목록은 `scripts/qa/rpm-duplicate-demoted.json` 에 남긴다 — 그 목록만으로
 * 정확히 되돌릴 수 있다.
 *
 * ## 쓰는 컬럼
 *
 * **`reviewStatus` 하나뿐이다.** 같은 표의 `answer`(트랙 B)·`content`(트랙 D)는
 * 건드리지 않는다.
 *
 *   npx tsx scripts/qa/apply-rpm-duplicate-policy.ts            드라이런 + 보고
 *   npx tsx scripts/qa/apply-rpm-duplicate-policy.ts --json out.json
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-rpm-duplicate-policy.ts --apply
 */
import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeJson } from "../import/writeJson";
import { bookGrade } from "./report-rpm-duplicates";
import {
  keysOf,
  readSource,
  resolveSourceUrl,
  toSourceRow,
  type SourceRow,
} from "./recover-rpm-answers";

const SELECT = `
SELECT q.id::text AS id, q.printed_number, q.source_ref, qv.body, qv.choices, qv.answer
FROM questions q
JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

const SENTINEL = "정답 없음";
const DEMOTED_PATH = "scripts/qa/rpm-duplicate-demoted.json";

/** 점수 축. 순서가 곧 보고서의 열 순서다. */
export const AXES = [
  "answer",
  "solution",
  "figure",
  "unit",
  "externalId",
] as const;
export type Axis = (typeof AXES)[number];

export const AXIS_LABEL: Record<Axis, string> = {
  answer: "정답 있음",
  solution: "해설 있음",
  figure: "그림 있음",
  unit: "소단원 제대로 붙음",
  externalId: "externalId 있음",
};

export interface Candidate {
  problemId: string;
  createdAt: Date;
  printedNumber: string | null;
  has: Record<Axis, boolean>;
  score: number;
}

/** 동점을 무엇으로 가를지. 셋 다 값 판단이 아니다. */
export type TieBreak =
  /** 지시받은 기본값 — 먼저 적재된 행. */
  | "createdAt"
  /** 원본 교재의 인쇄 번호가 빠른 쪽 (교재 자신의 순서). */
  | "printedNumber";

export interface GroupDecision {
  members: Candidate[];
  keep: Candidate;
  demote: Candidate[];
  /** 점수로 갈렸으면 그 차이를 만든 축들. 점수가 같아 `createdAt` 으로 갔으면 빈 배열. */
  decidedBy: Axis[];
  /** `createdAt` 까지 가서 정해진 그룹인가. */
  byCreatedAt: boolean;
  /** 남기는 행이 **갖추지 못한 것을 강등되는 행이 갖고 있는** 축. 있으면 눈으로 봐야 한다. */
  losesOn: Axis[];
}

/**
 * 결정적으로 고른다 — 점수 → 동점 규칙 → `id`. 재실행해도 같은 답이 나와야 한다.
 *
 * ⚠️ `createdAt` 은 이 데이터에서 잘 안 가른다. 대량 `createMany` 로 한 번에 들어가
 * **같은 그룹의 행들이 같은 타임스탬프를 갖는 일이 흔하다.** 그러면 마지막 `id` 비교로
 * 떨어지는데, `id` 는 UUID 라 사실상 무작위다. 얼마나 그런지는 드라이런 보고가 센다.
 */
export function decideGroup(
  members: Candidate[],
  tieBreak: TieBreak = "createdAt",
): GroupDecision {
  const tie = (a: Candidate, b: Candidate): number => {
    if (tieBreak === "printedNumber") {
      if (a.printedNumber === b.printedNumber) return 0;
      if (a.printedNumber === null) return 1;
      if (b.printedNumber === null) return -1;
      return a.printedNumber.localeCompare(b.printedNumber);
    }
    return a.createdAt.getTime() - b.createdAt.getTime();
  };
  const sorted = [...members].sort(
    (a, b) => b.score - a.score || tie(a, b) || a.problemId.localeCompare(b.problemId),
  );
  const keep = sorted[0];
  const demote = sorted.slice(1);
  const runnerUp = sorted[1];
  const byCreatedAt = Boolean(runnerUp) && runnerUp.score === keep.score;
  const decidedBy = runnerUp
    ? AXES.filter((axis) => keep.has[axis] && !runnerUp.has[axis])
    : [];
  const losesOn = AXES.filter(
    (axis) => !keep.has[axis] && demote.some((row) => row.has[axis]),
  );
  return {
    members,
    keep,
    demote,
    decidedBy: byCreatedAt ? [] : decidedBy,
    byCreatedAt,
    losesOn,
  };
}

function jsonArg(): string | null {
  const index = process.argv.indexOf("--json");
  if (index < 0) return null;
  return process.argv[index + 1] ?? "scripts/qa/reports/rpm-duplicate-policy.json";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  // 게이트를 네트워크·DB 접근 앞에 둔다.
  if (apply) {
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const sourceUrl = await resolveSourceUrl();
  if (!sourceUrl) {
    console.log("원본 접속 정보가 없습니다 — SUMAEK_DATABASE_URL / SUMAEK_ENV_PATH.");
    process.exitCode = 2;
    return;
  }
  const rawRows = await readSource(sourceUrl, SELECT);
  const sources = rawRows
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);
  const bookById = new Map<string, string>();
  const printedById = new Map<string, string>();
  for (const row of rawRows) {
    const ref = (row.source_ref ?? {}) as Record<string, unknown>;
    bookById.set(String(row.id), typeof ref.book === "string" ? ref.book : "");
    printedById.set(
      String(row.id),
      typeof ref.printedNumber === "string" ? ref.printedNumber : "",
    );
  }

  const byKey = new Map<string, Set<SourceRow>>();
  for (const row of sources) {
    for (const key of new Set([
      ...keysOf(row.content),
      ...keysOf(row.restoredContent),
    ])) {
      if (!key) continue;
      const bucket = byKey.get(key) ?? new Set<SourceRow>();
      bucket.add(row);
      byKey.set(key, bucket);
    }
  }
  const candidatesFor = (content: string): SourceRow[] => {
    const found = new Set<SourceRow>();
    for (const key of keysOf(content)) {
      for (const row of byKey.get(key) ?? []) found.add(row);
    }
    return [...found];
  };

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: {
        id: true,
        content: true,
        answer: true,
        solution: true,
        figureUrls: true,
        externalId: true,
        reviewStatus: true,
        createdAt: true,
        unit: { select: { grade: true } },
      },
    });

    const buckets = new Map<string, typeof problems>();
    for (const problem of problems) {
      const candidates = candidatesFor(problem.content);
      if (candidates.length < 2) continue;
      const key = candidates
        .map((row) => row.id)
        .sort()
        .join("|");
      const bucket = buckets.get(key) ?? [];
      bucket.push(problem);
      buckets.set(key, bucket);
    }

    const decisions: GroupDecision[] = [];
    for (const [key, members] of buckets) {
      const expected = bookGrade(bookById.get(key.split("|")[0]) ?? "");
      decisions.push(
        decideGroup(
          members.map((member) => {
            const has: Record<Axis, boolean> = {
              answer:
                Boolean(member.answer.trim()) && !member.answer.includes(SENTINEL),
              solution: Boolean((member.solution ?? "").trim()),
              figure: member.figureUrls.length > 0,
              unit: expected ? member.unit.grade === expected : false,
              externalId: Boolean(member.externalId),
            };
            return {
              problemId: member.id,
              createdAt: member.createdAt,
              printedNumber: member.externalId
                ? (printedById.get(member.externalId) ?? null)
                : null,
              has,
              score: AXES.filter((axis) => has[axis]).length,
            };
          }),
        ),
      );
    }

    const demote = decisions.flatMap((d) => d.demote.map((c) => c.problemId));
    const keep = decisions.map((d) => d.keep.problemId);

    // ── 보고 ────────────────────────────────────────────────────────────────
    console.log("── RPM 중복 88그룹 완비도 기준 (드라이런) ──");
    console.log(
      `그룹 ${decisions.length} · 대상 행 ${keep.length + demote.length}` +
        ` — 남김 ${keep.length} · 강등 ${demote.length}`,
    );

    console.log("\n[축별 보유 현황 — 대상 행 전체]");
    const all = decisions.flatMap((d) => d.members);
    for (const axis of AXES) {
      const n = all.filter((c) => c.has[axis]).length;
      console.log(
        `  ${AXIS_LABEL[axis]} — ${n}/${all.length}` +
          (n === all.length || n === 0 ? "  ← 전 행이 같아 이 축은 아무것도 못 가른다" : ""),
      );
    }

    console.log("\n[무엇이 그룹을 갈랐나]");
    const byAxis = new Map<string, number>();
    for (const decision of decisions) {
      const label = decision.byCreatedAt
        ? "createdAt (점수 동점)"
        : decision.decidedBy.length === 0
          ? "(단독 행)"
          : decision.decidedBy.map((axis) => AXIS_LABEL[axis]).join(" + ");
      byAxis.set(label, (byAxis.get(label) ?? 0) + 1);
    }
    for (const [label, count] of [...byAxis.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${label} — ${count}그룹`);
    }

    const tied = decisions.filter((d) => d.byCreatedAt);
    console.log(
      `\n동점으로 createdAt 까지 간 그룹 ${tied.length}/${decisions.length}` +
        ` (강등 ${tied.reduce((sum, d) => sum + d.demote.length, 0)}행)`,
    );

    const odd = decisions.filter((d) => d.losesOn.length > 0);
    console.log(
      `\n[눈으로 봐야 하는 그룹] 남기는 행이 갖추지 못한 것을 강등되는 행이 가진 그룹 ${odd.length}`,
    );
    for (const decision of odd.slice(0, 20)) {
      console.log(
        `  #${decision.keep.printedNumber ?? "미상"} 남김(${decision.keep.score}/5)` +
          ` — 없는 것: ${decision.losesOn.map((a) => AXIS_LABEL[a]).join(", ")}` +
          ` · 강등 ${decision.demote
            .map((c) => `#${c.printedNumber ?? "미상"}(${c.score}/5)`)
            .join(" ")}`,
      );
    }
    if (odd.length > 20) console.log(`  … 그 밖 ${odd.length - 20}그룹`);

    // ── 동점 규칙이 실제로 가르는가 ────────────────────────────────────────
    const tiedGroups = decisions.filter((d) => d.byCreatedAt);
    let sameStamp = 0;
    let sameStampRows = 0;
    for (const decision of tiedGroups) {
      const top = decision.members.filter((m) => m.score === decision.keep.score);
      const stamps = new Set(top.map((m) => m.createdAt.getTime()));
      if (stamps.size === 1) {
        sameStamp += 1;
        sameStampRows += top.length - 1;
      }
    }
    console.log(
      `
[동점 규칙이 정말 가르는가]
` +
        `  동점 그룹 ${tiedGroups.length} 중 **동점 행들의 createdAt 이 완전히 같은** 그룹 ${sameStamp}` +
        ` (그 그룹의 강등 ${sameStampRows}행)
` +
        "  → 그 그룹들은 createdAt 이 아니라 마지막 `id`(UUID) 비교로 떨어진다. **사실상 무작위다.**",
    );

    const identical = decisions.filter(
      (d) =>
        d.members.length > 1 &&
        new Set(d.members.map((m) => AXES.map((a) => Number(m.has[a])).join(""))).size === 1,
    );
    const perfectDemoted = decisions.flatMap((d) => d.demote).filter((c) => c.score === AXES.length);
    console.log(
      `  다섯 축 보유 패턴이 그룹 안에서 **완전히 같은** 그룹 ${identical.length}` +
        ` — 이 기준으로는 원리상 못 가른다
` +
        `  강등 대상 중 ${AXES.length}/${AXES.length} 만점 행 ${perfectDemoted.length}`,
    );

    // ── 변형: 기준이 실제로 가르는 그룹만 적용하면 ───────────────────────────
    const discriminating = decisions.filter((d) => !d.byCreatedAt);
    console.log(
      `
[변형] 점수로 실제 갈리는 그룹만 적용하면 — ${discriminating.length}그룹 ·` +
        ` 강등 ${discriminating.reduce((sum, d) => sum + d.demote.length, 0)}행` +
        ` (나머지 ${tiedGroups.length}그룹 ${tiedGroups.reduce((sum, d) => sum + d.demote.length, 0)}행은 보류)`,
    );

    const jsonPath = jsonArg();
    if (jsonPath) {
      await writeJson(jsonPath, {
        generatedFrom: "scripts/qa/apply-rpm-duplicate-policy.ts",
        groups: decisions.map((d) => ({
          keep: d.keep,
          demote: d.demote,
          decidedBy: d.decidedBy,
          byCreatedAt: d.byCreatedAt,
          losesOn: d.losesOn,
        })),
      });
      console.log(`\n상세 기록 — ${jsonPath}`);
    }

    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 승인 후 ALLOW_SHARED_IMPORT=1 ... --apply (강등 대상 ${demote.length})`,
      );
      return;
    }

    // ── 적용 ────────────────────────────────────────────────────────────────
    // 되돌릴 수 있게 **강등 직전 상태**를 먼저 적어 둔다.
    const before = await prisma.problem.findMany({
      where: { id: { in: demote } },
      select: { id: true, reviewStatus: true, externalId: true },
    });
    await writeJson(DEMOTED_PATH, {
      note:
        "RPM 중복 88그룹 완비도 기준으로 approved → pending 으로 내린 행. " +
        "되돌리려면 이 목록의 id 에 reviewStatus 를 previous 값으로 되돌리면 된다. " +
        "reviewStatus 외의 컬럼은 건드리지 않았다.",
      appliedBy: "scripts/qa/apply-rpm-duplicate-policy.ts",
      count: before.length,
      rows: before.map((row) => ({
        problemId: row.id,
        externalId: row.externalId,
        previous: row.reviewStatus,
        next: "pending",
      })),
    });

    const result = await prisma.problem.updateMany({
      where: { id: { in: demote }, reviewStatus: "approved" },
      data: { reviewStatus: "pending" },
    });
    console.log(`\n강등 완료 — ${result.count}행 (approved → pending)`);
    console.log(`되돌리기 목록 — ${DEMOTED_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
