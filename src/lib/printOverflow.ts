/**
 * 인쇄 넘침 위험 판정 — **잘려도 모르는 것**이 진짜 피해다.
 *
 * 자습 지면은 문항 하나가 고정 높이 반 페이지 박스(본문 1.15 : 연습칸 1)이고
 * `.problemBox` 에 `overflow: hidden` 이 걸려 있다. 장당 문항 수도 2로 고정이라
 * (`JASEUP_GEOMETRY.questionsPerPage`) 긴 문항은 **조용히 잘린 채 인쇄돼** 학생에게
 * 배포된다. 실데이터로 표시 폭 한계 초과 279건(1.4%), 그림 2장 이상 57건이 걸린다.
 *
 * 지면 형태는 원장님 확정 사항(D-07)이라 여기서 바꾸지 않는다.
 * **인쇄를 막지도 않는다** — 원장이 알고 누르게만 한다.
 *
 * ⚠️ 이건 확정이 아니라 **개연성**이다. 정확히 재려면 실제 렌더 높이를 측정해야 하고,
 *    그건 인쇄 미리보기에서만 가능하다. 잘림을 놓치는 것보다 한 번 더 보게 하는 쪽이 낫다.
 */
import type { TestPrintProblem } from "@/components/print/types";
import { displayWidth, fitsTwoColumns } from "@/lib/math/displayWidth";
import { parseProblemContent } from "@/lib/problem/parseProblemContent";

/**
 * 본문 **표시 폭** 한계. 원문 글자 수가 아니다 — 한글·전각은 2, 수식은 글리프 근사로 센다
 * (`displayWidth`, 시험지변환기 `_sol_seg_width` 이식).
 *
 * 값의 근거(실데이터 20,000건, 2026-08-17): 예전 규칙 "원문 500자 초과"가 잡던 279건과
 * **같은 건수**를 잡는 폭이 530이다. 같은 경고량에서 판정만 달라진다 —
 *   · 수식이 많아 원문만 길던 108건은 빠지고(예: 원문 654자 / 폭 430),
 *   · 한글이 많아 **놓치던 107건**이 들어온다(예: 원문 389자 / 폭 554).
 *
 * ⚠️ 임계값을 바꿀 때는 **같은 경고 건수로 맞춰** 비교할 것. 분모가 다르면
 *    "새 규칙이 놓치는 게 없다"는 착시가 생긴다(이번 이식에서 실제로 그랬다).
 *
 * ── 2026-08-18: 임계값은 그대로인데 **자가 바뀌었다** ────────────────────────
 * `displayWidth` 가 연산자 여백을 세기 시작해 같은 문항의 폭이 커졌다
 * (원장님 "보기가 접힌다" 회귀 수리). 그래서 **530 이라는 숫자의 뜻이 바뀌었다**:
 *   경고 건수 605건(1.28%) → **709건(1.50%)**
 * 예전과 **같은 건수**로 맞추려면 한계를 546 으로 올려야 한다.
 * 그런데 올리지 않았다 — 새로 걸린 104건을 눈으로 보니 원문 350~630자짜리
 * **진짜로 긴 문항**이었다(폭 531 표본 전량). 숫자를 다시 맞추면 그 사실이
 * 가려질 뿐이라 그대로 두고, 늘어난 건수를 보고서에 적는다.
 * (CLAUDE.md 2026-08-17: 임계값을 물려받을 때는 분모가 같은지부터 볼 것.)
 */
export const OVERFLOW_WIDTH_LIMIT = 530;

/** 그림이 이 장수 이상이면 세로 공간을 넘길 개연성이 크다. */
export const OVERFLOW_FIGURE_LIMIT = 2;

