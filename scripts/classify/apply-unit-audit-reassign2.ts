/**
 * 재배정 2차 — **목적지 학년은 아는데 동명 단원이 없던 30건**을 소단원까지 배정한다.
 *
 *   npx tsx scripts/classify/apply-unit-audit-reassign2.ts            # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign2.ts
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign2.ts --revert
 *
 * ## 왜 1차와 나누나
 *
 * 1차(`apply-unit-audit-reassign.ts`)는 **규칙**이었다 — 같은 이름이 올바른 학년에
 * 정확히 하나 있으면 거기로. 추측이 안 끼는 대신 30건밖에 못 덮었다.
 *
 * 여기 30건은 목적지 **학년**을 메타 근거(학교·과목·원본 경로)가 알지만
 * **소단원 이름이 대응되지 않는다**(초4 「점의 이동」 ↔ 공통수학2 「평행이동/대칭이동」).
 * 그래서 규칙이 아니라 **본문을 한 건씩 읽고 손으로 배정했다.** 아래 표의 근거가 그 기록이다.
 *
 * ⚠️ 자동 분류기를 쓰지 않은 이유: `reports/calibration.json` 실측으로 **공통수학1·미적분1·
 * 기하는 소단원 정확도 90% 를 지키는 문턱이 아예 없어 전부 미분류로 남긴다.** 이 30건의
 * 목적지 절반이 공통수학1·2 라 분류기로는 대부분 못 붙인다.
 *
 * ## 왜 문제은행 화면까지 고쳐야 하나 (실측)
 *
 * §4-A(`directUseAllowed=false`)는 **출제**만 막는다. 문제은행 목록은 그 값으로 거르지 않아
 * 브라우저 확인에서 초3 2학기 필터에 이차부등식 문항이 **그대로 보였다**. 원장님이 처음
 * 보신 화면이 그것이다 — 단원을 실제로 옮겨야 사라진다.
 *
 * 공유 Supabase 쓰기라 기본 차단이다 — `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEDGER = "scripts/classify/reports/reassign2-ledger.json";
const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");

/**
 * externalId → [목적지 학년, 목적지 소단원, 근거(본문에서 읽은 것)].
 * 전부 본문을 눈으로 읽고 정했다. 근거를 안 적은 항목은 넣지 않는다.
 */
const PLACEMENT: Array<[string, string, string, string]> = [
  // ── 초4 「점의 이동」에 앉은 고1 도형의 이동 (상원고·화원고 공수2) ──
  [
    "4384-25",
    "공통수학2",
    "평행이동",
    "원 x²+y²=10 을 평행이동한 뒤 원점 대칭",
  ],
  ["4384-3", "공통수학2", "평행이동", "두 점을 옮기는 평행이동"],
  ["4384-23", "공통수학2", "대칭이동", "원점 대칭 → 직선 y=x 대칭"],
  ["4544-3", "공통수학2", "평행이동", "점 (a,b) 를 x·y 축 방향으로 평행이동"],

  // ── 초3 「원」에 앉은 고1 이차부등식 (칠성고 공수1) — 발단 문항 ──
  [
    "4509-5",
    "공통수학1",
    "이차부등식의 해의 조건",
    "이차부등식의 해가 x=2 일 때 계수 조건",
  ],

  // ── 공통수학2 「함수」에 앉은 고1 이차함수·직선 (제일고·경화여고·청구고) ──
  [
    "2683-14",
    "공통수학1",
    "이차방정식과 이차함수의 관계",
    "두 이차함수가 한 직선에 동시 접함",
  ],
  [
    "4496-21",
    "공통수학1",
    "이차방정식과 이차함수의 관계",
    "실수 k 에 무관하게 x축에 접함",
  ],
  [
    "4496-12",
    "공통수학1",
    "이차방정식과 이차함수의 관계",
    "이차함수에 접하는 직선이 다른 이차함수에도 접함",
  ],
  [
    "4505-7",
    "공통수학1",
    "이차방정식과 이차함수의 관계",
    "이차함수 그래프와 직선이 만나지 않을 조건",
  ],

  // ── 중2 「부등식」에 앉은 고1 연립부등식 (신명고 공수1) ──
  ["4436-16", "공통수학1", "연립일차부등식(2)", "연립부등식의 해가 없을 조건"],

  // ── 공통수학1 「항등식」에 앉은 중1 등식 (강북중 1학년) ──
  ["5173-7", "중1", "등식의 성질", "등식의 성질을 이용한 것 고르기"],
  ["5173-6", "중1", "등식의 성질", "3(x-2)+1=2x+□ 일차 항등식"],

  // ── 중2 「유리수와 소수」에 앉은 중1 수 체계 (시지중) ──
  [
    "5293-1",
    "중1",
    "정수와 유리수",
    "음수·양의 유리수·정수에 대한 설명 고르기",
  ],

  // ── 중1 「평행선」에 앉은 중2 닮음 (강동중 2학년) ──
  [
    "5360-14",
    "중2",
    "삼각형의 두 변의 중점을 연결한 선분",
    "△ABC 에서 두 중점 M, D",
  ],

  // ── 공통수학2 「함수」에 앉은 중2 일차함수·함수 (강북중 2학년) ──
  ["5364-16", "중2", "일차함수의 그래프와 절편", "y=3x+b 의 x절편·y절편"],
  [
    "5364-14",
    "중2",
    "함수와 함숫값",
    "보기 중 y가 x에 관한 일차함수인 것의 개수",
  ],
  [
    "5364-15",
    "중2",
    "일차함수의 그래프와 절편",
    "평행이동한 두 일차함수 그래프",
  ],
  ["5364-12", "중2", "함수와 함숫값", "상자 f 규칙으로 계산되는 함수"],
  ["5364-13", "중2", "함수와 함숫값", "f(x)=-3x+2 에서 f(a), f(b)"],

  // ── 공통수학2 「함수」에 앉은 중3 이차함수 (강동중·강북중 3학년) ──
  [
    "5649-12",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "y=a(x-p)²+q 그래프에서 부호 판정",
  ],
  [
    "5649-20",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "꼭짓점과 한 점으로 a,b,c 구하기",
  ],
  [
    "5649-21",
    "중3",
    "이차함수의 최댓값과 최솟값",
    "x<5 증가·x>5 감소 → 축이 x=5",
  ],
  [
    "5649-17",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "두 이차함수 그래프의 꼭짓점",
  ],
  [
    "5649-11",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "y=2x²-4x+1 그래프의 성질",
  ],
  [
    "5649-16",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "그래프와 y축 교점·꼭짓점",
  ],
  [
    "5652-21",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "그래프 모양으로 a,b,c 구하기",
  ],
  [
    "5652-20",
    "중3",
    "이차함수 y=ax^2+bx+c의 그래프",
    "x축 위 두 점과 이차함수 그래프",
  ],
  [
    "5652-16",
    "중3",
    "이차함수와 그래프",
    "y=¼x² 그래프 위 두 점을 지나는 정사각형",
  ],

  // ── 공통수학1 「연립이차방정식」에 앉은 중3 인수분해 (범물중 3학년) ──
  ["5759-13", "중3", "인수분해", "두 다항식의 공통인수가 x-4"],
];

