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
  cssPxToMm,
  figurePrintWidthMm,
  figurePrintWidthPx,
} from "@/lib/figurePrintSize";
import { readFigureDimensions } from "@/lib/import/figureDimensionsFromPublic";
import { JASEUP_MEASURED_PX } from "@/lib/printGeometry";
import { packProblems } from "@/lib/printPack";

import { RECT_LEDGER_PATH, parseFigureRectLedger, proofLabel } from "./ledger";
import type { FigureRectLedgerOk } from "./ledger";
import {
  BUCKET_ORDER,
  SAMPLES_PATH,
  bodyFor,
  buildSampleViews,
  parseGeneratedSamples,
} from "./samples";
import type { SampleItemView } from "./samples";

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
 * ## 🔴 원장이 없으면 **적고 멈춘다**
 *
 * 1차는 실측 원장이 없을 때 「200dpi 로 잘랐다」는 가정에서 mm 를 환산했다. 그 화면은
 * 가정값임을 정직하게 적었지만, **가정이 실제로 틀렸다** — 실측하니 84%가 네이티브
 * 추출본이라 200 으로 나누면 안 되는 그림이었다. 가정값을 보고 판단하시면 실제와
 * 다른 것을 판단하시게 된다. 그래서 이제 **원장이 없으면 비교를 아예 그리지 않는다.**
 * 조용히 가정값으로 내려가지 않는다.
 *
 * ## 🔴 「지금 규칙」쪽은 흉내 내지 않는다
 *
 * 옛 코드를 베끼지 않고 **같은 컴포넌트를 mm 없이** 부른다. 표의 「지금 폭」도
 * 제품 함수(`figurePrintWidthPx`)에서 나온다. 흉내가 남아 있으면 갈라져도 아무도 모른다.
 *
 * 다른 `/dev` 화면과 같은 가드다. `force-static` 을 쓰면 안 된다(프로덕션에 구워진다).
 */

const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";
const PANEL = "border-2 border-ink bg-side p-4";

const META: JaseupPrintMeta = {
  academyName: "오늘의수학",
  title: "그림 크기 비교 (시안)",
  examDate: "2026-08-19",
  todayGoal: "그림이 문항마다 같은 크기로 나오는지 본다",
  conceptNote:
    "이 지면은 시안이다. 본문은 실제 문항이 아니고, 볼 것은 그림의 크기다.",
};

const mmText = (mm: number | null) =>
  mm == null ? "모른다" : `${mm.toFixed(1)}mm`;

interface FileRead {
  raw: string | null;
  reason: string | null;
}

function readRepoFile(relative: string): FileRead {
  try {
    return {
      raw: readFileSync(path.join(process.cwd(), relative), "utf8"),
      reason: null,
    };
  } catch {
    return { raw: null, reason: `파일이 없다: ${relative}` };
  }
}

/** 원장 전량 집계 — **규칙은 제품 함수에서** 오고, 값은 원장에서 온다. */
function summarize(ledger: FigureRectLedgerOk) {
  let smaller = 0;
  let same = 0;
  let bigger = 0;
  let cappedNow = 0;
  let cappedNew = 0;
  let noPixels = 0;
  const ratios: number[] = [];
  const currents: number[] = [];
  const nexts: number[] = [];
  const under: Record<number, number> = { 10: 0, 15: 0, 20: 0 };

  for (const entry of ledger.entries.values()) {
    if (entry.sourceMm == null) continue;
    if (entry.currentPx == null) {
      noPixels += 1;
      continue;
    }
    const now = cssPxToMm(
      figurePrintWidthPx({
        width: entry.currentPx[0],
        height: entry.currentPx[1],
      }),
    );
    const next = figurePrintWidthMm(entry.sourceMm);
    currents.push(now);
    nexts.push(next);
    ratios.push(next / now);
    if (next < now * 0.98) smaller += 1;
    else if (next > now * 1.02) bigger += 1;
    else same += 1;
    if (now >= FIGURE_MAX_WIDTH_MM - 0.01) cappedNow += 1;
    if (next >= FIGURE_MAX_WIDTH_MM - 0.01) cappedNew += 1;
    for (const limit of [10, 15, 20])
      if (next < limit) under[limit] = (under[limit] ?? 0) + 1;
  }

  ratios.sort((a, b) => a - b);
  currents.sort((a, b) => a - b);
  nexts.sort((a, b) => a - b);
  const at = (values: number[], fraction: number) =>
    values.length === 0
      ? null
      : (values[
          Math.min(values.length - 1, Math.floor(values.length * fraction))
        ] ?? null);

  return {
    measured: ratios.length,
    noPixels,
    smaller,
    same,
    bigger,
    cappedNow,
    cappedNew,
    under,
    ratioMedian: at(ratios, 0.5),
    currentMedian: at(currents, 0.5),
    nextMedian: at(nexts, 0.5),
  };
}

