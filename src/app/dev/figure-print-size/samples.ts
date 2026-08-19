/**
 * 전후 비교 지면의 **표본** — 손으로 고르지 않는다.
 *
 * ## 왜 생성물인가
 *
 * 1차의 표본 6장은 손으로 골랐다. 그러면 «가장 큰 실데이터»가 안 들어와 레이아웃이
 * 깨지는 조건이 지워진다 — 2026-08-19 범위 피커가 정확히 그렇게 깨졌다(시안 픽스처가
 * 중2 17개뿐이라 학년 열이 16행인 것을 아무도 못 봤다).
 *
 * 그래서 목록은 `scripts/qa/pick-figure-print-samples.py` 가 **실측 원장 전량**에서
 * 규칙으로 뽑아 `samples.generated.json` 으로 낸다(그 파일은 커밋된다). 규칙은
 *   배율 분위수 · **15mm 미만 전량** · 커지는 것 · mm 모름(섞임/통째로) ·
 *   세로로 긴 것 · 한 문항 여러 장
 * 이고, 「15mm 미만이 다 들어갔나」를 검산해 하나라도 빠지면 생성이 **멈춘다**.
 *
 * ⚠️ **숫자는 여기서 만들지 않는다.** mm 는 화면이 원장(`ledger.ts`)에서 그때그때
 *    읽는다. 생성물이 mm 까지 들고 있으면 원장이 갱신될 때 둘이 갈라지는데, 그건
 *    아무도 모르게 어긋난다. 생성물이 정하는 것은 **어느 그림을 보여 주나**뿐이다.
 */
import {
  checkFigureSourceMm,
  cssPxToMm,
  figurePrintWidthMm,
  figurePrintWidthPx,
} from "@/lib/figurePrintSize";

import type { FigureLedgerEntry } from "./ledger";

/** `pick-figure-print-samples.py` 산출물. 커밋된다. */
export const SAMPLES_PATH =
  "src/app/dev/figure-print-size/samples.generated.json";

export interface SampleItem {
  /** `<시험지>/q<번호>` 또는 `rpm/<uuid>` — 같은 문항의 그림을 한 칸으로 묶는 열쇠. */
  key: string;
  /** 어느 갈래로 뽑혔나. 화면 절 제목이 된다. */
  bucket: string;
  /** 왜 이 문항이 뽑혔나 — 화면에 그대로 적는다. */
  why: string;
  figures: string[];
}

export interface GeneratedSamples {
  basis: string;
  ledgerRows: number;
  measured: number;
  tinyCount: number;
  bigItems: string[];
  items: SampleItem[];
}

export type SamplesResult =
  { ok: true; samples: GeneratedSamples } | { ok: false; reason: string };

/**
 * 화면에 절을 늘어놓는 순서. 여기 없는 갈래는 **맨 뒤**에 붙는다 —
 * 생성기가 갈래를 새로 만들어도 화면에서 조용히 사라지지 않게.
 */
export const BUCKET_ORDER = [
  "배율 하위 5%",
  "배율 25%",
  "배율 중앙",
  "배율 75%",
  "배율 상위 5%",
  "15mm 미만",
  "커진다",
  "mm 모름 섞임",
  "mm 통째로 모름",
  "세로로 길다",
  "한 문항 여러 장",
];

const asStringArray = (value: unknown): string[] | null =>
  Array.isArray(value) && value.every((v) => typeof v === "string")
    ? (value as string[])
    : null;

export function parseGeneratedSamples(raw: string): SamplesResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "표본 목록을 JSON 으로 못 읽는다." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
    return { ok: false, reason: "표본 목록의 맨 바깥이 객체가 아니다." };
  const record = parsed as Record<string, unknown>;
  const rawItems = record["문항"];
  if (!Array.isArray(rawItems) || rawItems.length === 0)
    return { ok: false, reason: "표본 목록에 「문항」이 없다." };

  const items: SampleItem[] = [];
  for (const row of rawItems) {
    if (!row || typeof row !== "object") continue;
    const entry = row as Record<string, unknown>;
    const figures = asStringArray(entry["그림"]);
    if (typeof entry["키"] !== "string" || !figures || figures.length === 0)
      continue;
    items.push({
      key: entry["키"] as string,
      bucket: typeof entry["갈래"] === "string" ? entry["갈래"] : "(갈래 없음)",
      why: typeof entry["왜"] === "string" ? entry["왜"] : "",
      figures,
    });
  }
  if (items.length === 0)
    return { ok: false, reason: "표본 목록의 「문항」을 하나도 못 읽었다." };

  return {
    ok: true,
    samples: {
      basis: typeof record["기준"] === "string" ? record["기준"] : "",
      ledgerRows: typeof record["원장행"] === "number" ? record["원장행"] : 0,
      measured: typeof record["잰 그림"] === "number" ? record["잰 그림"] : 0,
      tinyCount:
        typeof record["15mm미만"] === "number" ? record["15mm미만"] : 0,
      bigItems: asStringArray(record["큰 문항"]) ?? [],
      items,
    },
  };
}

