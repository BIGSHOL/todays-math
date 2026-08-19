import { readFileSync } from "node:fs";
import path from "node:path";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { JaseupTemplate } from "@/components/print/templates/JaseupTemplate";
import type {
  JaseupPrintMeta,
  TestPrintProblem,
} from "@/components/print/types";
import {
  FIGURE_MAX_WIDTH_MM,
  figurePrintWidthMm,
  parseFigureSourceMm,
} from "@/lib/figurePrintSize";
import { readFigureDimensions } from "@/lib/import/figureDimensionsFromPublic";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { packProblems } from "@/lib/printPack";

import {
  ASSUMED_CROP_DPI,
  FIGURE_SAMPLES,
  RECT_LEDGER_PATH,
  assumedSourceMm,
} from "./samples";

/**
 * 그림 인쇄 크기 — **전후 비교 지면** (내부 화면, D-07 확정용).
 *
 * ## 무엇을 보여 주나
 *
 * 같은 문항들을 **지금 규칙**과 **새 규칙**으로 각각 그려 나란히 놓는다.
 *   · 지금: 픽셀 폭이 264.567(=70mm)을 넘으면 70mm, 아니면 **픽셀 그대로(96dpi)**
 *   · 새로: 원본 지면에서 그 그림이 차지하던 **물리 폭(mm)**, 상한 70mm
 *
 * 원장님 지시(2026-08-19) 「모든 그림이나 도형 크기가 일관성이 있어야 하니까」에 대한
 * 시안이다. **인쇄 지면이 바뀌므로 절대 규칙 6** — 종이로 보시고 정하실 일이다.
 *
 * ## 🔴 이 화면의 mm 값이 어디서 오는지 **화면에 적는다**
 *
 * 실측 원장(`figure-rect-ledger.json`)이 있으면 그걸 쓰고, 없으면 「200dpi 로 잘랐다」는
 * 가정에서 환산한다. 둘은 **다른 물건**이라 화면이 어느 쪽인지 밝힌다 — 가정값을
 * 실측처럼 보여 주면 원장님이 못 가려낸다.
 *
 * 다른 `/dev` 화면과 같은 가드다. `force-static` 을 쓰면 안 된다(프로덕션에 구워진다).
 */

const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";

const META: JaseupPrintMeta = {
  academyName: "오늘의수학",
  title: "그림 크기 비교 (시안)",
  examDate: "2026-08-19",
  todayGoal: "그림이 문항마다 같은 크기로 나오는지 본다",
  conceptNote:
    "이 지면은 시안이다. 본문은 실제 문항이 아니고, 볼 것은 그림의 크기다.",
};

interface Row {
  url: string;
  why: string;
  content: string;
  answer: string;
  /** 원본 픽셀. 파일이 없으면 null — 「모른다」이지 0이 아니다. */
  pixels: [number, number] | null;
  /** 원본 지면 물리 폭(mm). 원장이 없으면 가정값. */
  sourceMm: number | null;
  fromLedger: boolean;
}

/** 실측 원장이 있으면 읽는다. 없는 것이 지금 상태다 — 없다고 멈추지 않는다. */
function readRectLedger(): Map<string, number> {
  const ledger = new Map<string, number>();
  try {
    const raw = readFileSync(
      path.join(process.cwd(), RECT_LEDGER_PATH),
      "utf8",
    );
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object")
      for (const [url, value] of Object.entries(
        parsed as Record<string, unknown>,
      )) {
        const mm =
          value && typeof value === "object"
            ? (value as { width_mm?: unknown }).width_mm
            : value;
        // 화면도 **제품과 같은 규칙**으로 거른다 — 여기서만 무르면 지면과 갈라진다.
        const [checked] = parseFigureSourceMm(1, [mm as number]);
        if (checked != null) ledger.set(url, checked);
      }
  } catch {
    // 없으면 없는 것이다. 가정값으로 내려간다(화면에 그렇게 적는다).
  }
  return ledger;
}

