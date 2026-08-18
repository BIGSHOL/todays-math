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
  /** 첫 장 문항 칸 — 머리글 + 핵심 개념 상자만큼 좁다. */
  firstPageSlot: 405,
  /** 이어지는 장 문항 칸. */
  continuationSlot: 484,
  /** 본문 행높이 — 12.5px × `leading-relaxed` 1.625. */
  line: 20.3125,
  /** 문항번호(18px + 마진 6px) + 정답란(마진 8px + 30.5px) — 본문과 무관하게 늘 붙는다. */
  fixedChrome: 62.5,
  /** 문항 열(`1.15fr`) 폭. 그림·본문이 놓이는 가로다. */
  problemColumn: 363.5,
  /** 인쇄 그림 폭 상한 — `print:max-w-[70mm]` (70mm × 96dpi / 25.4). */
  figureMaxWidth: 264.567,
  /** 그림 묶음 위 여백 `mt-3`. */
  figureBlockTop: 12,
  /** 그림 사이 간격 `gap-4` (가로·세로 모두). */
  figureGap: 16,
} as const;