async function main() {
  const units = await prisma.unit.findMany({
    select: { id: true, grade: true, chapter: true, section: true },
  });
  const unitOf = (grade: string, section: string) => {
    const found = units.filter(
      (u) => u.grade === grade && u.section === section,
    );
    if (found.length !== 1) {
      throw new Error(
        `단원을 하나로 못 찾았다: ${grade} / ${section} (${found.length}개)`,
      );
    }
    return found[0];
  };

  const rows = await prisma.problem.findMany({
    where: { externalId: { in: PLACEMENT.map(([e]) => e) } },
    select: {
      id: true,
      externalId: true,
      unitId: true,
      content: true,
      unit: { select: { grade: true, chapter: true, section: true } },
    },
  });
  const byExt = new Map(rows.map((r) => [r.externalId!, r]));

  type Move = {
    id: string;
    externalId: string;
    from: string;
    fromUnitId: string;
    to: string;
    toUnitId: string;
    근거: string;
  };
  const moves: Move[] = [];
  const 없음: string[] = [];
  let 이미맞음 = 0;

  for (const [ext, grade, section, 근거] of PLACEMENT) {
    const r = byExt.get(ext);
    if (!r) {
      없음.push(ext);
      continue;
    }
    const target = unitOf(grade, section);
    if (r.unitId === target.id) {
      이미맞음 += 1;
      continue;
    }
    moves.push({
      id: r.id,
      externalId: ext,
      from: `${r.unit.grade} / ${r.unit.section}`,
      fromUnitId: r.unitId,
      to: `${target.grade} / ${target.chapter} / ${target.section}`,
      toUnitId: target.id,
      근거,
    });
  }

  console.log(
    `배정표 ${PLACEMENT.length}건 — 옮길 것 ${moves.length} · 이미 맞음 ${이미맞음} · DB 에 없음 ${없음.length}`,
  );
  if (없음.length) console.log(`  없는 externalId: ${없음.join(", ")}`);
  for (const m of moves)
    console.log(`  [${m.externalId}] ${m.from} → ${m.to}\n      ${m.근거}`);

  if (REVERT) {
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      이동: { id: string; fromUnitId: string }[];
    };
    if (!APPLY) {
      console.log(`\n드라이런. 되돌릴 것 ${ledger.이동.length}건.`);
      return;
    }
    for (const m of ledger.이동) {
      await prisma.problem.update({
        where: { id: m.id },
        data: { unitId: m.fromUnitId },
      });
    }
    console.log(`\n되돌리기 완료: ${ledger.이동.length}건`);
    return;
  }

  if (!APPLY) {
    console.log("\n드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
    return;
  }

  for (const m of moves) {
    await prisma.problem.update({
      where: { id: m.id },
      data: { unitId: m.toUnitId },
    });
  }
  console.log(`\n적용 완료: ${moves.length}건`);

  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "unitId 재배정 2차 (본문 육안 배정)",
        옮긴건수: moves.length,
        되돌리기:
          "ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign2.ts --revert",
        이동: moves,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`이전 상태 기록: ${LEDGER}`);

  const after = await prisma.problem.findMany({
    where: { id: { in: moves.map((m) => m.id) } },
    select: { id: true, unitId: true },
  });
  const wrong = after.filter(
    (r) => r.unitId !== moves.find((m) => m.id === r.id)!.toUnitId,
  );
  console.log(`검증: 목적지와 다른 것 ${wrong.length}건 (0 이어야 정상)`);
}

main().finally(() => prisma.$disconnect());
