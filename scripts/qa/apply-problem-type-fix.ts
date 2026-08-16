/**
 * 트랙 D — `problemType` 이 **형식과 명백히 어긋난 행**만 바로잡는다.
 *
 *   npx tsx scripts/qa/apply-problem-type-fix.ts                                     드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-problem-type-fix.ts --backup-only  백업
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-problem-type-fix.ts --apply        적용
 *   npx tsx scripts/qa/apply-problem-type-fix.ts --verify                             검증
 *
 * 대상: **보기가 4개 이상(=객관식)인데 DB 가 `서술형`** 인 행. 5지선다를 서술형으로
 * 실어 둔 것이라 사실이 틀렸다. 바꿀 값은 `mapProblemType('객관식')` = `개념` 으로,
 * `convertPastExam` 이 HWP 에서 적재했을 때 나왔을 값과 같다.
 *
 * ⚠️ **본문 교체와 같은 실행으로 돌리지 않는다**(코디네이터 조건 2026-08-16).
 * 섞으면 어느 쪽이 무엇을 바꿨는지 못 가른다. 그래서 `apply-hwp-replacement.ts` 와
 * 별개 파일이다 — 그쪽은 계획을 「교체」 판정 행에서만 뽑고 본문이 이미 같으면 행을
 * 통째로 건너뛰므로, `--fix-type` 으로는 이 39행에 닿지 못한다.
 *
 * ## `problemType` 이 실제로 어디에 쓰이는지 (코드 전수 확인, 2026-08-16)
 *
 *   출제 자격 `findEligibleProblems`  — **안 쓴다.** reviewStatus·directUseAllowed·
 *                                       정답 유무·단원·풀만 본다.
 *   문항 선정 `balanceDifficulty`      — **쓴다.** 난이도 버킷 안에서 유형 사용 빈도가
 *                                       낮은 문제를 우선한다(`pickTypeBalanced`).
 *   배치 순서 `arrangeByType`          — **쓴다.** 같은 유형 3연속 회피.
 *   채점     `gradeAnswers`            — **안 쓴다.** 학생 응답의 essayScore/selectedChoice
 *                                       로 분기한다. `GradingProblem` 에 필드가 없다.
 *   문제은행 조회 필터 · 변형 상속      — 쓴다.
 *
 * 즉 **자격과 채점은 안 바뀌고, 구성과 순서와 화면 필터가 바뀐다.**
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

import { mapProblemType } from "../../src/lib/import/mapProblemType";
import type { HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const BACKUP = "scripts/qa/reports/problem-type-backup.json";

/** 백업·검증 컬럼 — 내가 안 쓰는 컬럼까지 담아야 "안 바뀌었음" 을 증명할 수 있다. */
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

async function gateOrExit(): Promise<boolean> {
  const { allowSharedImport } = await import(
    "../../src/lib/import/classifyDatabaseUrl"
  );
  const { inspectDatabaseTargets } = await import("../import/resolveDbTarget");
  const target = (await inspectDatabaseTargets()).selected;
  if (!target.canMigrateOrLoad && !allowSharedImport(target)) {
    console.log(
      `차단 — ${target.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요. DB 에 접속하지 않고 끝냅니다.`,
    );
    return false;
  }
  console.log(`대상 DB — ${target.kind} (${target.host})`);
  return true;
}

async function fetchRows(
  prisma: { problem: { findMany: (a: unknown) => Promise<BackupRow[]> } },
  ids: string[],
): Promise<Map<string, BackupRow>> {
  const out = new Map<string, BackupRow>();
  for (let i = 0; i < ids.length; i += 500) {
    for (const r of await prisma.problem.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: ROW_SELECT,
    })) {
      out.set(r.id, r);
    }
  }
  return out;
}

interface Cand {
  id: string;
  externalId: string | null;
  examId: string;
  n: number;
  from: string;
  to: string;
  choices: number;
}

