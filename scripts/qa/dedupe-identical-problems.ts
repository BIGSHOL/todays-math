/**
 * **글자·정답·그림이 모두 같은 중복 문항을 지운다** (원장님 지시 2026-08-20).
 *
 *   npx tsx scripts/qa/dedupe-identical-problems.ts                     드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/dedupe-identical-problems.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/dedupe-identical-problems.ts --revert
 *
 * 지시는 두 문장이었다 — **「같은 문제는 지워. 숫자 다른건 남겨두고」.**
 * 뒷문장이 이 스크립트의 뼈대다. 같은 단원의 형제 문항은 발문이 **글자 하나까지
 * 같고** 가르는 것이 오직 숫자다. 그 숫자가 어디 있느냐가 문제다:
 *
 *   ㉠ 정답에 있다   — `다음 그림에서 ∠x 의 크기를 구하시오` 12행, 정답 10종
 *   ㉡ 해설에 있다
 *   ㉢ **그림 안에 있다** — 본문에도 정답에도 안 나온다
 *
 * 그래서 판정은 본문만으로 하지 않는다. **본문·정답·그림 세 축**이 모두 같을 때만
 * 같은 문항이다 — 그 규칙은 이미 `find-true-duplicates.ts` 에 있고, 여기서는
 * **그것을 부른다.** 다시 판정하지 않는다(CLAUDE.md 2026-08-18: 목록을 양쪽이
 * 각각 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다).
 *
 * ## 🔴 못 가르는 것은 지우지 않는다
 *
 * 세 축이 같아 보여도 **그 축이 비어 있으면 «같다»가 아무 뜻이 없다.** 없는 것끼리
 * 같은 것뿐이다. 둘을 보류한다:
 *
 *   ⑴ 정답이 없는 행이 하나라도 있는 무리 (`find-true-duplicates` 의 `hasAnswer`)
 *   ⑵ 본문이 그림을 지목하는데 **무리 전원이 그림이 없는** 무리
 *      — 가르는 숫자가 하필 그 그림 안에 있을 수 있다. 그림 유실은 아직 167건이다.
 *
 * ⑵ 의 「그림을 지목하나」는 **넓게** 잡는다. 여기서 넓게 잡으면 손해가 «안 지운다»
 * 뿐이고, 좁게 잡으면 손해가 «서로 다른 문항을 지운다» 다. 되돌릴 수 없는 쪽을 피한다.
 *
 * ## 🔴 무엇을 남기나
 *
 * 무리마다 **한 행만** 남긴다. 고르는 순서는 「되짚을 수 있는 쪽」이 먼저다 —
 * 시험지에 쓰임 → `externalId` → `sourceFile` → 그림 많음 → 해설 있음 → 먼저 들어온 것.
 * 실측에서 갈린 자리가 여기다: 2026-08-14 적재분은 `externalId`·`sourceFile` 이
 * 없고 단원도 옛 판정이라, 뒤에 다시 들어온 쪽이 성하다.
 *
 * ## 🔴 분모를 먼저 찍는다
 *
 * 「반증하려고 넓힌 무리를 처리 대상으로 물려받아」 43이 433이 된 적이 있다
 * (2026-08-18). 그래서 **「지울 것 + 남길 것 + 보류」가 무리 속 행 수와 안 맞으면 멈춘다.**
 *
 * ## 영구 삭제가 아니다
 *
 * 지운 행의 **모든 컬럼**을 원장(`scripts/qa/reports/duplicate-delete-ledger.json`)에
 * DB 보다 **먼저** 적는다. `--revert` 가 그대로 되살린다 — `problem_code` 도 그대로
 * 돌아온다(부여 트리거가 «명시된 코드는 존중한다»).
 */
