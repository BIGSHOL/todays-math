/**
 * 🟢 회귀 가드 — 「어느 칸에도 안 들어가는 문항」 부류 판정.
 *
 * ## 왜 이 파일이 있는가
 *
 * 조사(2026-08-18, `docs/planning/tracks/reports/oversize-problems.md`)에서 판정
 * 규칙이 **두 번** 거꾸로 걸렸다. 둘 다 실데이터를 눈으로 봐서 찾았고, 문서·리뷰로는
 * 하나도 안 나왔다. 그래서 그때 틀렸던 **바로 그 문항**을 픽스처로 박아 둔다.
 *
 *  1. 「그림이 7장 넘으면 해설 그림이 섞인 것」 — 한 방향 임계값이라, **7장이 정상인**
 *     문항(구암고 21번 「그림 ㉠~㉦ 중 고르시오」·구암중 16번 「물병 4 + 그래프 4」)이
 *     해설 그림 20장짜리와 같은 칸에 들어갔다. 본문이 그만큼을 **가리키고 있는가**를
 *     같이 봐야 갈린다.
 *  2. 「보기 한 벌이 둘이면 문항이 둘」 — 옆 문항의 **보기 조각만** 딸려 온 행이
 *     「시험지가 통째로 들어온」 행과 같은 부류가 됐다. 셋 이상일 때만 병합으로 본다.
 *
 * 그리고 `figureBlockPxAt` 는 제품 `estimateFigureBlockPx` 를 **옮겨 적은** 규칙이다.
 * 옮겨 적은 것은 갈라진다 — 폭 상한을 제품 값으로 두면 두 함수가 **한 값**이어야 한다.
 */
import { describe, expect, it } from "vitest";

import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { estimateFigureBlockPx } from "@/lib/printOverflow";
import {
  capForColumns,
  classifyOversize,
  estimateProblemCount,
  figureBlockPxAt,
  readSignals,
} from "../../../scripts/qa/oversizeRules";

/** 실측 넘침 문항에서 그대로 따온 본문 조각들. */
const 그림7장이_정상 =
  "다음에 주어진 그림 ㉠, ㉡, ㉢, ㉣,\n㉤, ㉥, ㉦은 실수 전체에서 연속인\n" +
  "함수 $y=f_{n}(x)$의 도함수의 그래프이다.\n㉠\n㉡\n㉢\n㉣\n㉤\n㉥\n㉦";
const 그림8장이_정상 =
  "서로 다른 모양의 물병에 시간당 일정한 양의 물을 계속 넣을 때, 시간과 물의 높이 " +
  "사이의 관계를 바르게 연결한 것은?\n<상자> (가) • (나) • (다) • (라)\n" +
  "<상자> ㉠ ㉡\n[그림]\n<상자> ㉢\n[그림]\n<상자> ㉣\n1. (가)-㉠\n2. (나)-㉡";
const 해설그림이_섞임 =
  "여학생 $2$명과 남학생 $4$명이 있다. 이 $6$명의 학생이 일렬로 나열된 $7$개의 " +
  "의자에 다음 조건을 만족시키도록 모두 앉는 경우의 수는?\n" +
  "(가) 여학생 끼리는 이웃하지 않는다.\n(나) 두 학생 사이에 빈 의자가 있는 경우는 " +
  "이웃하지 않는 것으로 한다.\n1. $164$\n2. $450$\n3. $720$\n4. $1800$\n5. $3600$";

describe("readSignals — 본문이 무엇을 말하고 있는가", () => {
  it("그림 라벨은 **서로 다른 것만** 센다", () => {
    // ㉠ 이 발문과 항목에 두 번 나와도 그림 두 장이 아니다.
    expect(readSignals("㉠ 를 보시오. ㉠\n㉡").figureRefs).toBe(2);
  });

  it("하위문항 ⑴⑵⑶ 과 보기 마커 ①②③ 은 그림 라벨이 아니다", () => {
    expect(readSignals("⑴ 첫째 ⑵ 둘째 ⑶ 셋째 ① ② ③").figureRefs).toBe(0);
  });

  it("묶음 지시문 `[11~12]` 는 수식 기호가 끼어도 잡는다", () => {
    expect(readSignals("[$11$~$12$] 그림은 …").bundleHeads).toBe(1);
    expect(readSignals("[11~12] 그림은 …").bundleHeads).toBe(1);
  });

  it("시험지 머리말은 「2024년 1학기 중간고사」와 「25년 2학기 기말고사」 둘 다 잡는다", () => {
    expect(readSignals("2024년 1학기 중간고사대서중 2학년").paperHeaders).toBe(
      1,
    );
    expect(
      readSignals("경암중 26년 1학기 기말고사 대비 (수학)").paperHeaders,
    ).toBe(1);
  });

  it("base64 덩어리는 개수와 **본문에서 차지하는 몫**을 같이 낸다", () => {
    const junk =
      "6HnK9yMnBIPm5CG3eYi0uG6WC6aCRuQ9mdLAb7Djyd5kJbG8w3v80q9XkwxnfkTm1AOy";
    const s = readSignals(`두 점 $(a-3,3)$ $${junk}$=를 지나는`);
    expect(s.base64Runs).toBe(1);
    expect(s.base64Share).toBeGreaterThan(0.5);
  });
});