/** 후보는 **현재 DB 상태**로 뽑는다. 로컬 스냅샷은 본문 적재 전 값이라 못 믿는다. */
async function buildCandidates(): Promise<Cand[]> {
  const verdicts = (await readFile(VERDICTS, "utf-8"))
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l))
    .filter((v) => v.id);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  const cur = new Map<string, string>();
  try {
    const ids = verdicts.map((v) => v.id);
    for (let i = 0; i < ids.length; i += 500) {
      for (const r of await prisma.problem.findMany({
        where: { id: { in: ids.slice(i, i + 500) } },
        select: { id: true, problemType: true },
      })) {
        cur.set(r.id, r.problemType);
      }
    }
  } finally {
    await prisma.$disconnect();
  }

  const hwpCache = new Map<string, Map<number, HwpQ>>();
  const out: Cand[] = [];
  for (const v of verdicts) {
    if (cur.get(v.id) !== "서술형") continue;
    if (!hwpCache.has(v.examId)) {
      const qs: HwpQ[] = JSON.parse(
        await readFile(`${HWP_DIR}/${v.examId}.json`, "utf-8"),
      ).questions ?? [];
      hwpCache.set(v.examId, new Map(qs.map((q) => [q.number, q])));
    }
    const q = hwpCache.get(v.examId)!.get(v.hwpNumber);
    const choices = q?.choices?.length ?? 0;
    if (!q || choices < 4) continue;
    out.push({
      id: v.id,
      externalId: v.externalId,
      examId: v.examId,
      n: v.n,
      from: "서술형",
      to: mapProblemType(q.type ?? undefined),
      choices,
    });
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const backupOnly = process.argv.includes("--backup-only");
  const verify = process.argv.includes("--verify");
  const expectIdx = process.argv.indexOf("--expect");
  const expect = expectIdx >= 0 ? Number(process.argv[expectIdx + 1]) : 39;

  if (verify) {
    if (!existsSync(BACKUP)) {
      console.log(`백업 파일이 없습니다: ${BACKUP}`);
      return;
    }
    const backup = JSON.parse(await readFile(BACKUP, "utf-8")) as {
      takenAt: string;
      rows: BackupRow[];
      plan: Cand[];
    };
    const want = new Map(backup.plan.map((p) => [p.id, p.to]));
    const { PrismaClient } = await import("@prisma/client");
    const prisma = new PrismaClient();
    try {
      const now = await fetchRows(prisma as never, backup.rows.map((r) => r.id));
      let ok = 0;
      let same = 0;
      let other = 0;
      const changed: Record<string, number> = {};
      const OTHER: Array<keyof BackupRow> = [
        "content", "answer", "solution", "figureUrls", "figureSource",
        "externalId", "unitId", "score", "difficulty", "reviewStatus",
      ];
      for (const b of backup.rows) {
        const cur = now.get(b.id);
        if (!cur) continue;
        if (cur.problemType === want.get(b.id)) ok += 1;
        else if (cur.problemType === b.problemType) same += 1;
        else other += 1;
        for (const k of OTHER) {
          const eq =
            k === "figureUrls"
              ? JSON.stringify(cur[k]) === JSON.stringify(b[k])
              : cur[k] === b[k];
          if (!eq) changed[k] = (changed[k] ?? 0) + 1;
        }
      }
      console.log("── problemType 정정 검증 ──");
      console.log(`백업 시각 ${backup.takenAt} · ${backup.rows.length}행`);
      console.log(`problemType — 의도대로 바뀜 ${ok} · 그대로 ${same} · 제3의 값 ${other}`);
      console.log(
        Object.keys(changed).length === 0
          ? "의도 밖 컬럼 — content 포함 10개 전부 **0건 변경**"
          : `⚠️ 의도 밖 컬럼 변경: ${JSON.stringify(changed)}`,
      );
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  if ((apply || backupOnly) && !(await gateOrExit())) return;

  const plan = await buildCandidates();
  const byMove = new Map<string, number>();
  for (const c of plan) {
    const k = `${c.from} → ${c.to}`;
    byMove.set(k, (byMove.get(k) ?? 0) + 1);
  }
  console.log("── problemType 정정 계획 ──");
  console.log(`대상 ${plan.length}행 · ${[...byMove].map(([k, n]) => `${k} ${n}`).join(" · ")}`);

  // 수가 흔들리는 구간이다(26 → 39 로 정정한 적이 있다). 예상과 다르면 **멈춘다.**
  if (plan.length !== expect) {
    console.log(
      `\n중단 — 예상 ${expect}행과 다릅니다(실제 ${plan.length}행).\n` +
        "수가 바뀐 이유를 먼저 확인하세요. 의도한 변화라면 --expect 로 명시하세요.",
    );
    return;
  }

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
            "problemType 정정 직전 상태. 되돌릴 때는 **problemType 만** 되쓴다 — " +
            "다른 컬럼까지 되쓰면 그 사이 다른 트랙이 한 작업을 지운다.",
          plan,
          rows: [...current.values()],
        }),
        "utf-8",
      );
      console.log(`백업 완료 — ${BACKUP} · ${current.size}행 (계획 ${plan.length}행)`);
    } finally {
      await prisma.$disconnect();
    }
    return;
  }

  if (!apply) {
    console.log("\n드라이런 — 변경 없음. 적용하려면 --backup-only 후 --apply");
    return;
  }

  if (!existsSync(BACKUP)) {
    console.log(`\n중단 — 백업이 없습니다(${BACKUP}). 먼저 --backup-only 를 도세요.`);
    return;
  }
  const backup = JSON.parse(await readFile(BACKUP, "utf-8")) as {
    takenAt: string;
    rows: BackupRow[];
  };
  const covered = new Set(backup.rows.map((r) => r.id));
  const uncovered = plan.filter((p) => !covered.has(p.id));
  if (uncovered.length > 0) {
    console.log(
      `\n중단 — 백업이 계획을 다 못 덮습니다(미포함 ${uncovered.length}). --backup-only 를 다시 도세요.`,
    );
    return;
  }
  console.log(`백업 확인 — ${BACKUP} · ${backup.rows.length}행 · ${backup.takenAt}`);

  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    let updated = 0;
    let skipped = 0;
    for (const p of plan) {
      // 지금도 여전히 `서술형` 인 행만 바꾼다 — 남이 그 사이 고쳤으면 덮지 않는다.
      const r = await prisma.problem.updateMany({
        where: { id: p.id, problemType: "서술형" },
        data: { problemType: p.to },
      });
      if (r.count === 1) updated += 1;
      else skipped += 1;
    }
    console.log(`적용 ${updated}행 · 건너뜀(이미 다른 값) ${skipped}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