import { existsSync, readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { isDirectScript } from "../import/isDirectScript";
import { writeJson } from "../import/writeJson";
import { groupBy, hasAnswer, type Row } from "./find-true-duplicates";
import { mergeLedgerRows, stillApplied } from "./revertLedger";

const LEDGER = "scripts/qa/reports/duplicate-delete-ledger.json";
/** 일일테스트 정원 — 단원이 이 밑으로 내려가면 알린다 (D-20). */
const DAILY = 8;

/**
 * 「본문이 그림을 지목하나」 — **넓게** 잡는다.
 *
 * 좁게 잡으면 서로 다른 문항을 지운다. 넓게 잡으면 못 지울 뿐이다.
 * 그래서 「그림자」·「그림그래프」 같은 오탐을 **일부러 안 걸러낸다** —
 * 여기서 오탐의 값은 «보류» 이고, 보류는 아무것도 망가뜨리지 않는다.
 */
const REFERENCES_FIGURE =
  /그림|그래프|도형|전개도|산점도|상자|좌표평면|다음 표|아래 표|위의 표|표를 완성|도표|그리시오|작도/;

/**
 * 이 무리를 지워도 되나. 못 지우는 사유를 돌려주고, 지워도 되면 `null`.
 *
 * ⚠️ 「세 축이 같다」는 이 함수의 **입력 조건**이지 판정이 아니다. 무리를 만드는 쪽은
 *    `groupBy(rows, "all-three")` 하나뿐이다.
 */
export function holdReason(bucket: readonly Row[]): string | null {
  if (!bucket.every(hasAnswer))
    return "정답이 없는 행이 있다 — 정답 축을 못 본다";
  if (
    bucket.every((row) => row.figureUrls.length === 0) &&
    bucket.some((row) => REFERENCES_FIGURE.test(row.content))
  ) {
    return "본문이 그림을 지목하는데 전원 그림이 없다 — 가르는 숫자가 그림 안일 수 있다";
  }
  return null;
}

/** 남길 행을 고르는 근거. 큰 쪽이 이긴다. */
export interface Keepable {
  id: string;
  usedInPaper: number;
  /**
   * `exam_question.problem_id` 가 이 행을 가리키는 수.
   *
   * ⚠️ 이 컬럼에는 **FK 가 없다.** 가리키던 행을 지우면 오류 없이 **조용히 끊긴다** —
   *    실측 43행이 그렇게 끊겼다. 그래서 ⑴ 링크가 걸린 쪽을 먼저 남기고,
   *    ⑵ 그래도 남는 링크는 지우기 전에 **남긴 짝으로 옮긴다**(§repoint).
   */
  examLinks: number;
  externalId: string | null;
  sourceFile: string | null;
  figureCount: number;
  hasSolution: boolean;
  createdAt: Date;
}

const score = (row: Keepable): number[] => [
  row.usedInPaper > 0 ? 1 : 0,
  row.examLinks > 0 ? 1 : 0,
  row.externalId ? 1 : 0,
  row.sourceFile ? 1 : 0,
  row.figureCount,
  row.hasSolution ? 1 : 0,
  -row.createdAt.getTime(), // 먼저 들어온 것이 이긴다
];

/**
 * 무리에서 남길 행 하나. 점수가 같으면 `id` 사전순으로 갈라 **실행마다 같은 답**을 낸다.
 */
export function pickKeeper<T extends Keepable>(bucket: readonly T[]): T {
  return [...bucket].sort((a, b) => {
    const [x, y] = [score(a), score(b)];
    for (let i = 0; i < x.length; i += 1) if (x[i] !== y[i]) return y[i] - x[i];
    return a.id < b.id ? -1 : 1;
  })[0];
}

interface LedgerRow {
  id: string;
  problemCode: string;
  keptId: string;
  row: Record<string, unknown>;
  /** 이 행을 가리키던 `exam_question` 들 — 되돌릴 때 그대로 돌려놓는다. */
  examQuestionIds?: string[];
}

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

async function main(): Promise<void> {
  if ((APPLY || REVERT) && process.env.ALLOW_UNIT_FIX !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_UNIT_FIX=1 과 --apply(또는 --revert)가 둘 다 필요하다.",
    );
    process.exit(1);
  }
  const prisma = new PrismaClient();
  try {
    const previous = existsSync(LEDGER)
      ? (JSON.parse(readFileSync(LEDGER, "utf8")) as {
          applied?: boolean;
          rows?: LedgerRow[];
        })
      : null;

    if (REVERT) {
      await revert(prisma, previous?.rows ?? []);
      return;
    }

    // ── 1. 무리 만들기 — 판정은 `find-true-duplicates` 의 세 축 규칙 하나뿐이다 ──
    const rows: Row[] = await prisma.problem.findMany({
      select: { id: true, content: true, answer: true, figureUrls: true },
    });
    const groups = groupBy(rows, "all-three");
    const inGroups = [...groups.values()].reduce((s, g) => s + g.length, 0);
    console.log("── 글자·정답·그림이 모두 같은 중복 ──");
    console.log(`문항 전체 ${rows.length}행`);
    console.log(
      `세 축이 모두 같은 무리 ${groups.size} · 그 안의 행 ${inGroups}`,
    );

    // ── 2. 못 가르는 무리를 뺀다 ────────────────────────────────────────
    const holds = new Map<string, string>();
    const live: Row[][] = [];
    for (const [key, bucket] of groups) {
      const why = holdReason(bucket);
      if (why) holds.set(key, why);
      else live.push(bucket);
    }
    const heldRows = [...groups]
      .filter(([k]) => holds.has(k))
      .reduce((s, [, g]) => s + g.length, 0);
    const byReason = new Map<string, number>();
    for (const why of holds.values())
      byReason.set(why, (byReason.get(why) ?? 0) + 1);
    console.log(`\n[보류] 무리 ${holds.size} · 행 ${heldRows}`);
    for (const [why, n] of byReason) console.log(`   ${n}무리 — ${why}`);

    // ── 3. 남길 것 / 지울 것 ────────────────────────────────────────────
    const ids = live.flat().map((r) => r.id);
    const detail = await prisma.problem.findMany({
      where: { id: { in: ids } },
      select: {
        id: true,
        problemCode: true,
        unitId: true,
        source: true,
        externalId: true,
        sourceFile: true,
        figureUrls: true,
        solution: true,
        createdAt: true,
        directUseAllowed: true,
        reviewStatus: true,
        _count: {
          select: {
            testProblems: true,
            problemAnswers: true,
            transformedProblems: true,
          },
        },
      },
    });
    // `exam_question.problem_id` 에는 **관계도 FK 도 없다.** 따로 세지 않으면
    // 「가리키는 것이 있다」를 구조적으로 못 본다.
    const linkRows: Array<{ problem_id: string; n: bigint }> =
      await prisma.$queryRawUnsafe(
        `SELECT problem_id, count(*) AS n FROM "exam_question"
        WHERE problem_id = ANY($1::uuid[]) GROUP BY problem_id`,
        ids,
      );
    const links = new Map(linkRows.map((r) => [r.problem_id, Number(r.n)]));

    const info = new Map(
      detail.map((d) => [
        d.id,
        {
          id: d.id,
          usedInPaper: d._count.testProblems,
          examLinks: links.get(d.id) ?? 0,
          externalId: d.externalId,
          sourceFile: d.sourceFile,
          figureCount: d.figureUrls.length,
          hasSolution: Boolean(d.solution?.trim()),
          createdAt: d.createdAt,
          unitId: d.unitId,
          source: d.source,
          directUseAllowed: d.directUseAllowed,
          reviewStatus: d.reviewStatus,
          problemCode: d.problemCode,
          referenced:
            d._count.testProblems +
            d._count.problemAnswers +
            d._count.transformedProblems,
        },
      ]),
    );

    const doomed: Array<{ id: string; keptId: string }> = [];
    let keptCount = 0;
    let pinned = 0; // 참조가 걸려 못 지우는 행
    for (const bucket of live) {
      const cards = bucket.map((r) => info.get(r.id)!);
      const keeper = pickKeeper(cards);
      keptCount += 1;
      for (const card of cards) {
        if (card.id === keeper.id) continue;
        if (card.referenced > 0) {
          pinned += 1; // 시험지·답안·변형본이 걸려 있으면 **안 지운다**
          continue;
        }
        doomed.push({ id: card.id, keptId: keeper.id });
      }
    }

    // ── 4. 분모 검산 — 안 맞으면 멈춘다 ─────────────────────────────────
    const accounted = keptCount + pinned + doomed.length + heldRows;
    console.log(
      `\n[분모] 무리 속 행 ${inGroups} = 남길 것 ${keptCount} + 참조가 걸려 못 지움 ${pinned}` +
        ` + 지울 것 ${doomed.length} + 보류 ${heldRows} = ${accounted}`,
    );
    if (accounted !== inGroups) {
      throw new Error(`분모가 안 맞는다 (${accounted} ≠ ${inGroups}) — 멈춘다`);
    }

    // ── 5. D-20 무엇을 잃나 ─────────────────────────────────────────────
    const doomedInfo = doomed.map((d) => info.get(d.id)!);
    const usable = doomedInfo.filter(
      (d) => d.directUseAllowed && d.reviewStatus === "approved",
    ).length;
    const bySource = new Map<string, number>();
    for (const d of doomedInfo)
      bySource.set(d.source, (bySource.get(d.source) ?? 0) + 1);
    const units = new Set(doomedInfo.map((d) => d.unitId));
    console.log(
      `\n[D-20 무엇을 잃나] 지울 ${doomed.length}행 중 지금 출제 가능 ${usable}`,
    );
    console.log(
      `   출처별 — ${[...bySource].map(([s, n]) => `${s} ${n}`).join(" · ")}`,
    );
    console.log(`   영향 단원 ${units.size}개`);
    // 🔴 **단원이 줄어드는 것과 문항을 잃는 것은 다르다.**
    // 실측: 지울 것의 대부분은 남는 짝이 **다른 단원**에 있다 — 2026-08-14 적재분이
    // 단원을 잘못 물고 있었고(`externalId` 도 없다), 뒤에 다시 들어온 쪽이 제자리다.
    // 그런 행은 「그 단원의 문항이 줄었다」가 아니라 「그 단원 것이 아니었다」다.
    // 그래도 **원장님이 그 단원으로 진도를 잡으면 풀이 실제로 얇아진다** — 그래서
    // 둘을 갈라 찍고, 얇아지는 단원은 이름까지 낸다.
    const sameUnit = doomed.filter(
      (d) => info.get(d.id)!.unitId === info.get(d.keptId)!.unitId,
    ).length;
    console.log(
      `   남는 짝이 같은 단원 ${sameUnit} · **다른 단원 ${doomed.length - sameUnit}**` +
        ` (다른 단원이면 그 단원 것이 아니었다는 뜻이다)`,
    );
    const before = await prisma.problem.groupBy({
      by: ["unitId"],
      where: {
        unitId: { in: [...units] },
        directUseAllowed: true,
        reviewStatus: "approved",
      },
      _count: { _all: true },
    });
    const lose = new Map<string, number>();
    for (const d of doomedInfo) {
      if (d.directUseAllowed && d.reviewStatus === "approved")
        lose.set(d.unitId, (lose.get(d.unitId) ?? 0) + 1);
    }
    const rank = before
      .map((b) => ({
        unitId: b.unitId,
        now: b._count._all,
        after: b._count._all - (lose.get(b.unitId) ?? 0),
      }))
      .sort((a, b) => a.after - b.after);
    const dropped = rank.filter((u) => u.after < DAILY);
    const names = new Map(
      (
        await prisma.unit.findMany({
          where: {
            id: {
              in: rank
                .slice(0, 5)
                .concat(dropped)
                .map((u) => u.unitId),
            },
          },
          select: {
            id: true,
            problemCodePrefix: true,
            grade: true,
            section: true,
          },
        })
      ).map((u) => [u.id, `${u.problemCodePrefix} ${u.grade} ${u.section}`]),
    );
    console.log("   가장 얇아지는 단원 —");
    for (const u of rank.slice(0, 5))
      console.log(`     ${names.get(u.unitId)}: ${u.now} → ${u.after}`);
    console.log(
      dropped.length
        ? `   ⚠️ 지운 뒤 정원(${DAILY}) 아래로 내려가는 단원 ${dropped.length}개 — ` +
            dropped.map((u) => `${names.get(u.unitId)}:${u.after}`).join(" · ")
        : `   정원(${DAILY}) 아래로 내려가는 단원 없음`,
    );

    if (!APPLY) {
      console.log("\n드라이런이다. 실제로 지우려면 ALLOW_UNIT_FIX=1 … --apply");
      return;
    }

    // ── 6. 원장을 **DB 보다 먼저** 쓴다 ─────────────────────────────────
    const full = await prisma.problem.findMany({
      where: { id: { in: doomed.map((d) => d.id) } },
    });
    const byId = new Map(full.map((f) => [f.id, f]));
    const fresh: LedgerRow[] = doomed.map((d) => ({
      id: d.id,
      problemCode: byId.get(d.id)!.problemCode,
      keptId: d.keptId,
      row: JSON.parse(
        JSON.stringify(byId.get(d.id), (_k, v) =>
          typeof v === "bigint" ? Number(v) : v,
        ),
      ) as Record<string, unknown>,
    }));
    // 🔴 **지우기 전에 `exam_question` 링크를 남긴 짝으로 옮긴다.**
    // 그냥 지우면 FK 가 없어 **조용히 끊긴다**(실측 43행). 링크가 가리키던 것은
    // 「그 시험지 N번 문항이 문제은행의 어느 행인가」이고, 남긴 짝은 본문·정답·그림이
    // **같은 문항**이므로 옮겨도 가리키는 대상이 달라지지 않는다.
    // ⚠️ 여기서 `syncExamMetadata` 를 부르면 **안 된다** — 그것은 시험지를 «지금 문항»
    //    으로 다시 짓기 때문에, 짝이 다른 편에 있는 경우 그 편의 문항이 통째로 사라진다.
    //    시험지 기록(편·문항·배점)은 `exam_question` 이 정본이고 우리는 링크만 고친다.
    const linkOwners: Array<{ id: string; problem_id: string }> =
      await prisma.$queryRawUnsafe(
        `SELECT id, problem_id FROM "exam_question" WHERE problem_id = ANY($1::uuid[])`,
        doomed.map((d) => d.id),
      );
    const linkByProblem = new Map<string, string[]>();
    for (const l of linkOwners) {
      linkByProblem.set(l.problem_id, [
        ...(linkByProblem.get(l.problem_id) ?? []),
        l.id,
      ]);
    }
    for (const row of fresh)
      row.examQuestionIds = linkByProblem.get(row.id) ?? [];

    const merged = mergeLedgerRows(previous?.rows, fresh);
    await writeJson(LEDGER, {
      기준: "본문·정답·그림 세 축이 모두 같은 무리에서, 남긴 한 행을 뺀 나머지",
      판정: "scripts/qa/find-true-duplicates.ts 의 groupBy(rows,'all-three')",
      applied: stillApplied(previous?.applied, true),
      되돌리기:
        "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/dedupe-identical-problems.ts --revert",
      rows: merged.rows,
    });
    console.log(
      `\n원장 ${merged.rows.length}행 (이어받음 ${merged.carried}) → ${LEDGER}`,
    );

    let moved = 0;
    for (const row of fresh) {
      if (!row.examQuestionIds?.length) continue;
      const r = await prisma.examQuestion.updateMany({
        where: { id: { in: row.examQuestionIds } },
        data: { problemId: row.keptId },
      });
      moved += r.count;
    }
    console.log(`exam_question 링크를 남긴 짝으로 옮김 ${moved}건`);

    const result = await prisma.problem.deleteMany({
      where: { id: { in: doomed.map((d) => d.id) } },
    });
    console.log(`삭제 ${result.count}행`);
    if (result.count !== doomed.length) {
      throw new Error(
        `지운 수가 계획과 다르다 (${result.count} ≠ ${doomed.length})`,
      );
    }
  } finally {
    await prisma.$disconnect();
  }
}