describe("estimateProblemCount — 한 행에 문항이 몇 개인가", () => {
  it("보기 한 벌뿐이면 한 문항", () => {
    expect(estimateProblemCount(readSignals("물음?\n1. 가\n5. 마"))).toBe(1);
  });

  it("보기가 세 벌이면 세 문항", () => {
    expect(
      estimateProblemCount(readSignals("가?\n5. 마\n나?\n5. 마\n다?\n5. 마")),
    ).toBe(3);
  });

  it("묶음 지시문이 있으면 뒤에 최소 하나가 더 붙어 있다", () => {
    expect(
      estimateProblemCount(readSignals("물음?\n5. 마\n[11~12] 그림은")),
    ).toBe(2);
  });
});

describe("classifyOversize — 왜 긴가", () => {
  const 그림지배 = { figurePx: 900, neededPx: 1000 };

  it("🔴 그림이 일곱 장이어도 **본문이 그만큼을 가리키면** 과수집이 아니다", () => {
    // 이 규칙이 없으면 「그림 ㉠~㉦」이 해설 그림 20장짜리와 같은 부류가 된다.
    expect(
      classifyOversize({ content: 그림7장이_정상, figureCount: 7, ...그림지배 })
        .klass,
    ).toBe("그림이 지면을 먹는다 — 본문은 짧다");
    expect(
      classifyOversize({ content: 그림8장이_정상, figureCount: 8, ...그림지배 })
        .klass,
    ).toBe("그림이 지면을 먹는다 — 본문은 짧다");
  });

  it("🔴 본문이 안 가리키는 그림이 일곱 장이면 과수집이다", () => {
    // 운암고 14번 — 의자 삽화가 일곱 조각으로 쪼개져 붙었다. 본문은 그림을 안 부른다.
    expect(
      classifyOversize({
        content: 해설그림이_섞임,
        figureCount: 7,
        ...그림지배,
      }).klass,
    ).toBe("그림 과수집 — 해설 그림까지 붙었다");
  });

  it("🔴 보기 한 벌이 더 붙은 것은 «병합»이 아니라 «꼬리 오염»이다", () => {
    const 꼬리 = "물음?\n1. 가\n5. 마\n2024년 1학기 기말고사제일중 3학년 수학";
    expect(
      classifyOversize({ content: 꼬리, figureCount: 6, ...그림지배 }).klass,
    ).toBe("꼬리 오염 — 옆 문항·머리말이 딸려 옴");
  });

  it("시험지가 통째로 들어온 행은 병합이다", () => {
    const 병합 = "가?\n5. 마\n나?\n5. 마\n다?\n5. 마\n라?\n5. 마";
    expect(
      classifyOversize({
        content: 병합,
        figureCount: 0,
        figurePx: 0,
        neededPx: 4323,
      }).klass,
    ).toBe("문항 병합 — 시험지가 한 행에");
  });

  it("🔴 병합의 경계는 **둘이 아니라 셋**이다", () => {
    // 둘이면 「옆 문항 하나가 딸려 온 것」이라 꼬리를 자르면 되고,
    // 셋부터가 「시험지가 통째로」다 — 재추출이 아니면 못 고친다.
    const 둘 = "가?\n5. 마\n나?\n5. 마";
    const 셋 = "가?\n5. 마\n나?\n5. 마\n다?\n5. 마";
    const 칸 = { figureCount: 0, figurePx: 0, neededPx: 1200 };
    expect(classifyOversize({ content: 둘, ...칸 }).problemCount).toBe(2);
    expect(classifyOversize({ content: 셋, ...칸 }).problemCount).toBe(3);
    expect(classifyOversize({ content: 둘, ...칸 }).klass).toBe(
      "꼬리 오염 — 옆 문항·머리말이 딸려 옴",
    );
    expect(classifyOversize({ content: 셋, ...칸 }).klass).toBe(
      "문항 병합 — 시험지가 한 행에",
    );
  });

  it("본문의 태반이 base64 면 그것이 먼저다", () => {
    const junk =
      "6HnK9yMnBIPm5CG3eYi0uG6WC6aCRuQ9mdLAb7Djyd5kJbG8w3v80q9XkwxnfkTm1AOy";
    expect(
      classifyOversize({
        content: `두 점 $(a-3,3)$ $${junk}$= $${junk}$=`,
        figureCount: 0,
        figurePx: 0,
        neededPx: 1004,
      }).klass,
    ).toBe("본문 오염 — base64");
  });

  it("그림이 없고 글만 길면 «본문이 정말 길다»", () => {
    expect(
      classifyOversize({
        content: "가".repeat(600),
        figureCount: 0,
        figurePx: 0,
        neededPx: 1100,
      }).klass,
    ).toBe("본문이 정말 길다");
  });

  it("🔴 그림이 **있어도** 높이를 안 먹으면 그림 탓이 아니다", () => {
    // 시지중 12번 — 그림 2장이 151px 뿐이고 상자 690px 이 지면을 먹는다.
    // 「그림이 하나라도 있으면 그림 탓」으로 두면 이 부류가 통째로 사라진다.
    expect(
      classifyOversize({
        content: "가".repeat(600),
        figureCount: 2,
        figurePx: 151,
        neededPx: 1158,
      }).klass,
    ).toBe("본문이 정말 길다");
  });

  it("어느 규칙에도 안 걸리면 «미분류» 를 낸다 — 조용히 삼키지 않는다", () => {
    expect(
      classifyOversize({
        content: "짧은 물음?",
        figureCount: 0,
        figurePx: 0,
        neededPx: 1000,
      }).klass,
    ).toBe("미분류");
  });
});