function problemsFor(
  items: SampleItemView[],
  rule: "지금" | "새",
): TestPrintProblem[] {
  return items.map((item, index) => {
    const body = bodyFor(index);
    return {
      id: `${rule}-${item.key}`,
      orderIndex: index,
      content: body.content,
      answer: body.answer,
      solution: null,
      figureUrls: item.figureUrls,
      figureDims: item.figureDims,
      // 「지금 규칙」 = mm 를 **안 넘긴 상태**다. 옛 코드를 흉내 내지 않는다.
      ...(rule === "새" && item.afterSourceMm
        ? { figureSourceMm: item.afterSourceMm }
        : {}),
    };
  });
}

export default async function FigurePrintSizePage({
  searchParams,
}: {
  searchParams: Promise<{ bucket?: string | string[] }>;
}) {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const rawBucket = (await searchParams).bucket;
  const onlyBucket =
    typeof rawBucket === "string" && rawBucket.length > 0 ? rawBucket : null;

  const ledgerFile = readRepoFile(RECT_LEDGER_PATH);
  const ledger = ledgerFile.raw
    ? parseFigureRectLedger(ledgerFile.raw)
    : ({ ok: false, reason: ledgerFile.reason! } as const);
  const samplesFile = readRepoFile(SAMPLES_PATH);
  const samples = samplesFile.raw
    ? parseGeneratedSamples(samplesFile.raw)
    : ({ ok: false, reason: samplesFile.reason! } as const);

  const header = (
    <header className="mb-6">
      <span className={`${MICRO} text-faint`}>D-07 시안 · 절대 규칙 6</span>
      <h1 className="mt-1 text-[24px] font-black tracking-tight">
        그림 인쇄 크기 — 지금 규칙 / 새 규칙
      </h1>
      <p className="mt-2 max-w-[900px] text-[13px] leading-[1.8] text-text-2">
        지금 규칙에는 「넘치면 줄인다」만 있고 <b>「얼마로 그린다」가 없다</b>.
        원본 가로가 41~7,343px(중앙 425)이라 같은 삼각형이 문항마다 다른 크기로
        인쇄된다. 새 규칙은 원본 지면에서 그 그림이 차지하던 <b>물리 폭(mm)</b>
        을 그대로 쓰고 {FIGURE_MAX_WIDTH_MM}mm 에서 자른다.
      </p>
    </header>
  );

  // 🔴 원장이 없으면 **여기서 멈춘다.** 가정값으로 내려가지 않는다.
  if (!ledger.ok || !samples.ok) {
    return (
      <main className="mx-auto max-w-[900px] px-6 py-8">
        {header}
        <section className={`${PANEL} border-g-red-text`}>
          <div className={`${MICRO} text-g-red-text`}>비교를 그리지 않았다</div>
          {!ledger.ok ? (
            <p className="mt-2 text-[13px] leading-[1.8]">
              <b>실측 원장을 못 읽는다.</b> {ledger.reason}
              <br />
              찾는 자리:{" "}
              <code className="bg-white px-1">{RECT_LEDGER_PATH}</code> (
              <code>그림벡터</code> 트랙 산출물 · 7MB 라 커밋되지 않는다).
              만드는 법은{" "}
              <code className="bg-white px-1">
                scripts/figure/build-rect-ledger.py
              </code>
              .
            </p>
          ) : null}
          {!samples.ok ? (
            <p className="mt-2 text-[13px] leading-[1.8]">
              <b>표본 목록을 못 읽는다.</b> {samples.reason}
              <br />
              만드는 법:{" "}
              <code className="bg-white px-1">
                python scripts/qa/pick-figure-print-samples.py
              </code>
            </p>
          ) : null}
          <p className="mt-3 text-[13px] leading-[1.8]">
            🔴 <b>가정값으로 내려가지 않는다.</b> 1차는 원장이 없을 때 「우리가
            200dpi 로 잘랐다」는 기록에서 mm 를 환산해 보여 줬는데, 실측하니 그
            가정이 <b>84%에서 틀렸다</b>(네이티브 추출본이라 200 으로 나누면 안
            된다). 가정값을 보고 판단하시면 실제와 다른 것을 판단하시게 된다.
          </p>
        </section>
      </main>
    );
  }

  const items = buildSampleViews(
    samples.samples.items,
    ledger.entries,
    readFigureDimensions,
  );
  const summary = summarize(ledger);
  const buckets = [
    ...BUCKET_ORDER.filter((bucket) => items.some((i) => i.bucket === bucket)),
    ...[...new Set(items.map((i) => i.bucket))].filter(
      (bucket) => !BUCKET_ORDER.includes(bucket),
    ),
  ];
  const blocked = items.filter((item) => item.blockedReason != null);
  const missingFiles = items.flatMap((item) =>
    item.figures.filter((figure) => figure.pixels == null).map((f) => f.url),
  );
  const shownBuckets = onlyBucket
    ? buckets.filter((bucket) => bucket === onlyBucket)
    : buckets;

  return (
    <main className="px-6 py-8">
      <div data-shot="요약">
        {header}

        <section className={`${PANEL} mb-4`}>
          <div className={`${MICRO} text-faint`}>
            이 화면의 mm 는 어디서 왔나
          </div>
          <p className="mt-1 text-[13px] leading-[1.8]">
            <b>실측이다.</b>{" "}
            <code className="bg-white px-1">{RECT_LEDGER_PATH}</code> 에서{" "}
            {ledger.total.toLocaleString()}행을 읽었고 그중{" "}
            <b>{ledger.withMm.toLocaleString()}장</b>이 물리 폭을 안다
            {ledger.dropped > 0
              ? ` (읽을 수 없어 버린 행 ${ledger.dropped})`
              : null}
            . 원본 PDF 를 다시 매핑해 그림마다 증명한 값이다.
          </p>
          <table className="mt-3 w-full border-collapse text-[12px] tabular-nums">
            <thead>
              <tr className="border-b border-line text-left">
                <th className="py-1 pr-3 font-extrabold">증명</th>
                <th className="py-1 pr-3 text-right font-extrabold">장수</th>
                <th className="py-1 pr-3 font-extrabold">무엇을 봤나</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(ledger.proofCounts)
                .sort((a, b) => b[1] - a[1])
                .map(([proof, count]) => {
                  const label = proofLabel(proof);
                  return (
                    <tr className="border-b border-line align-top" key={proof}>
                      <td className="py-1 pr-3 font-bold">
                        {label.name}
                        {label.rank <= 1 ? " ⚠" : ""}
                      </td>
                      <td className="py-1 pr-3 text-right">
                        {count.toLocaleString()}
                      </td>
                      <td className="py-1 pr-3 text-text-2">{label.detail}</td>
                    </tr>
                  );
                })}
            </tbody>
          </table>
          <p className="mt-2 text-[12px] leading-[1.8] text-text-2">
            ⚠ <b>증명의 세기가 다르다.</b> 「PNG 에 적힌 dpi 로만 구했다」는
            원본 지면에서의 <b>자리를 못 찾은</b> 갈래다 — 크기는 있는데 그 칸이
            정말 그 그림이었는지는 확인하지 못했다. 2차 지시서의 요약이 이
            갈래를 안 세어 증명 합계(13,698)와 mm 장수(14,391)가 어긋나 있었다.
            그 차이가 이것이다.
          </p>
        </section>

        <section className={`${PANEL} mb-4`}>
          <div className={`${MICRO} text-faint`}>
            원장 전량으로 재면 — 규칙은 제품 함수에서, 값은 원장에서
          </div>
          <p className="mt-1 text-[13px] leading-[1.8]">
            잰 것 <b>{summary.measured.toLocaleString()}장</b> · 작아진다{" "}
            <b>{summary.smaller.toLocaleString()}</b>(
            {((100 * summary.smaller) / summary.measured).toFixed(1)}%) · 그대로{" "}
            {summary.same.toLocaleString()} · 커진다{" "}
            {summary.bigger.toLocaleString()}. 배율 중앙{" "}
            <b>×{summary.ratioMedian?.toFixed(2)}</b>.
          </p>
          <p className="mt-1 text-[13px] leading-[1.8]">
            폭 중앙 {mmText(summary.currentMedian)} →{" "}
            <b>{mmText(summary.nextMedian)}</b>. {FIGURE_MAX_WIDTH_MM}mm 상한에
            걸린 것 {summary.cappedNow.toLocaleString()}장(
            {((100 * summary.cappedNow) / summary.measured).toFixed(1)}%) →{" "}
            <b>{summary.cappedNew.toLocaleString()}장</b>(
            {((100 * summary.cappedNew) / summary.measured).toFixed(1)}%).
          </p>
          <p className="mt-1 text-[13px] leading-[1.8]">
            <b>지금 규칙의 진짜 문제가 이 한 줄에 있다</b> — 지금은 그림 열에
            여덟이 <b>똑같이 {FIGURE_MAX_WIDTH_MM}mm</b> 로 나간다. 원본에서
            손톱만 하든 반쪽짜리든 상관없이 최대 폭이다.
          </p>
          <p className="mt-1 text-[13px] leading-[1.8]">
            작아져서 못 읽는가 — 새 규칙에서 15mm 미만{" "}
            <b>{(summary.under[15] ?? 0).toLocaleString()}장</b> · 10mm 미만{" "}
            {(summary.under[10] ?? 0).toLocaleString()}장 · 20mm 미만{" "}
            {(summary.under[20] ?? 0).toLocaleString()}장. 아래 「15mm 미만」
            절에 그 <b>전량</b>이 들어 있다.
          </p>
          {summary.noPixels > 0 ? (
            <p className="mt-1 text-[12px] text-g-red-text">
              픽셀 치수를 몰라 못 잰 행 {summary.noPixels.toLocaleString()}.
            </p>
          ) : null}
        </section>

        <section className={`${PANEL} mb-6`}>
          <div className={`${MICRO} text-faint`}>표본을 어떻게 골랐나</div>
          <p className="mt-1 text-[13px] leading-[1.8]">
            {samples.samples.basis} — 문항 <b>{items.length}</b>개 · 그림{" "}
            <b>{items.reduce((sum, item) => sum + item.figures.length, 0)}</b>
            장. 15mm 미만 <b>{samples.samples.tinyCount}장 전량</b>이 들어 있고,
            하나라도 빠지면 생성이 멈춘다.
          </p>
          {samples.samples.bigItems.length > 0 ? (
            <p className="mt-1 text-[12px] leading-[1.8] text-text-2">
              그림이 많은 문항도 <b>자르지 않았다</b> —{" "}
              {samples.samples.bigItems.join(" · ")}. 시안 픽스처가 작아서
              레이아웃 결함을 지워 버린 사고가 있었다(2026-08-19 범위 피커).
            </p>
          ) : null}
          {blocked.length > 0 ? (
            <p className="mt-2 text-[13px] leading-[1.8]">
              🔴 표본 {blocked.length}문항은 <b>새 규칙이 적용되지 않는다</b> —
              적재 가드(<code>checkFigureSourceMm</code>)가 한 자리라도 모르면
              배열째 막기 때문이다. 그 문항은 오른쪽 지면에서도{" "}
              <b>오늘 그대로</b> 나온다. 갈래별 표의 「막힌 이유」 칸을 볼 것.
            </p>
          ) : null}
          {missingFiles.length > 0 ? (
            <p className="mt-2 text-[12px] leading-[1.8] text-g-red-text">
              표본 {missingFiles.length}장은 지금 <code>public/figures</code> 에
              없다 — {missingFiles.slice(0, 6).join(" · ")}
              {missingFiles.length > 6 ? " …" : ""}. 그 자리는 그림 없이
              그려진다.
            </p>
          ) : null}
          <p className="mt-2 text-[12px] leading-[1.8] text-text-2">
            「지금 인쇄 폭」은 제품 함수 <code>figurePrintWidthPx</code> 를 mm
            없이 부른 값을 mm 로 되돌린 것이다 — 옛 규칙을 옮겨 적지 않는다.
            문항 열 폭은 {JASEUP_MEASURED_PX.problemColumn}px(약{" "}
            {cssPxToMm(JASEUP_MEASURED_PX.problemColumn).toFixed(0)}mm)이라
            상한이 그보다 좁다.
          </p>
        </section>
      </div>

      {onlyBucket && shownBuckets.length === 0 ? (
        <section className={`${PANEL} mb-6 border-g-red-text`}>
          <div className={`${MICRO} text-g-red-text`}>그 갈래가 없다</div>
          <p className="mt-1 text-[13px] leading-[1.8]">
            <code className="bg-white px-1">?bucket={onlyBucket}</code> 에
            해당하는 절이 표본에 없다. 있는 갈래: {buckets.join(" · ")}.
          </p>
        </section>
      ) : null}

      {shownBuckets.map((bucket) => {
        const group = items.filter((item) => item.bucket === bucket);
        const before = packProblems(problemsFor(group, "지금"));
        const after = packProblems(problemsFor(group, "새"));
        return (
          <section
            className="mb-12 border-t-2 border-ink pt-6"
            data-shot={`갈래:${bucket}`}
            key={bucket}
          >
            <h2 className="text-[18px] font-black tracking-tight">
              {bucket}
              <span className="ml-2 text-[12px] font-bold text-text-2">
                문항 {group.length} · 그림{" "}
                {group.reduce((sum, item) => sum + item.figures.length, 0)}
              </span>
            </h2>

            <div className="mt-3 overflow-x-auto">
              <table className="w-full border-collapse text-[12px] tabular-nums">
                <thead>
                  <tr className="border-b-2 border-ink text-left">
                    <th className="py-2 pr-3 font-extrabold">그림</th>
                    <th className="py-2 pr-3 text-right font-extrabold">
                      원본 px
                    </th>
                    <th className="py-2 pr-3 text-right font-extrabold">
                      지금 폭
                    </th>
                    <th className="py-2 pr-3 text-right font-extrabold">
                      새 폭
                    </th>
                    <th className="py-2 pr-3 text-right font-extrabold">
                      배율
                    </th>
                    <th className="py-2 pr-3 font-extrabold">증명</th>
                    <th className="py-2 pr-3 font-extrabold">비고</th>
                  </tr>
                </thead>
                <tbody>
                  {group.flatMap((item) =>
                    item.figures.map((figure, index) => (
                      <tr
                        className="border-b border-line align-top"
                        key={figure.url}
                      >
                        <td className="py-1 pr-3 font-mono text-[11px]">
                          {figure.url.replace("/figures/", "")}
                          {index === 0 ? (
                            <div className="mt-0.5 font-sans text-[11px] text-text-2">
                              {item.why}
                            </div>
                          ) : null}
                        </td>
                        <td className="py-1 pr-3 text-right">
                          {figure.pixels
                            ? `${figure.pixels[0]}×${figure.pixels[1]}`
                            : "모른다"}
                        </td>
                        <td className="py-1 pr-3 text-right">
                          {mmText(figure.currentMm)}
                        </td>
                        <td className="py-1 pr-3 text-right font-bold">
                          {mmText(figure.newMm)}
                        </td>
                        <td className="py-1 pr-3 text-right">
                          {figure.ratio == null
                            ? "—"
                            : `×${figure.ratio.toFixed(2)}`}
                        </td>
                        <td className="py-1 pr-3">
                          {figure.entry == null
                            ? "원장에 없다"
                            : proofLabel(figure.entry.proof).name}
                        </td>
                        <td className="py-1 pr-3 text-text-2">
                          {figure.entry?.note ??
                            (index === 0 ? (item.blockedReason ?? "") : "")}
                        </td>
                      </tr>
                    )),
                  )}
                </tbody>
              </table>
            </div>

            {/* A4 한 장이 210mm 라, 1400px 칸에 둘을 나란히 두면 서로 겹친다.
                제품 지면이 아니라 이 비교 화면만의 제약이다. 가로로 스크롤한다. */}
            <div className="mt-4 overflow-x-auto">
              <div
                className="grid grid-cols-2 gap-8"
                style={{ minWidth: "calc(2 * 210mm + 2rem)" }}
              >
                <div data-rule="지금">
                  <h3 className="mb-2 text-[14px] font-black">
                    지금 규칙 (픽셀)
                  </h3>
                  <div className="flex flex-col gap-4">
                    {before.map((page, index) => (
                      <JaseupTemplate
                        key={`before-${bucket}-${index}`}
                        meta={META}
                        page={index + 1}
                        problems={page.problems}
                        startingNumber={page.startingNumber}
                      />
                    ))}
                  </div>
                </div>
                <div data-rule="새">
                  <h3 className="mb-2 text-[14px] font-black">
                    새 규칙 (원본 물리 크기 mm)
                  </h3>
                  <div className="flex flex-col gap-4">
                    {after.map((page, index) => (
                      <JaseupTemplate
                        key={`after-${bucket}-${index}`}
                        meta={META}
                        page={index + 1}
                        problems={page.problems}
                        startingNumber={page.startingNumber}
                      />
                    ))}
                  </div>
                </div>
              </div>
            </div>
          </section>
        );
      })}
    </main>
  );
}