async function revert(
  prisma: PrismaClient,
  ledger: LedgerRow[],
): Promise<void> {
  if (!ledger.length) {
    console.log("원장이 비었다 — 되돌릴 것이 없다.");
    return;
  }
  const present = new Set(
    (
      await prisma.problem.findMany({
        where: { id: { in: ledger.map((r) => r.id) } },
        select: { id: true },
      })
    ).map((r) => r.id),
  );
  const back = ledger.filter((r) => !present.has(r.id));
  console.log(
    `원장 ${ledger.length}행 · 이미 있는 행 ${present.size} · 되살릴 행 ${back.length}`,
  );
  if (!APPLY && !REVERT) return;
  let done = 0;
  for (const r of back) {
    const row = { ...r.row } as Record<string, unknown>;
    for (const k of ["createdAt", "updatedAt"]) {
      if (typeof row[k] === "string") row[k] = new Date(row[k] as string);
    }
    // exam-wiring: 되돌리기 — 원장의 행을 **그대로** 되살린다. 새 기출이 아니라 우리가
    // 지운 행이고 `Exam` 은 지운 적이 없다. 그래서 편을 다시 짓지 않고(그러면 짝이 다른
    // 편에 있는 문항이 사라진다) 아래에서 `examQuestion` 링크만 원래대로 돌려놓는다.
    await prisma.problem.create({ data: row as never });
    done += 1;
  }
  let back0 = 0;
  for (const r of ledger) {
    if (!r.examQuestionIds?.length) continue;
    const res = await prisma.examQuestion.updateMany({
      where: { id: { in: r.examQuestionIds } },
      data: { problemId: r.id },
    });
    back0 += res.count;
  }
  console.log(`되살림 ${done}행 · exam_question 링크 되돌림 ${back0}건`);
}

if (isDirectScript(import.meta.url)) {
  void main();
}