describe("figureBlockPxAt — 옮겨 적은 규칙이 제품과 갈라지지 않는가", () => {
  const 표본: ({ width: number; height: number } | null)[][] = [
    [{ width: 335, height: 336 }],
    Array.from({ length: 6 }, () => ({ width: 335, height: 336 })),
    Array.from({ length: 5 }, (_, i) => ({ width: 200 + i * 40, height: 300 })),
    [{ width: 1083, height: 974 }, null, { width: 176, height: 152 }],
    [null, null],
  ];

  it("폭 상한을 제품 값으로 두면 `estimateFigureBlockPx` 와 **한 값**이다", () => {
    for (const figures of 표본)
      expect(figureBlockPxAt(figures, JASEUP_MEASURED_PX.figureMaxWidth)).toBe(
        estimateFigureBlockPx(figures),
      );
  });

  it("상한을 좁히면 낮아진다 — 좁힐수록 단조롭게", () => {
    const figures = Array.from({ length: 6 }, () => ({
      width: 335,
      height: 336,
    }));
    const 현행 = figureBlockPxAt(figures, JASEUP_MEASURED_PX.figureMaxWidth);
    const 두열 = figureBlockPxAt(figures, capForColumns(2));
    const 세열 = figureBlockPxAt(figures, capForColumns(3));
    expect(두열).toBeLessThan(현행);
    expect(세열).toBeLessThan(두열);
  });

  it("🔴 `capForColumns(k)` 는 **딱 k 장이 한 줄에 들어가는** 최대 폭이다", () => {
    // 실제로 46mm(173.86px)로 재 보니 두 장이 363.72px 이라 **한 장씩** 접혔다.
    // 0.2px 차이로 정책이 통째로 무효가 된다 — 경계를 테스트가 잡는다.
    const { problemColumn, figureGap } = JASEUP_MEASURED_PX;
    for (const k of [2, 3, 4]) {
      const cap = capForColumns(k);
      expect(cap * k + figureGap * (k - 1)).toBeCloseTo(problemColumn, 6);
      // 한 톨만 넓어도 그 줄에 k 장이 안 들어간다.
      expect((cap + 0.1) * k + figureGap * (k - 1)).toBeGreaterThan(
        problemColumn,
      );
    }
  });

  it("🔴 46mm 는 두 장이 **안** 들어가고 45mm 는 들어간다 (실측으로 확인한 경계)", () => {
    const mm = (n: number) => (n * 96) / 25.4;
    const 여섯장 = Array.from({ length: 6 }, () => ({
      width: 335,
      height: 336,
    }));
    // 46mm — 두 장이 363.72px 로 문항 열(363.5px)을 넘는다 → 여섯 줄.
    expect(figureBlockPxAt(여섯장, mm(46))).toBeGreaterThan(1000);
    // 45mm — 두 장이 356.2px 라 들어간다 → 세 줄.
    expect(figureBlockPxAt(여섯장, mm(45))).toBeLessThan(600);
  });
});