export interface SampleFigureView {
  url: string;
  /** 원장에 그 그림이 있으면 그 행. 없으면 `null` — **행은 남긴다**. */
  entry: FigureLedgerEntry | null;
  pixels: [number, number] | null;
  /** **지금 규칙**이 그리는 폭(mm). 제품 함수에서 나온다. */
  currentMm: number | null;
  /** **새 규칙**이 그리는 폭(mm). */
  newMm: number | null;
  ratio: number | null;
}

export interface SampleItemView {
  key: string;
  bucket: string;
  why: string;
  /** 원본 URL — 지면 컴포넌트에 그대로 넘긴다. */
  figureUrls: string[];
  /** 그림마다 잰 값. **원장에 없는 그림도 행으로 남는다** — 빠지면 표본이 조용히 준다. */
  figures: SampleFigureView[];
  /** `figureDims` 로 실을 값. 한 장이라도 치수를 모르면 **빈 배열**이다. */
  figureDims: number[];
  /** 「새 규칙」쪽에 실을 mm 배열. 못 실으면 `undefined`. */
  afterSourceMm: number[] | undefined;
  /**
   * 새 규칙이 이 문항에 **적용되지 않는** 이유. 적용되면 `null`.
   *
   * 🔴 자리별로 그리지 않는다. 적재 술어(`checkFigureSourceMm`)가 **한 자리라도
   *    손상되면 배열째** 막으므로, 실제 DB 에는 「한 장만 아는 문항」이 들어갈 수 없다.
   *    화면만 자리별로 그리면 **절대 안 나오는 지면**을 원장님께 보여 주게 된다.
   */
  blockedReason: string | null;
}

export type ReadPixels = (url: string) => [number, number] | null;

export function buildSampleViews(
  items: readonly SampleItem[],
  ledger: ReadonlyMap<string, FigureLedgerEntry>,
  readPixels: ReadPixels,
): SampleItemView[] {
  return items.map((item) => {
    const figures: SampleFigureView[] = item.figures.map((url) => {
      const entry = ledger.get(url) ?? null;
      const pixels = readPixels(url);
      // 🔴 「지금 폭」은 **제품 함수**에서 나온다. 옛 규칙을 옮겨 적으면 갈라져도 아무도 모른다.
      const currentMm =
        pixels == null
          ? null
          : cssPxToMm(
              figurePrintWidthPx({ width: pixels[0], height: pixels[1] }),
            );
      const newMm =
        entry?.sourceMm == null ? null : figurePrintWidthMm(entry.sourceMm);
      return {
        url,
        entry,
        pixels,
        currentMm,
        newMm,
        ratio: currentMm == null || newMm == null ? null : newMm / currentMm,
      };
    });

    const missingFromLedger = figures.filter((v) => v.entry == null).length;
    const missingPixels = figures.filter((v) => v.pixels == null).length;
    // 치수를 모르면 mm 도 버린다 — 자와 지면이 **같이** 모른다(figurePrintSize.ts §두 배열).
    const figureDims =
      missingPixels > 0
        ? []
        : figures.flatMap((v) => [v.pixels![0], v.pixels![1]]);

    const sourceMm = figures.map((v) => v.entry?.sourceMm ?? Number.NaN);
    const check = checkFigureSourceMm(figures.length, sourceMm);

    let blockedReason: string | null = null;
    if (missingPixels > 0) {
      blockedReason = `그림 ${missingPixels}장의 픽셀 치수를 모른다 — 치수를 모르면 mm 도 버린다(비율을 모르면 높이를 못 잰다).`;
    } else if (missingFromLedger > 0) {
      blockedReason = `그림 ${missingFromLedger}장이 원장에 없다.`;
    } else if (!check.ok) {
      const unknown = figures.filter((v) => v.entry?.sourceMm == null).length;
      blockedReason =
        unknown > 0
          ? `그림 ${figures.length}장 중 ${unknown}장이 mm 를 모른다 — 적재 가드가 배열째 막으므로 이 문항은 **통째로** 오늘 그대로 나간다.`
          : `mm 배열을 못 싣는다 — ${check.reason}`;
    }

    return {
      key: item.key,
      bucket: item.bucket,
      why: item.why,
      figureUrls: item.figures,
      figures,
      figureDims,
      afterSourceMm:
        blockedReason == null && figureDims.length > 0 ? sourceMm : undefined,
      blockedReason,
    };
  });
}

