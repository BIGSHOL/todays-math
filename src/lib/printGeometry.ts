export const JASEUP_GEOMETRY = {
  questionsPerPage: 2,
  pagePadding: {
    first: "36px 50px 20px",
    continuation: "24px 50px 20px",
  },
  problemColumns: "1.15fr 1fr",
  scratchGridSize: 16,
  answerEntriesPerPage: 8,
} as const;

/**
 * 지면 **실측** 치수 (Chromium · 인쇄 매체 · 실제 KaTeX/Tailwind/TestPrint CSS).
 *
 * 왜 여기 있나: 넘침 판정(`printOverflow.ts`)의 한계값은 **이 칸 높이에서 유도**한다.
 * 예전에는 폭 규칙과 «경고 건수»를 맞춘 숫자였다 — 자가 없을 때 쓰던 임시방편이라
 * 지면이 바뀌어도 판정은 몰랐다(적대적 리뷰 ③ §6).
 *
 * ⚠️ `TestPrint.module.css` 나 `JASEUP_GEOMETRY` 를 바꾸면 이 값은 **다시 재야 한다.**
 *    손으로 고치지 말 것 — `npx tsx scripts/qa/measure-paper-units.tsx` 가 뽑는다.
 *
 * ⚠️ 첫 장과 이어지는 장이 **79px 다르다.** 첫 장에는 머리글과 「◆ 핵심 개념 정리」
 *    상자가 얹히기 때문이다. 판정이 이걸 모르면 «같은 문항이 1·2번이면 겹치고
 *    3번이면 멀쩡»해진다(실측 첫 장에서만 넘치는 문항 3,216건).
 */
export const JASEUP_MEASURED_PX = {
  /** 첫 장 문항 칸 — 머리글 + 핵심 개념 상자만큼 좁다 (그 장에 문항이 **둘**일 때). */
  firstPageSlot: 405,
  /** 이어지는 장 문항 칸 (그 장에 문항이 **둘**일 때). */
  continuationSlot: 484,
  /**
   * 그 장에 문항이 **하나뿐**일 때의 칸 — 두 배가 넘는다.
   *
   * `.problemItem` 은 `flex: 1 1 0%` 라 칸을 «그 장의 문항 수»로 나눠 갖는다.
   * 문항 수가 홀수인 시험지의 **마지막 문항**이 늘 이 자리다(25문항이면 25번).
   * 판정이 이걸 모르면 그 한 문항을 **실제 칸의 절반**으로 재서 헛경고한다
   * (적대적 리뷰 ④ B). 실측: 이어지는 장 997px · 첫 장 838px.
   */
  soloContinuationSlot: 997,
  soloFirstPageSlot: 838,
  /** 본문 행높이 — 12.5px × `leading-relaxed` 1.625. */
  line: 20.3125,
  /** 문항번호(18px + 마진 6px) + 정답란(마진 8px + 30.5px) — 본문과 무관하게 늘 붙는다. */
  fixedChrome: 62.5,
  /** 표시폭 1단위의 px — 한글 한 글자(12.5px)가 표시폭 2 다(`displayWidth`). */
  unit: 6.25,
  /** 문항 열(`1.15fr`) 폭. 그림·본문이 놓이는 가로다. */
  problemColumn: 363.5,
  /**
   * 1열 보기의 **글자칸** 폭. 문항 열보다 좁다 — 마커(①)와 `gap-1.5` 를 뺀 몫이다.
   * 셋(문항 열·보기 글자칸·상자 항목칸)을 같은 폭으로 보면 보기·상자에서 덜 센다.
   */
  choiceTextColumn: 345,
  /** 상자 항목칸 폭. `p-4` 와 테두리를 뺀 몫이라 가장 좁다. */
  boxItemColumn: 329.5,
  /**
   * 상자 하나가 **글자 말고** 먹는 세로 — 테두리·안쪽 여백·`my-4` 바깥 마진
   * **그리고 라벨 줄(`<보기>`)까지** 포함한 값이다(실측 98.0px = 4.82줄).
   * 머리 없는 상자(`<나열>`)는 라벨 줄이 없으므로 한 줄을 뺀다.
   */
  boxChrome: 98,
  /** 보기 그리드 위 여백 `mt-4`. */
  choiceGridTop: 16,
  /** 보기 행 사이 간격 `gap-y-2`. */
  choiceRowGap: 8,
  /** 인쇄 그림 폭 상한 — `print:max-w-[70mm]` (70mm × 96dpi / 25.4). */
  figureMaxWidth: 264.567,
  /** 그림 묶음 위 여백 `mt-3`. */
  figureBlockTop: 12,
  /** 그림 사이 간격 `gap-4` (가로·세로 모두). */
  figureGap: 16,

  /* ── 정답지 (`.answerPage`) ─────────────────────────────────────────────── */

  /** 「빠른 정답」 상자가 없는 쪽의 해설 칸(`.answerSolutions`) 높이. */
  answerSolutionsFull: 964.8,
  /** 해설은 2단이다 (`column-count: 2`) — 한 쪽에 담기는 세로는 칸 높이 × 2. */
  solutionColumns: 2,
  /** 해설 한 단의 폭. */
  solutionColumnWidth: 331,
  /** 해설 본문 행높이 — 11.5px × 1.55. */
  solutionLine: 17.825,
  /** 「빠른 정답」 상자의 제목 줄 + 안팎 여백 (행 수와 무관한 고정분). */
  quickAnswerTitle: 49,
  /** 그 상자의 행 사이 간격 (`gap: 6px`). */
  quickAnswerRowGap: 6,
  /** 그 상자의 열 수 (`repeat(4, minmax(0,1fr))`). */
  quickAnswerColumns: 4,
  /** 셀 한 칸의 글자 아닌 세로 (`padding: 8px 8px 6px`). */
  quickAnswerCellBase: 14,
  /** 셀 한 줄 높이 — 11px × `line-height: 2.1`. */
  quickAnswerCellLine: 23.1,
  /**
   * 셀 한 줄에 들어가는 표시폭. 셀 안폭 약 153px 에서 「문 N」 라벨과 간격을 뺀
   * 몫이라 좁다 — **정답이 조금만 길어도 두 줄이 된다**, 그게 상자가 커지는 이유다.
   * (실측: 25문항 상자가 정답 내용에 따라 344~668px 로 갈린다.)
   */
  quickAnswerCellUnits: 16,
  /** 상자와 해설 칸 사이 여백. */
  quickAnswerGap: 16.5,
} as const;
