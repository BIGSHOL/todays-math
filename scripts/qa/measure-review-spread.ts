/**
 * 확인테스트(review)가 **범위 안 단원을 얼마나 고루 훑는가** — 실측 자.
 *
 * 실행: npx tsx -r dotenv/config scripts/qa/measure-review-spread.ts
 *       (공유 DB 를 **읽기만** 한다. 쓰기 없음.)
 *
 * ## 왜 이 자가 필요한가
 *
 * 일일테스트는 단원이 하나라 「고루」가 뜻이 없다. 확인테스트는 여러 단원을 묶어
 * **누적 점검**을 하는 물건이라, 범위가 10단원인데 8문항이 3단원에서만 나오면
 * 그 시험지는 제 일을 못 한다. 그런데 엔진은 난이도(`balanceDifficulty`)·유형
 * (`arrangeByType`)·지면(D-52)은 보면서 **단원은 안 본다** — 그래서 문항이 많은
 * 단원으로 쏠린다(중2 앞 10단원 재고가 1건 ~ 736건까지 벌어져 있다).
 *
 * ## 이 자가 재는 것과, 재지 **못하는** 것
 *
 * · 재는 것: ⑴ 등장 단원 수 / 뽑을 수 있는 최대, ⑵ 최다 단원이 차지하는 몫,
 *   ⑶ 같은 유형 3연속이 생긴 시험지 비율, ⑷ **인쇄 미리보기가 경고를 내는** 문항 비율.
 *   ⑶⑷ 는 대조군이다 — 단원을 고루 하려다 유형·지면을 망치면 여기서 드러난다.
 * · 못 재는 것: 「그 시험지가 좋은 시험지인가」. 단원이 고르다고 좋은 것은 아니다.
 *   이 자는 **쏠림이 줄었는가**만 답한다.
 *
 * ⚠️ 경고 비율은 `assessOverflowRisk`(인쇄 미리보기가 실제로 부르는 함수)로 센다.
 *    출제가 쓰는 `risksTightSeat` 로 세면 「고르는 쪽과 세는 쪽이 같은 상수」가 되어
 *    정책을 바꿀수록 성적이 좋아진다(CLAUDE.md 2026-08-18 «지표의 참이 제품에서 오면»).
 *
 * 전후 비교는 **같은 시드·같은 범위**로 두 번 돌려 표를 견준다.
 */
import { PrismaClient } from "@prisma/client";

import { findEligibleProblems } from "@/lib/findEligibleProblems";
import { resolveRange } from "@/lib/generator/resolveRange";
import { selectProblems } from "@/lib/generator/selectProblems";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { assessOverflowRisk, assessSeat } from "@/lib/printOverflow";

const db = new PrismaClient();

/** 실전에 가까운 범위: 각 학년/과목의 첫 소단원부터 N번째까지. */
const GRADES = ["중1", "중2", "중3", "공통수학1", "대수"] as const;
const SPANS = [5, 10, 20] as const;
const COUNTS = [8, 25] as const;
const SEEDS = 30;
/**
 * 범위의 **시작 위치**. 0 은 학년 첫 소단원부터, 12 는 학기 중반부터다.
 *
 * ⚠️ 처음엔 0 만 봤다 — 그런데 실제 확인테스트 범위는 **진도 기반**이라 학년 중간에서
 *    시작하는 것이 보통이다. 「학년 앞부분」만 재고 「전 범위에서 좋아졌다」고 적으면
 *    표본이 답하지 못하는 것을 답한 척하는 것이다.
 */
const OFFSETS = [0, 12] as const;
/**
 * **2회차** — 지난 회차에 나간 문항을 D-20(최근 14일)으로 뺀 뒤 다시 낸다.
 *
 * 단원 분산을 켜면 재고가 1건인 단원이 거의 반드시 뽑힌다. 그 한 건이 14일간 빠지면
 * 다음 회차는 그 단원을 **아예 못 채운다** — 정책이 스스로 다음 회차의 커버리지를
 * 깎는 구조다. 그것을 세지 않으면 이 자는 하루짜리 성적만 낸다.
 */
