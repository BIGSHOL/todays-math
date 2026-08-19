/**
 * 「보기가 그림인데 번호와 그림이 이어지지 않는」 문항의 **판정 규칙 한 곳**.
 *
 * 보고서·회수기·테스트가 **같은 파일 하나**를 본다 (CLAUDE.md 2026-08-18
 * «목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다»).
 *
 * ## 앞선 자(`report-choice-figures.ts`)를 대체하지 않는다 — 늘려 쓴다
 *
 * 앞 자는 열쇠 둘로 **134건**을 냈다. 그 숫자는 `legacyKeys()` 로 그대로 재현된다.
 * 여기서는 브리프가 지목한 «구조적으로 못 보는 것» 세 가지를 열쇠로 더한다.
 *
 *   ㉮ (기존) 보기 항목이 있는데 «비었거나 `[그림]` 뿐»
 *   ㉯ (기존) 그림 4장 이상인데 «번호 붙은 보기 다섯»이 없다
 *   ㉰ 보기 자리가 `[그림] <설명>` — 글자는 있는데 그 글자가 **그림 설명**이다
 *   ㉱ 그림이 3장 이하인데 보기가 그림 — RPM 이관본의 «띠로 이어 붙은 보기»
 *   ㉲ 보기가 그림인데 `figureUrls` 가 **비어 있다** (16 §그림 유실과 겹친다)
 *
 * ## 마커를 세는 자를 바꿨다 — 앞 자는 **덜 셌다**
 *
 * `report-choice-figures.ts` 의 `choiceTexts` 는 `/(?:^|\n)\s*([1-5])\.\s*(.*)$/gm`
 * 을 쓴다. `\s*` 가 **다음 줄의 개행까지 먹어** 연속한 마커가 겹쳐 건너뛰어진다.
 * 실측: `1.\n2.\n3.\n4.\n5.` 인 문항이 **3개**로 세어졌다(`023da415`).
 * 여기서는 **제품이 실제로 보는 정규식**(`parseProblemContent` 의
 * `CHOICE_AT_LINE_START`)과 같은 모양을 쓴다 — 지면이 보는 것을 세야 한다.
 *
 * ## 반대쪽을 반드시 낸다
 *
 * `보기글자`(보기가 진짜 글자라 멀쩡한 문항)와 `미분류`를 **같이** 낸다.
 * 「그림이 붙어 있는데 «보기그림» 이 나오면 안 된다」를 물을 수 있어야 한다
 * (CLAUDE.md 2026-08-18 «판정기는 반대쪽 모집단에 대 보라»).
 */

import {
  BODY_CHOICE_CLASS,
  BODY_CHOICE_MARKS,
} from "../../src/lib/math/circledNumber";

export interface ChoiceFigureRow {
  content: string;
  figureUrls: readonly string[];
}

/** 제품(`parseProblemContent`)이 보기 마커로 인정하는 것과 같은 모양. */
const CHOICE_AT_LINE_START = new RegExp(
  // 본문 마커라 **일부러 좁다** — `circledNumber.ts` 머리 주석 참조.
  String.raw`\n[ \t]*(?:([1-9][0-9]?)[.)][ \t]+|([${BODY_CHOICE_CLASS}])[ \t]*)`,
  "g",
);

const CIRCLED = BODY_CHOICE_MARKS.slice(0, 10);
const FIGURE_MARK = /\[그림\]/g;

export interface ChoiceMarker {
  /** 보기 번호 1~10. */
  n: number;
  /** 원문자로 찍혔는가 — 브리프가 「확인하라」고 한 부류. */
  circled: boolean;
  /** 마커 뒤 본문 (다음 마커 전까지). */
  body: string;
}

/**
 * 본문의 보기 마커와 그 본문.
 *
 * ⚠️ 앞머리에 `\n` 을 붙여 **첫 줄의 마커도** 잡는다. 제품 정규식은 `\n` 으로
 * 시작하므로 원문 그대로 넣으면 첫 줄이 빠진다.
 */
export function choiceMarkers(content: string): ChoiceMarker[] {
  const text = "\n" + (content ?? "").replace(/\r\n?/g, "\n");
  const found = [...text.matchAll(CHOICE_AT_LINE_START)];
  return found.map((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < found.length ? found[i + 1].index! : text.length;
    const circled = m[2] !== undefined;
    return {
      n: circled ? CIRCLED.indexOf(m[2]!) + 1 : Number(m[1]),
      circled,
      body: text.slice(start, end).trim(),
    };
  });
}

/** 보기 본문에서 그림 표시와 그 뒤 설명을 걷어낸 «진짜 글자». */
export function choiceTextOnly(body: string): string {
  return body
    .split("\n")
    .map((line) => (line.includes("[그림]") ? "" : line))
    .join(" ")
    .replace(/\s/g, "");
}

export interface ChoiceFigureFeatures {
  /** 붙은 그림 장수. */
  nFig: number;
  /** 본문에 남은 `[그림]` 표시 수. */
  nMark: number;
  /** 1~5 범위의 보기 마커 (중복 제거 전 그대로). */
  markers: ChoiceMarker[];
  /** 그중 «진짜 글자»가 있는 것. */
  nFilled: number;
  /** 보기 자리가 그림인 것 (`[그림]` 을 품은 보기). */
  nFigureChoices: number;
  /** 원문자 마커가 하나라도 있는가. */
  anyCircled: boolean;
}

