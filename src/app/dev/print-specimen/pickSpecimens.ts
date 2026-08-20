/**
 * 실물 검수 **견본지**에 실을 표본을 고른다 — 고르는 규칙만, 그리는 것은 화면이 한다.
 *
 * ## 왜 「골라서」 싣나
 *
 * 절대 규칙 6 은 「실물 프린터 출력 검수까지가 완료 조건」인데, `/dev/print-check` 는
 * **무엇을 봐야 하는지**만 적혀 있고 **볼 것 자체**는 없다. 시험지를 뽑아 보라고
 * 해도 그림 관련 항목 넷은 **한 시험지에 다 나오지 않는다** — 벡터로 바뀐 문항,
 * mm 를 아는 문항, 배경이 흰 그림, 300dpi 재크롭본은 서로 다른 문항이다.
 * 그래서 넷이 **한 장에 다 나오게** 표본을 고른다.
 *
 * ## 🔴 견본은 «같은 크기»로 놓아야 견줄 수 있다
 *
 * 벡터 ↔ 래스터를 나란히 놓을 때 크기가 다르면 **또렷함이 아니라 크기를 보게 된다.**
 * 둘 다 같은 `sourceMm` 으로 그린다 — 그 값은 제품과 같은 함수(`figureWidthStyle`)가
 * 쓴다. 견본이 제품과 다른 자로 그리면 「본 것」과 「나가는 것」이 갈라진다.
 */

/** 되돌리기 원장 한 행 (`scripts/qa/reports/figure-svg-adopt.json`). */
export interface AdoptRow {
  id: string;
  beforeUrls: string[];
  beforeDims: number[];
  afterUrls: string[];
  afterDims: number[];
}

/** 300dpi 재크롭 원장 한 행 (`scripts/qa/reports/figure-swap-ledger.json`). */
export interface SwapRow {
  url: string;
  oldPx: [number, number];
  newPx: [number, number];
}

export interface ProblemFigure {
  id: string;
  problemCode: string;
  figureUrls: string[];
  figureDims: number[];
  figureSourceMm: number[];
}

export interface SvgSpecimen {
  problemCode: string;
  /** 옛 래스터 (원장의 before). 지우지 않고 남겨 둔 파일이다. */
  rasterUrl: string;
  svgUrl: string;
  /** 둘 다 이 폭으로 그린다 — 크기가 같아야 또렷함을 견줄 수 있다. */
  mm: number;
  rasterPx: [number, number];
  svgViewBox: [number, number];
}

/**
 * 인쇄 폭(mm)에서 **종이에 찍히는 실제 dpi**.
 *
 * 「300dpi 로 다시 오렸다」는 원본을 뜬 해상도이지 **종이에 찍히는 값이 아니다.**
 * 종이 값은 「가로 픽셀 ÷ 인쇄 폭(inch)」이다 — 이 수가 300 아래면 그 그림은
 * 300dpi 로 오렸든 아니든 종이에서 거칠다.
 */
export function printedDpi(px: number, mm: number): number {
  if (!(px > 0) || !(mm > 0)) return 0;
  return px / (mm / 25.4);
}

/**
 * `n` 개를 **고르게** 뽑는다 — 앞에서 n 개가 아니라 전 구간에 걸쳐.
 *
 * 앞에서 자르면 표본이 한쪽에 몰린다(정렬 기준이 곧 편향이 된다). 이 저장소가
 * 이미 겪은 자리다 — 「학년 앞부분·1회차만 봤다」(CLAUDE.md 2026-08-19).
 */
export function spread<T>(items: readonly T[], n: number): T[] {
  if (n <= 0 || items.length === 0) return [];
  if (items.length <= n) return [...items];
  const out: T[] = [];
  for (let i = 0; i < n; i++) {
    out.push(items[Math.round((i * (items.length - 1)) / (n - 1))]!);
  }
  return out;
}

/**
 * 벡터 ↔ 래스터 견본. **인쇄 폭(mm) 순으로 고르게** 뽑는다 —
 * 작은 그림에서만 보이는 결함(가는 선이 사라진다)과 큰 그림에서만 보이는 결함
 * (칠이 뭉친다)이 다르기 때문이다.
 */
export function pickSvgSpecimens(
  ledger: readonly AdoptRow[],
  byId: ReadonlyMap<string, ProblemFigure>,
  count: number,
): SvgSpecimen[] {
  const rows: SvgSpecimen[] = [];
  for (const l of ledger) {
    const p = byId.get(l.id);
    if (!p) continue;
    const svgUrl = l.afterUrls[0];
    const rasterUrl = l.beforeUrls[0];
    const mm = p.figureSourceMm?.[0];
    // mm 를 모르면 제품이 그리는 폭이 픽셀에서 오므로 둘을 같은 크기로 못 놓는다.
    if (!svgUrl || !rasterUrl || !(mm! > 0)) continue;
    if (!(l.beforeDims?.[0] > 0) || !(l.afterDims?.[0] > 0)) continue;
    rows.push({
      problemCode: p.problemCode,
      rasterUrl,
      svgUrl,
      mm: mm!,
      rasterPx: [l.beforeDims[0]!, l.beforeDims[1]!],
      svgViewBox: [l.afterDims[0]!, l.afterDims[1]!],
    });
  }
  rows.sort((a, b) => a.mm - b.mm);
  return spread(rows, count);
}

export interface DpiSpecimen {
  problemCode: string;
  url: string;
  px: [number, number];
  mm: number;
  dpi: number;
}

/**
 * 300dpi 재크롭 견본. **종이 dpi 가 가장 낮은 것부터** `count` 개.
 *
 * 🔴 처음엔 `spread` 로 전 구간에서 고르게 뽑았는데, 그러면 「가장 거친 것부터」라고
 *    적어 놓고 **1184dpi 짜리가 섞인다**(2026-08-20 에 실제로 그랬다 — 인쇄본을
 *    보고서야 드러났다). 판정 기준이 「가장 나쁜 것이 견딜 만한가」라면 표본도
 *    가장 나쁜 쪽이어야 한다. **적은 규칙과 고르는 코드가 갈라지면 안 된다.**
 */
export function pickDpiSpecimens(
  swapped: ReadonlySet<string>,
  problems: readonly ProblemFigure[],
  count: number,
): DpiSpecimen[] {
  const rows: DpiSpecimen[] = [];
  for (const p of problems) {
    p.figureUrls.forEach((url, i) => {
      if (!swapped.has(url)) return;
      const px = p.figureDims?.[i * 2];
      const py = p.figureDims?.[i * 2 + 1];
      const mm = p.figureSourceMm?.[i];
      if (!(px! > 0) || !(py! > 0) || !(mm! > 0)) return;
      rows.push({
        problemCode: p.problemCode,
        url,
        px: [px!, py!],
        mm: mm!,
        dpi: printedDpi(px!, mm!),
      });
    });
  }
  rows.sort((a, b) => a.dpi - b.dpi);
  return rows.slice(0, count);
}
