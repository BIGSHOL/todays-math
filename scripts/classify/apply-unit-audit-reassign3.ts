/**
 * 재배정 3차 — 남은 99건(출제 제외 상태)을 **덩어리별 규칙**으로 옮긴다.
 *
 *   npx tsx scripts/classify/apply-unit-audit-reassign3.ts            # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign3.ts
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign3.ts --revert
 *
 * ## 왜 규칙인가
 *
 * 99건은 20개 소단원에 몰려 있고, 한 소단원 안의 문항이 거의 같은 유형이다
 * (초5 「최소공배수 구하는 방법」 17건이 전부 중1 소인수분해 문항). 그래서 한 건씩이 아니라
 * **덩어리로** 정할 수 있다. 다만 한 덩어리가 늘 균질하지는 않아 본문 패턴으로 갈랐다 —
 * 초2 「□의 값 구하기」 10건은 **유한소수(중2) 3건 + 제곱근(중3) 7건**이 섞여 있었다.
 *
 * ## 육안으로 잡은 것 — **내 초등 판정의 오탐**
 *
 * 99건을 전량 훑다가 내가 만든 초등 판정기(`audit-elementary-unit.ts`)의 **부분문자열 오탐**을
 * 발견했다. 한글 어휘를 공백 제거 사본에 대다 보니 단어 경계가 사라진 것이다:
 *   · 「9999 다**음수**는?」 → `음수` 가드에 걸림
 *   · 「실선으**로그**린다」 → `로그` 가드에 걸림 (겨냥도 문항 2건)
 *   · 「합동」을 중등 전용 어휘로 넣었는데 **초5 「2-3 합동과 대칭」이 실재한다**
 *   · 선대칭 문항의 보기 「도형의 **무게중심**을 지난다」 → `중등도형` 가드에 걸림
 * 이것들은 옮기지 않고 **출제 풀로 되돌린다**(RESTORE). 오탐을 옮기면 멀쩡한 문항을 망친다.
 *
 * ⚠️ 같은 덩어리 안이라도 진짜 오분류는 남아 있다 — 초5 「선대칭도형」에 앉은
 * **반비례 그래프 3건은 중1** 이 맞다. 덩어리 통째 판단을 하지 않은 이유다.
 *
 * ## 못 정한 것은 옮기지 않는다
 *
 * 그림이 있어야 학년을 가를 수 있는 문항(「다음 삼각형의 넓이를 구하시오」 정답 12,
 * 「∠x의 크기를 구하시오」)은 **판정 보류**로 두고 출제 제외 상태를 유지한다.
 * 억지로 붙이면 지금보다 나빠질 수 있다.
 *
 * 공유 Supabase 쓰기라 기본 차단이다 — `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const LEDGER = "scripts/classify/reports/reassign3-ledger.json";
const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");

type Decision =
  | { kind: "move"; grade: string; section: string; 근거: string }
  | { kind: "restore"; 근거: string }
  | { kind: "hold"; 근거: string };

const has = (text: string, re: RegExp) => re.test(text.replace(/\s+/g, ""));

/**
 * 현재 소단원 + 본문으로 목적지를 정한다. 덩어리가 균질하지 않은 곳은 본문 패턴으로 가른다.
 * 반환이 `hold` 면 옮기지 않고 출제 제외 상태를 유지한다.
 */