/* ────────────────────────────────────────────────────────────────────────
 * 줄 수 추정 — 폭 총합이 못 보는 것을 본다
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 문항 열 한 줄에 들어가는 **표시폭**.
 *
 * 근거는 `displayWidth.ts` 의 `TWO_COLUMN_WIDTH_LIMIT` 와 같은 계산이다 —
 * 2열 한 칸(약 147px)이 표시폭 24 이므로 1 단위 ≈ 6.13px 이고,
 * 문항 열 폭 364px 는 약 59 단위다.
 *
 * ⚠️ `.paperParity` 폭 식이나 `JASEUP_GEOMETRY.problemColumns` 를 바꾸면 여기도
 *    같이 바꿔야 한다. 한쪽만 바꾸면 판정이 지면과 조용히 어긋난다.
 */
const COLUMN_UNITS = 59;

/**
 * 상자 하나가 글자 말고 더 먹는 세로 공간을, 줄 수로 환산한 값.
 * 테두리 1px×2 + 안쪽 여백 16px×2 ≈ 34px, 본문 행높이 20px(12.5px × 1.6) → 약 1.7줄.
 * 라벨 줄(`<보기>`)은 따로 센다.
 */
const BOX_CHROME_LINES = 2;

/** 표시폭을 열 폭으로 나눠 줄 수로. 빈 문자열은 0줄이다. */
function linesFor(text: string, unitsPerLine = COLUMN_UNITS): number {
  const width = displayWidth(text);
  if (width <= 0) return 0;
  return Math.ceil(width / unitsPerLine);
}

/**
 * 항목 목록이 차지하는 줄 수. **렌더러와 같은 함수로 열 수를 정한다**
 * (`fitsTwoColumns`) — 둘이 갈라지면 "화면은 1열인데 판정은 2열로 셈"이 된다.
 */
function linesForItems(items: readonly string[]): number {
  if (items.length === 0) return 0;
  if (fitsTwoColumns(items)) {
    // 2열: 두 칸이 한 행. 각 항목이 한 칸에 들어가므로 행마다 1줄.
    return Math.ceil(items.length / 2);
  }
  // 1열: 항목마다 제 폭만큼 줄을 먹는다.
  return items.reduce((sum, item) => sum + Math.max(1, linesFor(item)), 0);
}

/**
 * 문항 본문이 지면에서 차지하는 **줄 수**를 추정한다.
 *
 * 폭 총합(`displayWidth`)과 달리 이 값은 배치를 본다 — 보기가 1열로 내려가거나
 * 상자가 생기면 글자 수가 그대로여도 값이 늘어난다. 2026-08-17 상자·열 수
 * 수리로 실제 지면이 그렇게 바뀌었고, 총합 지표는 그 변화를 한 글자도 못 봤다.
 *
 * 확정이 아니라 **개연성**이다. 정확한 높이는 실제 렌더에서만 나온다.
 */
export function estimateProblemLines(content: string): number {
  const { question, choices } = parseProblemContent(content);

  // `parseProblemContent` 는 상자를 이미 **인용문 마크다운**으로 굳혀 준다
  //   `> <보기2>` / `>` / `> ㄱ. …`
  // 라벨 뒤 숫자가 렌더러가 정한 **열 수**다. 여기서 다시 판단하지 않고 그대로 읽는다 —
  // 판정이 스스로 열 수를 정하면 렌더러와 갈라져 조용히 어긋난다.
  let lines = 0;
  let plain: string[] = [];
  let box: string[] | null = null;

  /**
   * ⚠️ 예전에는 평문 줄을 **한 덩어리로 이어 붙여** 셌다. 그때는 지문이 늘 한 줄
   * (`collapseWhitespace` 가 개행을 다 녹인다)이라 같은 값이었다.
   * 2026-08-18 부터 계산 과정 다단 등식이 **문단으로 갈린다** — 문단마다 제 줄을
   * 차지하므로 따로 세지 않으면 늘어난 세로 공간을 한 줄도 못 본다.
   * (문단 사이 여백 `prose-p:my-2` 는 위아래가 겹쳐 약 8px = 0.4줄이라 따로 세지 않는다.)
   */
  const flushPlain = () => {
    if (plain.length === 0) return;
    for (const part of plain) lines += Math.max(1, linesFor(part));
    plain = [];
  };
  const flushBox = () => {
    if (box === null) return;
    // 문단(빈 `>` 줄로 나뉜 덩어리)으로 나눈다. 첫 문단이 라벨이다.
    const paras = box
      .join("\n")
      .split(/\n\s*\n/)
      .map((part) => part.trim())
      .filter(Boolean);
    const header = paras[0] ?? "";
    const items = paras.slice(1);
    const cols = Number(header.match(/(\d+)\s*[>〉】］\]]/)?.[1] ?? 1);

    lines += BOX_CHROME_LINES + 1; // 테두리·여백 + 라벨 줄
    if (cols >= 2) {
      // 2열은 항목이 전부 한 칸에 들어갈 때만 선택된다(`fitsTwoColumns`).
      lines += Math.ceil(items.length / cols);
    } else {
      lines += items.reduce(
        (sum, item) => sum + Math.max(1, linesFor(item)),
        0,
      );
    }
    box = null;
  };

  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      flushPlain();
      if (box === null) box = [];
      box.push(line.replace(/^>\s?/, ""));
      continue;
    }
    flushBox();
    if (line) plain.push(line);
  }
  flushPlain();
  flushBox();

  lines += linesForItems(choices);
  return lines;
}