const mmText = (mm: number) => `${mm.toFixed(1)}mm`;

export default async function FigurePrintSizePage() {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const ledger = readRectLedger();
  const rows: Row[] = FIGURE_SAMPLES.map((sample) => {
    const pixels = readFigureDimensions(sample.url);
    const fromLedger = ledger.has(sample.url);
    const sourceMm = fromLedger
      ? (ledger.get(sample.url) ?? null)
      : pixels
        ? assumedSourceMm(pixels[0])
        : null;
    return { ...sample, pixels, sourceMm, fromLedger };
  });

  const missing = rows.filter((r) => !r.pixels);
  const usingLedger = rows.filter((r) => r.fromLedger).length;

  /** 지금 규칙의 인쇄 폭(mm) — 픽셀을 96dpi 로 보고 70mm 에서 자른다. */
  const todayMm = (pixelWidth: number) =>
    Math.min(FIGURE_MAX_WIDTH_MM, (pixelWidth * 25.4) / 96);

  const before: TestPrintProblem[] = rows.map((row, index) => ({
    id: `before-${index}`,
    orderIndex: index,
    content: row.content,
    answer: row.answer,
    solution: null,
    figureUrls: [row.url],
    figureDims: row.pixels ? [row.pixels[0], row.pixels[1]] : [],
    // 지금 규칙 = mm 를 **안 넘긴 상태**다. 옛 코드를 흉내 내지 않고 같은 컴포넌트를
    // 값 없이 부른다 — 흉내가 남아 있으면 갈라져도 아무도 모른다.
  }));

  const after: TestPrintProblem[] = rows.map((row, index) => ({
    ...before[index]!,
    id: `after-${index}`,
    figureSourceMm: row.sourceMm == null ? [] : [row.sourceMm],
  }));

  const beforePages = packProblems(before);
  const afterPages = packProblems(after);

  return (
    <main className="mx-auto max-w-[1400px] px-6 py-8">
      <header className="mb-6">
        <span className={`${MICRO} text-faint`}>D-07 시안 · 절대 규칙 6</span>
        <h1 className="mt-1 text-[24px] font-black tracking-tight">
          그림 인쇄 크기 — 지금 규칙 / 새 규칙
        </h1>
        <p className="mt-2 max-w-[900px] text-[13px] leading-[1.8] text-text-2">
          지금 규칙에는 「넘치면 줄인다」만 있고 <b>「얼마로 그린다」가 없다</b>
          . 원본 가로가 41~7,343px(중앙 425)이라 같은 삼각형이 문항마다 다른
          크기로 인쇄된다. 새 규칙은 원본 지면에서 그 그림이 차지하던{" "}
          <b>물리 폭(mm)</b>을 그대로 쓰고 {FIGURE_MAX_WIDTH_MM}mm 에서 자른다.
        </p>
      </header>

      <section className="mb-6 border-2 border-ink bg-side p-4">
        <div className={`${MICRO} text-faint`}>이 화면의 mm 는 어디서 왔나</div>
        {usingLedger === rows.length ? (
          <p className="mt-1 text-[13px] leading-[1.8]">
            <b>실측</b> — {RECT_LEDGER_PATH} 에서 {usingLedger}/{rows.length}{" "}
            장을 읽었다.
          </p>
        ) : (
          <p className="mt-1 text-[13px] leading-[1.8]">
            <b>가정값이다. 실측이 아니다.</b> 실측 원장(
            <code className="bg-white px-1">{RECT_LEDGER_PATH}</code>)이 아직
            없어({usingLedger}/{rows.length} 장만 실측) 「우리가{" "}
            {ASSUMED_CROP_DPI}dpi 로 잘랐다」는 기록에서{" "}
            <code className="bg-white px-1">
              픽셀 / {ASSUMED_CROP_DPI} × 25.4
            </code>{" "}
            로 환산했다. 같은 추출기에 <b>네이티브 이미지 추출</b> 경로가 따로
            있고 그쪽은 이 환산이 <b>틀린다</b> — 두 경로의 비율은 아직 안 쟀다.
            그러니 아래 지면은 <b>「크기 규칙이 어떻게 달라지는가」의 시안</b>
            이지, 그 문항이 실제로 몇 mm 인가에 대한 답이 아니다.
          </p>
        )}
        {missing.length > 0 ? (
          <p className="mt-2 text-[13px] leading-[1.8] text-g-red-text">
            표본 {missing.length}장은 지금 <code>public/figures</code> 에 없다 —{" "}
            {missing.map((m) => m.url).join(" · ")}. 그 자리는 그림 없이
            그려진다(다른 트랙이 다시 자르는 중일 수 있다).
          </p>
        ) : null}
      </section>

      <section className="mb-8 overflow-x-auto">
        <table className="w-full border-collapse text-[12px] tabular-nums">
          <thead>
            <tr className="border-b-2 border-ink text-left">
              <th className="py-2 pr-3 font-extrabold">그림</th>
              <th className="py-2 pr-3 font-extrabold">왜 골랐나</th>
              <th className="py-2 pr-3 text-right font-extrabold">원본 px</th>
              <th className="py-2 pr-3 text-right font-extrabold">
                지금 인쇄 폭
              </th>
              <th className="py-2 pr-3 text-right font-extrabold">
                새 인쇄 폭
              </th>
              <th className="py-2 pr-3 text-right font-extrabold">배율</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const now = row.pixels ? todayMm(row.pixels[0]) : null;
              const next =
                row.sourceMm == null ? null : figurePrintWidthMm(row.sourceMm);
              return (
                <tr className="border-b border-line align-top" key={row.url}>
                  <td className="py-2 pr-3 font-mono text-[11px]">{row.url}</td>
                  <td className="py-2 pr-3 text-text-2">{row.why}</td>
                  <td className="py-2 pr-3 text-right">
                    {row.pixels
                      ? `${row.pixels[0]}×${row.pixels[1]}`
                      : "모른다"}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {now == null ? "모른다" : mmText(now)}
                  </td>
                  <td className="py-2 pr-3 text-right font-bold">
                    {next == null ? "모른다" : mmText(next)}
                  </td>
                  <td className="py-2 pr-3 text-right">
                    {now == null || next == null
                      ? "—"
                      : `×${(next / now).toFixed(2)}`}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <p className="mt-3 text-[12px] leading-[1.8] text-text-2">
          「지금 인쇄 폭」은 <code>픽셀 × 25.4 / 96</code> 을{" "}
          {FIGURE_MAX_WIDTH_MM}mm 에서 자른 값이다 — 지면 CSS(
          <code>print:max-w-[{FIGURE_MAX_WIDTH_MM}mm]</code>)가 하는 일
          그대로다. 문항 열 폭은 {JASEUP_MEASURED_PX.problemColumn}px(약{" "}
          {((JASEUP_MEASURED_PX.problemColumn * 25.4) / 96).toFixed(0)}mm)이라
          상한이 그보다 좁다.
        </p>
      </section>

      <section className="grid grid-cols-1 gap-8 xl:grid-cols-2">
        <div>
          <h2 className="mb-2 text-[15px] font-black">지금 규칙 (픽셀)</h2>
          <div className="flex flex-col gap-4">
            {beforePages.map((page, index) => (
              <JaseupTemplate
                key={`before-${index}`}
                meta={META}
                page={index + 1}
                problems={page.problems}
                startingNumber={page.startingNumber}
              />
            ))}
          </div>
        </div>
        <div>
          <h2 className="mb-2 text-[15px] font-black">
            새 규칙 (원본 물리 크기 mm)
          </h2>
          <div className="flex flex-col gap-4">
            {afterPages.map((page, index) => (
              <JaseupTemplate
                key={`after-${index}`}
                meta={META}
                page={index + 1}
                problems={page.problems}
                startingNumber={page.startingNumber}
              />
            ))}
          </div>
        </div>
      </section>
    </main>
  );
}
