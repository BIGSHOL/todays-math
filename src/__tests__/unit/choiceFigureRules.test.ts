/**
 * 🟢 회귀 가드 — 「보기가 그림인데 번호와 안 이어진 문항」 판정.
 *
 * ## 왜 이 파일이 있는가
 *
 * 조사(2026-08-18, `docs/planning/tracks/reports/choice-figures.md`)에서 판정이
 * **네 번** 거꾸로 걸렸다. 넷 다 실데이터를 눈으로 보거나 원본 지면을 그려 봐서
 * 찾았다 — 문서·리뷰로는 하나도 안 나왔다. 그래서 그때 틀렸던 **바로 그 문항**을
 * 픽스처로 박아 둔다.
 *
 *  1. 앞 자의 `choiceTexts` 정규식이 **연속한 마커를 건너뛰었다**. `\s*` 가 다음
 *     줄의 개행까지 먹어 `1.\n2.\n3.\n4.\n5.` 가 **3개**로 세어졌다(대구외고 16번).
 *     마커 잔존 통계가 통째로 어긋난다.
 *  2. 「그림 4장 이상」이라는 한 방향 문턱 때문에, 보기 다섯이 **한 장에 띠로**
 *     들어온 이관본이 구조적으로 0이 됐다.
 *  3. 「보기 본문에 글자가 있으면 멀쩡하다」가 틀렸다 — 글자가 **그림 설명**
 *     (`2. [그림] 좌표평면 위 …`)이면 학생은 여전히 못 고른다.
 *  4. 반대로 「보기가 글자 다섯」인 문항까지 잡으면 안 된다. 그림은 발문 자료일 뿐이다.
 *     이 반대쪽 픽스처가 없으면 규칙이 넓어져도 아무도 모른다.
 *
 * ⚠️ 규칙을 고치면 **고치기 전에 확인한 픽스처부터** 다시 보라. 새 픽스처만 보면
 *    회귀는 구조적으로 안 보인다(CLAUDE.md 2026-08-18).
 */
import { describe, expect, it } from "vitest";

import {
  choiceMarkers,
  choiceTextOnly,
  classifyChoiceFigureRow,
  features,
  inScope,
  keyChoiceIsFigure,
  keyFewFigures,
  keyMissingFive,
  keyNoFigures,
} from "../../../scripts/qa/choiceFigureRules";

/* ── 실측 본문 (DB 에서 그대로 따왔다) ────────────────────────────────── */

/** 대구북중 13번 — 마커가 `2.` `4.` 만 남고 그림 표시 다섯. */
const 마커일부만 =
  "일차부등식\n\n$2x-8≤5x-2$\n\n의 해를 수직선 위에 바르게 나타낸 것은?\n\n" +
  "[그림]\n\n2. [그림]\n\n[그림]\n4. [그림]\n\n[그림]";

/** 대구외고 16번 — 마커 다섯이 **다 있는데** 본문이 비었다. 앞 자는 3개로 셌다. */
const 마커다섯_본문없음 =
  "전체집합 U의 세 부분집합 A, B, C에 대하여 다음 중에서 집합 " +
  "(A \\cup B^{C}) \\cap C를 벤다이어그램으로 바르게 나타낸 것은? " +
  "(단, 어두운 부분이 집합을 나타낸 것이다.)\n\n1. \n2. \n3. \n4. \n5. ";

/** 오성중 14번 — 보기 자리가 통째로 사라졌다. 그림만 다섯 장 붙어 있다. */
const 마커없음 =
  "이차함수\n\n$y=a(x+p)^{2}-q$\n\n의 그래프가 그림과 같을 때, 다음 중 이차함수\n\n" +
  "$y=-q(x+a)^{2}+p$\n\n의 그래프의 개형으로 알맞은 것은? (단,\n\n$a,p,q$\n\n는 상수이다.)";

/** 보기 자리에 `[그림] <설명>` 이 붙은 것 — 글자는 있으나 그 글자가 그림 설명이다. */
const 보기가_그림설명 =
  "다음 중 일차함수의 그래프로 알맞은 것은?\n" +
  "1. [그림] 좌표평면 위 오른쪽 위로 향하는 직선. y절편 1\n" +
  "2. [그림] 좌표평면 위 오른쪽 아래로 향하는 직선\n" +
  "3. [그림] 원점을 지나는 직선\n" +
  "4. [그림] x축에 평행한 직선\n" +
  "5. [그림] y축에 평행한 직선";

/** 원문자 마커로 들어온 문항. */
const 원문자마커 =
  "다음 중 옳은 것은?\n① [그림]\n② [그림]\n③ [그림]\n④ [그림]\n⑤ [그림]";

/** 🔴 반대쪽 — 보기가 **진짜 글자 다섯**. 그림은 발문 자료다. 잡히면 안 된다. */
const 보기가_글자 =
  "서로 다른 모양의 물병에 시간당 일정한 양의 물을 계속 넣을 때, 시간과 물의 높이 " +
  "사이의 관계를 바르게 연결한 것은?\n\n[그림]\n\n<상자> (가) • (나) • (다) • (라)\n" +
  "<상자> ㉠ ㉡\n\n[그림]\n\n<상자> ㉢\n\n[그림]\n\n" +
  "1. (가)-㉠\n2. (나)-㉡\n3. (다)-㉣\n4. (라)-㉡\n5. (라)-㉢";