function decide(section: string, content: string, answer: string): Decision {
  const t = content;

  // ── 초5 「약수와 배수」 ← 중1 소인수분해 ──
  if (
    section.includes("최소공배수 구하는 방법") ||
    section.includes("공배수와 최소공배수")
  ) {
    return has(t, /톱니|열차|간격으로출발/)
      ? {
          kind: "move",
          grade: "중1",
          section: "최대공약수와 최소공배수의 활용",
          근거: "톱니바퀴·열차 간격 = 최소공배수 활용",
        }
      : {
          kind: "move",
          grade: "중1",
          section: "공배수와 최소공배수",
          근거: "소인수 표기 최소공배수",
        };
  }
  if (
    section.includes("최대공약수 구하는 방법") ||
    section.includes("공약수와 최대공약수")
  ) {
    return {
      kind: "move",
      grade: "중1",
      section: "공약수와 최대공약수",
      근거: "서로소·공약수·최대공약수",
    };
  }

  // ── 초2 「□의 값 구하기」 ← 유한소수(중2) / 제곱근(중3) 이 섞여 있다 ──
  if (section.includes("□의 값 구하기")) {
    if (has(t, /유한소수/)) {
      return {
        kind: "move",
        grade: "중2",
        section: "유리수와 소수",
        근거: "유한소수가 되는 조건",
      };
    }
    return {
      kind: "move",
      grade: "중3",
      section: "제곱근의 뜻과 성질",
      근거: "근호 안이 자연수가 되는 조건",
    };
  }

  // ── 초5 「다각형의 둘레와 넓이」 ← 중2 도형의 성질 / 중3 삼각비 ──
  if (section.includes("평행사변형과 삼각형의 넓이")) {
    if (has(t, /평행사변형/)) {
      return {
        kind: "move",
        grade: "중2",
        section: "평행사변형의 성질",
        근거: "평행사변형 대각선·대각 성질",
      };
    }
    // 30°·60° 특수각 → 삼각비. 발문이 같아도 **정답에 근호가 있으면** 삼각비다.
    // 「다음 삼각형의 넓이를 구하시오」 두 건은 발문이 글자까지 같은데 한쪽 정답만 21√3 이었다 —
    // 본문과 독립인 근거(정답)를 하나 더 써서 갈랐다. 그래도 안 갈리면 보류한다.
    // `\square` 는 OCR 이 잃어버린 글리프 자리다. 정답이 `\square=½×7×12…=21 3` 이면
    // 21√3 이었다는 뜻이라 삼각비다(정답이 그냥 `12` 인 형제와 이것으로 갈린다).
    if (has(t, /ACH|=30\\degree/) || has(answer, /\\sqrt|√|\\square/)) {
      return {
        kind: "move",
        grade: "중3",
        section: "삼각비의 활용",
        근거: "특수각 또는 정답에 근호 — 삼각비로 푸는 넓이",
      };
    }
    return {
      kind: "hold",
      근거: "발문에도 정답에도 근호가 없어 초5 넓이인지 중3 삼각비인지 못 가른다",
    };
  }
  if (
    section.includes("마름모와 사다리꼴의 넓이") ||
    section.includes("직사각형과 정사각형의 넓이")
  ) {
    if (has(t, /150\\degree/)) {
      return {
        kind: "move",
        grade: "중3",
        section: "삼각비의 활용",
        근거: "두 변과 낀각 150° 로 넓이(½absin) — 정답 16",
      };
    }
    return {
      kind: "move",
      grade: "중2",
      section: "직사각형, 마름모, 정사각형",
      근거: "마름모·직사각형 대각선 성질",
    };
  }
  if (section.includes("정다각형과 사각형의 둘레")) {
    return has(t, /내각|외각/)
      ? {
          kind: "move",
          grade: "중1",
          section: "다각형의 내각과 외각",
          근거: "내각·외각의 크기",
        }
      : {
          kind: "move",
          grade: "중1",
          section: "다각형",
          근거: "정다각형의 뜻",
        };
  }

  // ── 초4 「수직과 수선」·「삼각형 분류」 ← 중1 기본 도형 ──
  if (section.includes("수직과 수선")) {
    return {
      kind: "move",
      grade: "중1",
      section: "두 직선의 위치 관계",
      근거: "수선의 발·점과 직선 사이의 거리",
    };
  }
  if (section.includes("삼각형을 변의 길이에 따라 분류")) {
    return {
      kind: "move",
      grade: "중1",
      section: "작도",
      근거: "삼각형의 결정조건·대변",
    };
  }

  // ── 초5 「자연수의 혼합 계산」 ← 중1 문자와 식 / 중3 근호 계산 ──
  if (section.includes("곱셈과 나눗셈이 섞여 있는 식")) {
    return has(t, /\\surd|√/)
      ? {
          kind: "move",
          grade: "중3",
          section: "근호를 포함한 식의 계산",
          근거: "근호를 포함한 사칙계산",
        }
      : {
          kind: "move",
          grade: "중1",
          section: "일차식의 뜻Ⅰ",
          근거: "동류항 정리(-7y-y 등)",
        };
  }

  // ── 초5 「합동과 대칭」 — **오탐이 섞여 있다** ──
  if (section.includes("합동") || section.includes("선대칭")) {
    if (has(t, /반비례/)) {
      return {
        kind: "move",
        grade: "중1",
        section: "반비례 관계 y=a/x의 그래프",
        근거: "반비례 그래프의 성질 — 초5 에 없다",
      };
    }
    if (has(t, /닮음/)) {
      return {
        kind: "move",
        grade: "중2",
        section: "닮은 도형",
        근거: "합동과 닮음의 관계 — 닮음은 중2",
      };
    }
    return {
      kind: "restore",
      근거: "초5 「2-3 합동과 대칭」이 실재한다 — 내 판정기의 오탐(합동·무게중심 부분문자열)",
    };
  }

  // ── 초5 「직육면체의 겨냥도」 — 오탐(「실선으로그린다」 → 로그) ──
  if (section.includes("겨냥도")) {
    return {
      kind: "restore",
      근거: "초5 직육면체 겨냥도가 맞다 — 「으로그린다」가 `로그` 가드에 걸린 오탐",
    };
  }

  // ── 초4 「모양 만들기와 채우기」 — 오탐이지만 단원도 틀렸다 ──
  if (section.includes("모양 만들기와 채우기")) {
    return has(t, /9999/)
      ? {
          kind: "move",
          grade: "초4",
          section: "1-1-1 1000이 10개인 수 알아보기",
          근거: "9999 다음 수 = 만(10000) — 초등이 맞고 단원만 틀렸다",
        }
      : { kind: "hold", 근거: "판정 근거 부족" };
  }

  // ── 중등 안에서 어긋난 것들 ──
  if (section.includes("다항식의 곱셈과 나눗셈")) {
    return {
      kind: "move",
      grade: "중3",
      section: "다항식의 곱셈",
      근거: "(2A+3B)(A-2B) 전개 — 중3 시험지",
    };
  }
  if (section.includes("이차함수의 최댓값과 최솟값")) {
    return {
      kind: "move",
      grade: "중3",
      section: "대푯값과 산포도",
      근거: "평균·표준편차 — 통계",
    };
  }

  return { kind: "hold", 근거: "덩어리 규칙이 없다" };
}

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
    where: { directUseAllowed: false },
    select: {
      id: true,
      externalId: true,
      unitId: true,
      content: true,
      answer: true,
      unit: { select: { grade: true, chapter: true, section: true } },
    },
  });
  console.log(`출제 제외 상태 ${rows.length}건을 판정한다\n`);

  type Move = {
    id: string;
    from: string;
    fromUnitId: string;
    to: string;
    toUnitId: string;
    근거: string;
  };
  const moves: Move[] = [];
  const restores: { id: string; unit: string; 근거: string }[] = [];
  const holds: { id: string; unit: string; 본문: string; 근거: string }[] = [];

  for (const r of rows) {
    const d = decide(r.unit.section, r.content, r.answer);
    if (d.kind === "restore") {
      restores.push({
        id: r.id,
        unit: `${r.unit.grade}/${r.unit.section}`,
        근거: d.근거,
      });
      continue;
    }
    if (d.kind === "hold") {
      holds.push({
        id: r.id,
        unit: `${r.unit.grade}/${r.unit.section}`,
        본문: r.content.slice(0, 70).replace(/\s+/g, " "),
        근거: d.근거,
      });
      continue;
    }
    const target = unitOf(d.grade, d.section);
    if (target.id === r.unitId) continue;
    moves.push({
      id: r.id,
      from: `${r.unit.grade} / ${r.unit.section}`,
      fromUnitId: r.unitId,
      to: `${target.grade} / ${target.chapter} / ${target.section}`,
      toUnitId: target.id,
      근거: d.근거,
    });
  }

  const byPair = new Map<string, number>();
  for (const m of moves) {
    const k = `${m.from} → ${m.to}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  console.log(
    `옮길 것 ${moves.length} · 오탐 복구 ${restores.length} · 판정 보류 ${holds.length}\n`,
  );
  console.log("이동 계획:");
  for (const [k, n] of [...byPair].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}건  ${k}`);
  console.log("\n오탐 복구(옮기지 않고 출제 풀로 되돌림):");
  const byRestore = new Map<string, number>();
  for (const r of restores)
    byRestore.set(
      `${r.unit} — ${r.근거}`,
      (byRestore.get(`${r.unit} — ${r.근거}`) ?? 0) + 1,
    );
  for (const [k, n] of byRestore) console.log(`  ${n}건  ${k}`);
  console.log("\n판정 보류(출제 제외 유지):");
  for (const h of holds)
    console.log(`  [${h.unit}] ${h.본문}\n      ${h.근거}`);

  if (REVERT) {
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      이동: { id: string; fromUnitId: string }[];
      오탐복구: { id: string }[];
    };
    if (!APPLY) {
      console.log(
        `\n드라이런. 되돌릴 것 ${ledger.이동.length}건 + 복구 취소 ${ledger.오탐복구.length}건.`,
      );
      return;
    }
    for (const m of ledger.이동) {
      await prisma.problem.update({
        where: { id: m.id },
        data: { unitId: m.fromUnitId },
      });
    }
    await prisma.problem.updateMany({
      where: { id: { in: ledger.오탐복구.map((r) => r.id) } },
      data: { directUseAllowed: false },
    });
    console.log(
      `\n되돌리기 완료: 이동 ${ledger.이동.length} · 복구 취소 ${ledger.오탐복구.length}`,
    );
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
  // 옮긴 것과 오탐은 출제 풀로 되돌린다. 보류분은 제외 상태를 유지한다.
  const backToPool = [...moves.map((m) => m.id), ...restores.map((r) => r.id)];
  const res = await prisma.problem.updateMany({
    where: { id: { in: backToPool } },
    data: { directUseAllowed: true },
  });
  console.log(
    `\n적용 완료: 이동 ${moves.length}건 · 출제 풀 복구 ${res.count}건 · 보류 ${holds.length}건`,
  );

  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "unitId 재배정 3차 (덩어리 규칙) + 오탐 복구",
        되돌리기:
          "ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign3.ts --revert",
        이동: moves,
        오탐복구: restores,
        판정보류: holds,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`이전 상태 기록: ${LEDGER}`);

  const left = await prisma.problem.count({
    where: { directUseAllowed: false },
  });
  console.log(
    `검증: 아직 출제 제외인 것 ${left}건 (보류 ${holds.length}건과 같아야 정상)`,
  );
}

main().finally(() => prisma.$disconnect());
