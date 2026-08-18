/**
 * 재배정 4차 — 3차에서 **판정 보류**한 2건을 끝낸다.
 *
 *   npx tsx scripts/classify/apply-unit-audit-hold-resolve.ts            # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-hold-resolve.ts
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-hold-resolve.ts --revert
 *
 * ## 3차가 왜 못 정했나 — 열쇠를 안 본 것이지 열쇠가 없던 게 아니다
 *
 * 3차 `decide()` 는 `content` 와 `answer` **두 컬럼만** 봤다. 그래서
 * 「다음 삼각형의 넓이를 구하시오」는 "발문에도 정답에도 근호가 없다"로 보류됐다.
 * 그런데 같은 행의 `solution` 에 `\sin 45\degree` 가 그대로 있었고,
 * `figureUrls` 가 가리키는 `public/figures/rpm/<externalId>/0.png` 도 디스크에 있었다.
 * 그림에는 AB=8, AC=3√2, ∠A=45° 가 적혀 있다 — ½·8·3√2·sin45° = 12 로 정답과 맞는다.
 *
 * **판정 근거를 한 컬럼에서만 찾으면, 다른 컬럼에 있는 답이 «없는 것»이 된다**
 * (CLAUDE.md 2026-08-18 「컬럼이 다르면 데이터가 다르다」와 같은 자리다).
 * 그래서 이 판정은 본문과 **독립인 근거 둘**(해설의 삼각비 · 그림의 실측 수치)로 선다.
 *
 * ## 두 번째 건은 «단원» 문제가 아니었다
 *
 * 「다음 그림에서 ∠x의 크기를 구하시오」는 `figureUrls` 가 비었고 `figureSvg` 도 없다.
 * 즉 **어느 단원에 넣든 지면에 그림 없이 나간다** — 학생이 풀 수 없다.
 * 물어야 할 것이 «어느 단원인가»가 아니라 «쓸 수 있는가»였다. 단원은 건드리지 않고
 * 출제 제외를 유지하되, 사유를 `단원 미정` 에서 **`그림 유실`** 로 바꿔 적는다.
 * 이 문항은 같은 결함 1,301건의 하나다(`scripts/qa/report-missing-figures.ts`).
 *
 * 공유 Supabase 쓰기라 기본 차단이다 — `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEDGER = "scripts/classify/reports/hold-resolve-ledger.json";
const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");

/** 삼각비 판정이 서는 근거 — 하나라도 무너지면 옮기지 않는다. */
const TRIG = {
  problemId: "c0c866d0-c1da-4249-9af0-af88a64a2709",
  externalId: "019fd1de-4c48-7311-bfea-826e58b2a0f5",
  toGrade: "중3",
  toSection: "삼각비의 활용",
  figure: "public/figures/rpm/019fd1de-4c48-7311-bfea-826e58b2a0f5/0.png",
};

const NO_FIGURE = {
  problemId: "c0c130e1-6d7d-4227-ae83-4ce7376c30fa",
  사유: "그림 유실 — 본문이 그림을 지목하는데 figureUrls·figureSvg 가 모두 비었다",
};

type Ledger = {
  적용: string;
  되돌리기: string;
  이동: {
    id: string;
    fromUnitId: string;
    toUnitId: string;
    directUseAllowed: boolean;
  }[];
  출제제외유지: { problemId: string; 사유: string }[];
};

/**
 * 옮기기 전에 근거가 지금도 서 있는지 다시 확인한다.
 * 근거가 사라졌는데 이동만 남으면, 왜 옮겼는지 아무도 모르는 행이 된다.
 */
function assertTrigEvidence(
  solution: string | null,
  figureUrls: string[],
): void {
  const reasons: string[] = [];
  if (!solution || !/\\sin\s*45/.test(solution)) {
    reasons.push("해설에 \\sin 45 가 없다");
  }
  if (figureUrls.length === 0) reasons.push("figureUrls 가 비었다");
  if (!existsSync(TRIG.figure))
    reasons.push(`그림 파일이 없다 (${TRIG.figure})`);
  if (reasons.length) {
    throw new Error(`삼각비 판정 근거가 무너졌다: ${reasons.join(" / ")}`);
  }
}

async function main() {
  if (REVERT) return revert();

  const trig = await prisma.problem.findUnique({
    where: { id: TRIG.problemId },
    select: {
      id: true,
      unitId: true,
      solution: true,
      figureUrls: true,
      directUseAllowed: true,
    },
  });
  if (!trig) throw new Error(`대상이 없다: ${TRIG.problemId}`);

  assertTrigEvidence(trig.solution, trig.figureUrls);

  const dest = await prisma.unit.findFirst({
    where: { grade: TRIG.toGrade, section: TRIG.toSection },
    select: { id: true, grade: true, chapter: true, section: true },
  });
  if (!dest)
    throw new Error(`목적지 단원이 없다: ${TRIG.toGrade}/${TRIG.toSection}`);

  const from = await prisma.unit.findUnique({
    where: { id: trig.unitId },
    select: { grade: true, chapter: true, section: true },
  });

  if (trig.unitId === dest.id) {
    console.log("이미 적용돼 있다 — 아무것도 하지 않는다.");
  } else {
    console.log(
      `이동: ${from?.grade}/${from?.section}  →  ${dest.grade}/${dest.chapter}/${dest.section}`,
    );
  }
  console.log(`출제 제외 유지: ${NO_FIGURE.problemId} — ${NO_FIGURE.사유}`);

  if (!APPLY) {
    console.log("\n드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
    return;
  }

  const ledger: Ledger = {
    적용: "판정 보류 2건 종결 — 1건 이동+출제 복귀, 1건 그림 유실로 제외 유지",
    되돌리기:
      "ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-hold-resolve.ts --revert",
    이동: [
      {
        id: trig.id,
        fromUnitId: trig.unitId,
        toUnitId: dest.id,
        directUseAllowed: trig.directUseAllowed,
      },
    ],
    출제제외유지: [NO_FIGURE],
  };

  await prisma.problem.update({
    where: { id: trig.id },
    // 단원이 맞고 그림도 있으니 출제 풀로 되돌린다.
    data: { unitId: dest.id, directUseAllowed: true },
  });

  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), "utf8");
  console.log(`\n적용 완료. 원장 → ${LEDGER}`);
}

async function revert() {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
  if (!APPLY) {
    console.log(`되돌릴 대상 ${ledger.이동.length}건 (드라이런)`);
    return;
  }
  for (const m of ledger.이동) {
    await prisma.problem.update({
      where: { id: m.id },
      data: { unitId: m.fromUnitId, directUseAllowed: m.directUseAllowed },
    });
  }
  console.log(`되돌렸다: ${ledger.이동.length}건`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