/**
 * 반 페이지 문항 칸에 들어가는 줄 수의 한계.
 *
 * 값의 근거 (실데이터 47,152건, `scripts/qa/calibrate-overflow-lines.ts`):
 * 폭 규칙(530)이 잡는 건수와 **같은 규모**가 되는 줄 수 한계가 **14** 다.
 * 즉 **엄격도를 그대로 두고 보는 것만 바꿨다.**
 *
 * 2026-08-18 재보정(연산자 여백을 세게 된 뒤) — 한계 14 는 그대로가 최선이다:
 *   폭 규칙 709건 · 줄 수 한계 14 → 623건 (13 은 949, 15 는 415 로 더 멀다)
 *   줄 수 경고가 늘어난 내역: 593(기준) → 600 계산 과정 문단 분리
 *  *   → 601 마커 없는 조건 상자 52개 → 623 세부 문항 줄바꿈 1,783문항.
 *   셋 다 **지면이 실제로 세로로 길어진** 것이라 경고가 느는 게 맞다.
 *
 * ⚠️ 임계값을 바꿀 때는 `OVERFLOW_WIDTH_LIMIT` 주석과 같은 규칙을 지킬 것 —
 *    **같은 경고 건수로 맞춰** 비교한다. 분모가 다르면 "새 규칙이 더 잡는다"가
 *    임계값을 낮춰서 생긴 착시인지 배치가 실제로 높아져서인지 갈리지 않는다.
 */
export const OVERFLOW_LINE_LIMIT = 14;

export interface OverflowRisk {
  /** 지면에 찍히는 문항 번호(1부터). 배열 위치가 아니다 — 원장이 지면에서 찾는 번호다. */
  number: number;
  problemId: string;
  reasons: string[];
}

export function assessOverflowRisk(
  problems: TestPrintProblem[],
): OverflowRisk[] {
  const risks: OverflowRisk[] = [];

  problems.forEach((problem, index) => {
    const reasons: string[] = [];
    if (displayWidth(problem.content) > OVERFLOW_WIDTH_LIMIT)
      reasons.push("본문이 길다");
    // 폭 총합이 못 보는 배치(상자·보기 1열)를 줄 수로 따로 본다.
    // 같은 문항이 둘 다에 걸리면 사유를 겹쳐 적지 않는다 — 원장이 읽을 문장이다.
    if (
      !reasons.length &&
      estimateProblemLines(problem.content) > OVERFLOW_LINE_LIMIT
    )
      reasons.push("배치가 높다(상자·보기 1열)");
    if ((problem.figureUrls?.length ?? 0) >= OVERFLOW_FIGURE_LIMIT)
      reasons.push("그림이 여러 장이다");

    if (reasons.length) {
      risks.push({ number: index + 1, problemId: problem.id, reasons });
    }
  });

  return risks;
}