export function features(row: ChoiceFigureRow): ChoiceFigureFeatures {
  const content = row.content ?? "";
  const markers = choiceMarkers(content).filter((m) => m.n >= 1 && m.n <= 5);
  return {
    nFig: row.figureUrls?.length ?? 0,
    nMark: (content.match(FIGURE_MARK) ?? []).length,
    markers,
    nFilled: markers.filter((m) => choiceTextOnly(m.body).length > 0).length,
    nFigureChoices: markers.filter((m) => m.body.includes("[그림]")).length,
    anyCircled: markers.some((m) => m.circled),
  };
}

/* ── 열쇠 ──────────────────────────────────────────────────────────────── */

/** ㉰ 보기 자리가 그림이다 — 비었든 `[그림] <설명>` 이든. */
export function keyChoiceIsFigure(f: ChoiceFigureFeatures): boolean {
  if (f.markers.length === 0) return false;
  const figureish = f.markers.filter(
    (m) => m.body.includes("[그림]") || choiceTextOnly(m.body).length === 0,
  ).length;
  return figureish >= 2;
}

/**
 * ㉱ 그림이 3장 이하인데 보기가 그림.
 *
 * 앞 자는 `figureUrls.length >= 4`(㉯) · `>= 3`(㉮)라는 **한 방향 문턱**을 쓴다.
 * 보기 다섯이 **한 장에 띠로** 들어온 이관본은 그 문턱 아래로 떨어져 구조적으로 0이 된다.
 */
export function keyFewFigures(f: ChoiceFigureFeatures): boolean {
  return f.nFig >= 1 && f.nFig <= 3 && keyChoiceIsFigure(f);
}

/** ㉲ 보기가 그림인데 그림 파일이 하나도 없다. */
export function keyNoFigures(f: ChoiceFigureFeatures): boolean {
  return f.nFig === 0 && keyChoiceIsFigure(f);
}

/**
 * ㉯ (기존) 그림 4장 이상인데 «번호 붙은 보기 다섯»이 없다.
 *
 * 마커를 세는 자만 고쳤다 — 앞 자의 겹침 결함 때문에 이 값이 달라질 수 있다.
 * 얼마나 달라지는지는 보고서가 **둘 다** 싣는다.
 */
export function keyMissingFive(f: ChoiceFigureFeatures): boolean {
  return f.nFig >= 4 && f.nFilled < 5;
}

/* ── 부류 ──────────────────────────────────────────────────────────────── */

export type ChoiceFigureClass =
  | "보기그림" // 보기 자리가 그림이다 — 이 조사의 대상
  | "보기글자" // 보기가 진짜 글자다 — 그림은 발문 자료다 (반대쪽 모집단)
  | "미분류" // 갈리지 않는다 — **반드시 눈으로 본다**
  | "무관"; // 그림도 없고 보기에 그림 표시도 없다 — 이 조사의 사정권 밖

/**
 * 사정권 — 그림이 붙었거나 본문에 그림 표시가 있는 문항.
 *
 * 이 울타리가 없으면 «미분류»가 「보기 없는 서술형」으로 가득 차 9,915건이 된다
 * (실측). 그러면 눈으로 볼 수 없고, 볼 수 없는 미분류는 없는 것과 같다.
 */
export function inScope(row: ChoiceFigureRow): boolean {
  return (
    (row.figureUrls?.length ?? 0) > 0 || (row.content ?? "").includes("[그림]")
  );
}

export interface ChoiceFigureVerdict {
  broken: boolean;
  klass: ChoiceFigureClass;
  /** 어느 열쇠가 걸렸나 — 한 숫자로 뭉개지 않는다. */
  keys: string[];
  /** 마커 잔존 상태. */
  markerState: "없음" | "일부" | "다섯";
  /** 표시 수와 그림 수의 관계. */
  markRel: "표시0" | "표시=그림" | "표시<그림" | "표시>그림";
  features: ChoiceFigureFeatures;
}

export function classifyChoiceFigureRow(
  row: ChoiceFigureRow,
): ChoiceFigureVerdict {
  const f = features(row);
  const keys: string[] = [];
  if (keyChoiceIsFigure(f)) keys.push("㉰보기가그림");
  if (keyMissingFive(f)) keys.push("㉯다섯없음");
  if (keyFewFigures(f)) keys.push("㉱그림3장이하");
  if (keyNoFigures(f)) keys.push("㉲그림없음");

  const markerState =
    f.markers.length === 0 ? "없음" : f.nFilled >= 5 ? "다섯" : "일부";
  const markRel =
    f.nMark === 0
      ? "표시0"
      : f.nMark === f.nFig
        ? "표시=그림"
        : f.nMark < f.nFig
          ? "표시<그림"
          : "표시>그림";

  // 보기가 **진짜 글자 다섯**이면 멀쩡한 문항이다 — 그림은 발문 자료다.
  const choicesAreText = f.nFilled >= 5 && f.nFigureChoices === 0;

  let klass: ChoiceFigureClass;
  if (keys.length > 0) klass = "보기그림";
  else if (!inScope(row)) klass = "무관";
  else if (choicesAreText) klass = "보기글자";
  else if (f.nFig >= 4 && f.nFilled < 5) klass = "보기그림";
  else if (f.markers.length >= 2 && f.nFilled >= 2) klass = "보기글자";
  else klass = "미분류";

  return {
    broken: klass === "보기그림",
    klass,
    keys,
    markerState,
    markRel,
    features: f,
  };
}