/**
 * 시안 본문 — **공유 DB(D-31)를 안 읽는다.** 이 화면이 보여 주는 것은 그림의 크기이지
 * 본문이 아니다. 다만 본문 길이는 그림이 칸을 얼마나 밀어내는지에 영향을 주므로
 * 실측 문항의 흔한 길이(짧은 것 · 보기 다섯 · 서술형)를 골고루 섞어 돌려 쓴다.
 */
const BODY_POOL: { content: string; answer: string }[] = [
  {
    content:
      "그림과 같이 한 변의 길이가 $6\\,\\mathrm{cm}$ 인 정삼각형 $\\mathrm{ABC}$ 가 있다. " +
      "변 $\\overline{\\mathrm{BC}}$ 의 중점을 $\\mathrm{M}$ 이라 할 때, 선분 $\\overline{\\mathrm{AM}}$ 의 길이는?\n" +
      "1. $3\\,\\mathrm{cm}$\n2. $3\\sqrt{2}\\,\\mathrm{cm}$\n3. $3\\sqrt{3}\\,\\mathrm{cm}$\n4. $6\\,\\mathrm{cm}$\n5. $6\\sqrt{3}\\,\\mathrm{cm}$",
    answer: "③",
  },
  {
    content: "그림과 같은 도형에 대하여 색칠한 부분의 넓이를 구하시오.",
    answer: "$12\\,\\mathrm{cm}^2$",
  },
  {
    content:
      "그림은 어느 반 학생 $30$ 명의 하루 수면 시간을 조사하여 나타낸 것이다. " +
      "수면 시간이 $7$ 시간 이상인 학생은 전체의 몇 %인가?\n" +
      "1. $20\\,\\%$\n2. $30\\,\\%$\n3. $40\\,\\%$\n4. $50\\,\\%$\n5. $60\\,\\%$",
    answer: "④",
  },
  {
    content:
      "그림과 같이 직육면체 모양의 상자가 있다. 이 상자의 겉넓이가 $94\\,\\mathrm{cm}^2$ 이고 " +
      "밑면의 가로와 세로의 길이가 각각 $5\\,\\mathrm{cm}$, $3\\,\\mathrm{cm}$ 일 때, 높이를 구하는 " +
      "풀이 과정과 답을 쓰시오.",
    answer: "$4\\,\\mathrm{cm}$",
  },
  {
    content:
      "그림과 같이 원 $\\mathrm{O}$ 에서 두 현 $\\overline{\\mathrm{AB}}$ 와 $\\overline{\\mathrm{CD}}$ 가 " +
      "점 $\\mathrm{P}$ 에서 만난다. $\\overline{\\mathrm{PA}}=4$, $\\overline{\\mathrm{PB}}=6$, " +
      "$\\overline{\\mathrm{PC}}=3$ 일 때 $\\overline{\\mathrm{PD}}$ 의 길이는?\n" +
      "1. $6$\n2. $7$\n3. $8$\n4. $9$\n5. $10$",
    answer: "③",
  },
  {
    content:
      "그림과 같은 함수 $y=f(x)$ 의 그래프에 대하여 $f(f(2))$ 의 값을 구하시오.",
    answer: "$1$",
  },
];

/** 문항 순서로 **결정적으로** 고른다 — 다시 그려도 같은 지면이 나와야 견줄 수 있다. */
export function bodyFor(index: number): { content: string; answer: string } {
  return BODY_POOL[index % BODY_POOL.length]!;
}