const ROUNDS = [1, 2] as const;

/** 문항 수에 맞춘 난이도 배분 — 반 기본값(3/4/1)을 비례로 늘린 것. */
function ratioFor(count: number) {
  if (count === 8) return { easy: 3, mid: 4, hard: 1 };
  return { easy: 9, mid: 12, hard: 4 };
}

function hasThreeInARow(types: string[]): boolean {
  for (let i = 2; i < types.length; i += 1) {
    if (types[i] === types[i - 1] && types[i] === types[i - 2]) return true;
  }
  return false;
}

async function main() {
  const cls = await db.class.findFirst();
  if (!cls)
    throw new Error("반이 하나도 없다 — 풀 가시성(D-31)을 정할 수 없다.");
  const units = await db.unit.findMany({ orderBy: { orderIndex: "asc" } });

  console.log(
    "범위     시작  단원 문항  회차 | 등장단원 / 최대  커버리지  최다몫  유형3연속  유형최다  경고문항  (풀위험)",
  );

  let covSum = 0;
  let maxSum = 0;
  let runSum = 0;
  let typeSum = 0;
  let riskSum = 0;
  let rows = 0;
  let covRound1 = 0;
  let rowsRound1 = 0;
  let covRound2 = 0;
  let rowsRound2 = 0;

  for (const grade of GRADES) {
    const gradeUnits = units.filter((u) => u.grade === grade);
    for (const offset of OFFSETS) {
      for (const span of SPANS) {
        const sub = gradeUnits.slice(offset, offset + span);
        if (sub.length < span) continue;

        const range = resolveRange({
          testType: "review",
          rangeStartUnitId: sub[0]!.id,
          rangeEndUnitId: sub[sub.length - 1]!.id,
          units,
        });
        const pool = await findEligibleProblems({
          userId: cls.userId,
          unitIds: range.unitIds,
        });
        const unitsWithProblems = new Set(pool.map((p) => p.unitId)).size;
        /**
         * **대조 열** — 이 풀에 애초에 「이어지는 장 칸(484px)에 안 들어가는」 문항이
         * 몇 %나 있는가. 이게 없으면 「경고문항 0.0%」가 «정책이 잘 걸렀다»인지
         * «이 자가 애초에 0만 낼 수 있다»인지 구분이 안 된다
         * (CLAUDE.md 2026-08-16 «지표가 실패를 셀 수 있는 형태인지»).
         */
        const poolRisky =
          pool.length === 0
            ? 0
            : pool.filter(
                (p) =>
                  assessSeat(
                    {
                      content: p.content,
                      figureUrls: p.figureUrls,
                      figureDims: p.figureDims,
                    },
                    JASEUP_MEASURED_PX.continuationSlot,
                  ).risky,
              ).length / pool.length;

        for (const count of COUNTS) {
          for (const round of ROUNDS) {
            let coverage = 0;
            let maxShare = 0;
            let threeInARow = 0;
            /**
             * 「유형 3연속」은 `arrangeByType` 이 거의 언제나 막아 주어 실측이 0% 로
             * **포화**된다 — 포화된 지표로는 정책 순서를 못 가른다. 그래서 구성 자체의
             * 유형 편중(최다 유형이 차지하는 몫)을 따로 센다.
             */
            let typeMaxShare = 0;
            let risky = 0;
            let seeds = 0;

            for (let s = 0; s < SEEDS; s += 1) {
              const seed = `review-spread:${grade}:${offset}:${span}:${count}:${s}`;
              // 2회차는 **1회차에 나간 문항을 빼고** 같은 시드로 다시 낸다(D-20).
              const previous =
                round === 2
                  ? selectProblems({
                      pool,
                      difficultyRatio: ratioFor(count),
                      count,
                      recentProblemIds: [],
                      seed,
                    }).problems.map((p) => p.id)
                  : [];
              const sel = selectProblems({
                pool,
                difficultyRatio: ratioFor(count),
                count,
                recentProblemIds: previous,
                seed,
              });
              // 정원을 못 채운 시험지는 **세지 않고 버리지도 않는다** — 아래에서 따로 찍는다.
              if (sel.problems.length < count) continue;
              seeds += 1;

              const per = new Map<string, number>();
              for (const p of sel.problems)
                per.set(p.unitId, (per.get(p.unitId) ?? 0) + 1);
              coverage += per.size;
              maxShare += Math.max(...per.values()) / count;
              if (hasThreeInARow(sel.problems.map((p) => p.problemType)))
                threeInARow += 1;

              const perType = new Map<string, number>();
              for (const p of sel.problems)
                perType.set(
                  p.problemType,
                  (perType.get(p.problemType) ?? 0) + 1,
                );
              typeMaxShare += Math.max(...perType.values()) / count;

              risky +=
                assessOverflowRisk(
                  sel.problems.map((p, i) => ({
                    id: p.id,
                    orderIndex: i + 1,
                    content: p.content,
                    answer: "",
                    solution: null,
                    figureUrls: p.figureUrls,
                    figureDims: p.figureDims,
                  })),
                ).length / count;
            }

            if (!seeds) {
              console.log(
                `${grade.padEnd(8)}+${String(offset).padStart(2)}${String(span).padStart(4)}${String(count).padStart(5)}  ${round}회차 | 정원을 못 채움 (시드 ${SEEDS}개 전부)`,
              );
              continue;
            }
            const max = Math.min(count, unitsWithProblems);
            const cov = coverage / seeds;
            console.log(
              `${grade.padEnd(8)}+${String(offset).padStart(2)}${String(span).padStart(4)}${String(count).padStart(5)}  ${round}회차 | ` +
                `${cov.toFixed(1).padStart(5)} / ${String(max).padStart(2)}   ` +
                `${((cov / max) * 100).toFixed(0).padStart(4)}%   ` +
                `${((maxShare / seeds) * 100).toFixed(0).padStart(4)}%   ` +
                `${((threeInARow / seeds) * 100).toFixed(0).padStart(6)}%   ` +
                `${((typeMaxShare / seeds) * 100).toFixed(0).padStart(5)}%   ` +
                `${((risky / seeds) * 100).toFixed(1).padStart(7)}%   ` +
                `(${(poolRisky * 100).toFixed(1)}%)` +
                (seeds < SEEDS ? `   (시드 ${seeds}/${SEEDS})` : ""),
            );

            covSum += cov / max;
            maxSum += maxShare / seeds;
            runSum += threeInARow / seeds;
            typeSum += typeMaxShare / seeds;
            riskSum += risky / seeds;
            rows += 1;
            if (round === 1) {
              covRound1 += cov / max;
              rowsRound1 += 1;
            } else {
              covRound2 += cov / max;
              rowsRound2 += 1;
            }
          }
        }
      }
    }
  }

  console.log(
    `\n전체 평균 — 커버리지 ${((covSum / rows) * 100).toFixed(1)}% · ` +
      `최다몫 ${((maxSum / rows) * 100).toFixed(1)}% · ` +
      `유형3연속 ${((runSum / rows) * 100).toFixed(1)}% · ` +
      `유형최다 ${((typeSum / rows) * 100).toFixed(1)}% · ` +
      `경고문항 ${((riskSum / rows) * 100).toFixed(2)}%  (${rows}개 조합)`,
  );
  console.log(
    `회차별 커버리지 — 1회차 ${((covRound1 / rowsRound1) * 100).toFixed(1)}% · ` +
      `2회차(지난 회차 문항 제외) ${((covRound2 / rowsRound2) * 100).toFixed(1)}%`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