const row = (content: string, n: number) => ({
  content,
  figureUrls: Array.from({ length: n }, (_, i) => `/figures/1/q01_${i}.jpeg`),
});

describe("마커를 세는 자 — 앞 자는 연속한 마커를 건너뛰었다", () => {
  it("`1.`~`5.` 가 줄마다 이어져도 다섯을 다 센다", () => {
    expect(choiceMarkers(마커다섯_본문없음).map((m) => m.n)).toEqual([
      1, 2, 3, 4, 5,
    ]);
  });

  it("첫 줄에서 시작하는 마커도 잡는다", () => {
    expect(choiceMarkers("1. 가\n2. 나").map((m) => m.n)).toEqual([1, 2]);
  });

  it("원문자 마커를 숫자와 같은 번호로 센다", () => {
    const m = choiceMarkers(원문자마커);
    expect(m.map((x) => x.n)).toEqual([1, 2, 3, 4, 5]);
    expect(m.every((x) => x.circled)).toBe(true);
  });

  it("수식 안의 숫자를 마커로 오인하지 않는다", () => {
    expect(choiceMarkers("값은?\n$x=1$ 이고 $y=2$ 이다.").length).toBe(0);
  });

  it("`[그림]` 이 든 줄은 «진짜 글자» 로 세지 않는다", () => {
    expect(choiceTextOnly("[그림] 오른쪽 위로 향하는 직선")).toBe("");
    expect(choiceTextOnly("(가)-㉠")).toBe("(가)-㉠");
  });
});

describe("열쇠 — 하나만 쓰면 덜 센다", () => {
  it("㉰ 보기 자리가 그림이면 잡는다 (비었든 설명이 붙었든)", () => {
    expect(keyChoiceIsFigure(features(row(마커다섯_본문없음, 5)))).toBe(true);
    expect(keyChoiceIsFigure(features(row(보기가_그림설명, 5)))).toBe(true);
  });

  it("㉯ 그림 4장 이상인데 보기 다섯이 글자가 아니면 잡는다", () => {
    expect(keyMissingFive(features(row(마커없음, 5)))).toBe(true);
  });

  it("㉱ 보기 다섯이 **한 장에 띠로** 들어온 것도 잡는다 (문턱 아래)", () => {
    expect(keyFewFigures(features(row(원문자마커, 1)))).toBe(true);
    // 앞 자의 한 방향 문턱(그림 4장 이상)으로는 구조적으로 0이 된다
    expect(keyMissingFive(features(row(원문자마커, 1)))).toBe(false);
  });

  it("㉲ 보기가 그림인데 그림 파일이 하나도 없는 것도 잡는다", () => {
    expect(keyNoFigures(features(row(원문자마커, 0)))).toBe(true);
  });
});

describe("부류", () => {
  it("마커 일부만 남은 것을 «보기그림» 으로 본다", () => {
    const v = classifyChoiceFigureRow(row(마커일부만, 5));
    expect(v.klass).toBe("보기그림");
    expect(v.markerState).toBe("일부");
    expect(v.markRel).toBe("표시=그림");
  });

  it("마커가 통째로 없는 것도 «보기그림» 으로 본다", () => {
    const v = classifyChoiceFigureRow(row(마커없음, 5));
    expect(v.klass).toBe("보기그림");
    expect(v.markerState).toBe("없음");
    // 본문에 그림 표시가 하나도 안 남은 부류 — 이 구분이 없으면 회수 경로가 갈리지 않는다
    expect(v.markRel).toBe("표시0");
    expect(v.features.nMark).toBe(0);
  });

  it("🔴 보기가 **진짜 글자 다섯**이면 «보기글자» 다 — 그림은 발문 자료다", () => {
    const v = classifyChoiceFigureRow(row(보기가_글자, 8));
    expect(v.klass).toBe("보기글자");
    expect(v.broken).toBe(false);
  });

  it("그림도 없고 그림 표시도 없으면 이 조사와 «무관» 이다", () => {
    const v = classifyChoiceFigureRow(row("다음을 계산하시오. $1+1$", 0));
    expect(v.klass).toBe("무관");
    expect(inScope(row("다음을 계산하시오. $1+1$", 0))).toBe(false);
  });

  it("«미분류» 를 낼 수 있다 — 규칙에 없는 부류를 0으로 만들지 않는다", () => {
    // 그림 한 장 · 보기 마커 없음 = 서술형에 발문 그림. 갈리지 않는다.
    const v = classifyChoiceFigureRow(
      row("그림과 같은 삼각형의 넓이를 구하시오.", 1),
    );
    expect(v.klass).toBe("미분류");
    expect(v.broken).toBe(false);
  });
});

describe("사정권", () => {
  it("그림이 붙었거나 본문에 그림 표시가 있으면 사정권이다", () => {
    expect(inScope(row("발문", 1))).toBe(true);
    expect(inScope(row("발문 [그림]", 0))).toBe(true);
    expect(inScope(row("발문", 0))).toBe(false);
  });
});
