import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { notFound } from "next/navigation";
import { connection } from "next/server";

import { db } from "@/lib/db";
import { figurePrintWidthMm, figureWidthStyle } from "@/lib/figurePrintSize";
import { PAPER_CSS_VARIABLES } from "@/components/print/tokens";

import styles from "./Specimen.module.css";
import {
  pickDpiSpecimens,
  pickSvgSpecimens,
  printedDpi,
  type AdoptRow,
  type ProblemFigure,
  type SwapRow,
} from "./pickSpecimens";
import { PrintButton } from "./PrintButton";

/**
 * 실물 프린터 **검수 견본지** — 종이에 대고 판정하는 자리.
 *
 * ## 왜 만들었나
 *
 * `/dev/print-check` 는 「무엇을 봐야 하나」만 적혀 있고 **볼 것 자체**가 없다.
 * 그림 관련 미결 넷(`figure-svg-adopt`·`figure-print-size-mm`·
 * `figure-blend-multiply`·`figure-raster-300dpi`)은 **한 시험지에 다 안 나온다** —
 * 벡터로 바뀐 문항 · mm 를 아는 문항 · 배경이 흰 그림 · 재크롭본이 서로 다른 문항이라
 * 시험지를 몇 장 뽑아도 넷이 같이 찍힐 보장이 없다. 그래서 넷을 **한 장에 모은다.**
 *
 * ## 🔴 첫 장의 자가 나머지를 지킨다
 *
 * 인쇄 대화상자의 기본값이 「용지에 맞춤(Fit to page)」이면 지면이 **94% 쯤으로
 * 줄어든다.** 그러면 mm 판정은 물론이고 dpi 판정도 전부 틀린 값을 보게 된다.
 * 그래서 첫 장 맨 위에 **100mm 자**를 찍고, 그 자가 100mm 가 아니면 아래를
 * 보지 말라고 적는다 — 「지표의 참이 어디서 오나」를 종이에 옮긴 것이다.
 *
 * ## 견본은 제품과 **같은 자**로 그린다
 *
 * 폭은 `figureWidthStyle`(제품 지면·넘침 자가 같이 쓰는 함수)이 정하고,
 * 색·글꼴은 `PAPER_CSS_VARIABLES` 를 그대로 받는다. 견본을 따로 그리면
 * 「본 것」과 「나가는 것」이 갈라진다(2026-08-18).
 *
 * ⚠️ 다른 `/dev` 화면과 같은 가드 — production 에서는 기본으로 없다.
 * ⚠️ `force-static` 금지(형제 화면 주석 참조). `connection()` 으로 옵트아웃한다.
 */

const ADOPT_LEDGER = "scripts/qa/reports/figure-svg-adopt.json";
const SWAP_LEDGER = "scripts/qa/reports/figure-swap-ledger.json";

function readLedger<T>(rel: string, key: string): T[] {
  const p = path.join(process.cwd(), rel);
  if (!existsSync(p)) return [];
  try {
    const j = JSON.parse(readFileSync(p, "utf-8")) as Record<string, unknown>;
    const rows = j[key];
    return Array.isArray(rows) ? (rows as T[]) : [];
  } catch {
    return [];
  }
}

/** 저장소 안 파일인지 — 없는 파일을 지면에 놓으면 빈칸이 「결함」처럼 보인다. */
function onDisk(url: string): boolean {
  if (!url.startsWith("/")) return false;
  return existsSync(
    path.join(process.cwd(), "public", url.replace(/^\/+/, "")),
  );
}

const MM_TICKS = Array.from({ length: 11 }, (_, i) => i * 10);

function Ruler() {
  return (
    <div className={styles.rulerWrap}>
      <div className={styles.ruler}>
        {MM_TICKS.map((mm) => (
          <span
            key={mm}
            className={styles.tickMark}
            style={{ left: `${mm}mm`, height: mm % 50 === 0 ? "6mm" : "3.5mm" }}
          />
        ))}
        {MM_TICKS.filter((mm) => mm % 50 === 0).map((mm) => (
          <span
            key={mm}
            className={styles.tickLabel}
            style={{ left: `${mm}mm` }}
          >
            {mm}
          </span>
        ))}
      </div>
    </div>
  );
}

function Verdict({ what }: { what: string }) {
  return (
    <p className={styles.verdict}>
      <span>
        <span className={styles.tick} />
        통과
      </span>
      <span>
        <span className={styles.tick} />
        불합격
      </span>
      <span style={{ color: "var(--paper-gold)" }}>{what}</span>
    </p>
  );
}

export default async function PrintSpecimenPage() {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const adopt = readLedger<AdoptRow>(ADOPT_LEDGER, "rows");
  const swap = readLedger<SwapRow>(SWAP_LEDGER, "rows");
  const swapped = new Set(swap.map((s) => s.url));

  const adoptIds = adopt.map((r) => r.id);
  const adopted = adoptIds.length
    ? ((await db.problem.findMany({
        where: { id: { in: adoptIds.slice(0, 2000) } },
        select: {
          id: true,
          problemCode: true,
          figureUrls: true,
          figureDims: true,
          figureSourceMm: true,
        },
      })) as ProblemFigure[])
    : [];
  const byId = new Map(adopted.map((p) => [p.id, p]));

  const svgRows = pickSvgSpecimens(adopt, byId, 6).filter(
    (s) => onDisk(s.rasterUrl) && onDisk(s.svgUrl),
  );

  // 300dpi·배경·mm 은 **벡터로 안 바뀐** 래스터 문항에서 고른다 — 벡터로 바뀐 자리는
  // 이미 래스터가 아니라서 그 셋을 판정할 수 없다.
  const rasterPool = (await db.problem.findMany({
    where: {
      figureUrls: { isEmpty: false },
      figureSourceMm: { isEmpty: false },
      directUseAllowed: true,
    },
    select: {
      id: true,
      problemCode: true,
      figureUrls: true,
      figureDims: true,
      figureSourceMm: true,
    },
    take: 4000,
    orderBy: { problemCode: "asc" },
  })) as ProblemFigure[];

  const dpiRows = pickDpiSpecimens(swapped, rasterPool, 3).filter((d) =>
    onDisk(d.url),
  );

  // 배경 견본: 크게 그려야 흰 사각형이 보인다 — mm 가 큰 쪽에서 고른다.
  const blendRows = rasterPool
    .flatMap((p) =>
      p.figureUrls.map((url, i) => ({
        problemCode: p.problemCode,
        url,
        mm: p.figureSourceMm?.[i] ?? 0,
      })),
    )
    .filter((r) => r.mm >= 45 && onDisk(r.url))
    .slice(0, 2);

  // mm 견본: 작은 것·중간·상한(70mm) 이 다 나오게.
  const mmPool = rasterPool
    .flatMap((p) =>
      p.figureUrls.map((url, i) => ({
        problemCode: p.problemCode,
        url,
        mm: p.figureSourceMm?.[i] ?? 0,
      })),
    )
    .filter((r) => r.mm > 0 && onDisk(r.url));
  const mmRows = [
    mmPool.filter((r) => r.mm >= 18 && r.mm <= 24)[0],
    mmPool.filter((r) => r.mm >= 40 && r.mm <= 48)[0],
    mmPool.filter((r) => r.mm >= 70)[0],
  ].filter(Boolean) as { problemCode: string; url: string; mm: number }[];

  const vars = PAPER_CSS_VARIABLES as unknown as React.CSSProperties;

  return (
    <div className={styles.shell} style={vars}>
      <div className={styles.toolbar}>
        <h1>실물 검수 견본지 — 그림 관련 미결 4건</h1>
        <p>
          A4 로 인쇄합니다.{" "}
          <strong>인쇄 대화상자에서 배율을 100%(실제 크기)로</strong> 두세요.
          「용지에 맞춤」이면 첫 장의 자가 100mm 가 안 되고, 그러면 아래 판정이
          전부 무효입니다.
        </p>
        <p>
          판정을 마치면 <code>src/app/dev/print-check/items.ts</code> 의 해당
          항목 <code>status</code> 를 <code>&quot;통과&quot;</code> 로 바꿉니다.
        </p>
        <PrintButton className={styles.printButton} />
      </div>

      <div className={styles.pages}>
        {/* ── 1장 — 자와 크기 ───────────────────────────────── */}
        <section className={styles.page}>
          <header className={styles.pageHead}>
            <span className={styles.pageTitle}>
              ① 배율 확인과 그림 크기 (mm)
            </span>
            <span className={styles.pageNo}>SPECIMEN 1</span>
          </header>

          <p className={styles.lead}>
            <strong>먼저 이 자를 실제 자로 재세요.</strong> 0 에서 100 까지가{" "}
            <strong>정확히 100mm</strong> 여야 합니다. 아니면 인쇄 배율이 100%
            가 아닌 것이고, <strong>이 견본지의 모든 판정이 무효</strong>입니다.
            다시 인쇄하세요.
          </p>
          <Ruler />
          <Verdict what="자가 100mm 인가" />

          <p className={styles.lead}>
            아래 그림들은 <strong>원본 시험지에서 차지하던 물리 폭</strong>으로
            그린 것입니다. 적힌 mm 와 실제 폭이 같아야 합니다(상한 70mm). 같은
            종류의 도형이 문항마다 제각각 커지거나 작아지지 않는지도 같이 보세요
            — 그게 이 변경의 목적입니다.
          </p>
          {mmRows.map((r) => (
            <div key={r.url} className={styles.pair}>
              <div className={styles.cell}>
                <span className={styles.cellLabel}>
                  {r.problemCode} — 자로 재서{" "}
                  <strong>{figurePrintWidthMm(r.mm).toFixed(1)}mm</strong>
                </span>
                <span className={styles.cellNote}>
                  {figurePrintWidthMm(r.mm) < r.mm
                    ? `원본은 ${r.mm.toFixed(1)}mm 인데 70mm 상한에 걸렸다 — 70mm 가 맞다`
                    : "원본 지면에서 이만큼이었다"}
                </span>
              </div>
              <div className={`${styles.cell} ${styles.figBox}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" style={figureWidthStyle(r.mm)} />
              </div>
            </div>
          ))}
          <Verdict what="적힌 mm 와 종이의 폭이 같은가" />
        </section>

        {/* ── 2장 — 벡터 vs 래스터 ──────────────────────────── */}
        <section className={styles.page}>
          <header className={styles.pageHead}>
            <span className={styles.pageTitle}>
              ② 벡터 SVG 채택 — 왼쪽이 옛것(래스터), 오른쪽이 지금 나가는
              것(벡터)
            </span>
            <span className={styles.pageNo}>SPECIMEN 2</span>
          </header>

          <p className={styles.lead}>
            1,399 문항의 그림이 <strong>스캔본에서 벡터로</strong> 바뀌었습니다.
            둘을 <strong>같은 폭</strong>으로 놓았으니 다른 것은{" "}
            <strong>선의 굵기·진하기</strong> 뿐입니다. 종이에서 볼 것:
            <br />① 오른쪽 선이 <strong>너무 연하거나 가늘어</strong> 잘 안
            보이지 않는가 — 화면에서는 멀쩡한데 종이에서 사라지는 것이 이 부류의
            위험입니다.
            <br />② 오른쪽에 <strong>빠진 획·글자·화살촉</strong>이
            없는가(왼쪽과 대조).
            <br />③ 오른쪽 칠(면 색)이 왼쪽보다{" "}
            <strong>진해서 글자를 덮지</strong> 않는가.
          </p>

          {svgRows.length === 0 ? (
            <p className={styles.lead}>
              표본이 없습니다 — 원장 파일을 확인하세요.
            </p>
          ) : (
            svgRows.map((s) => (
              <div key={s.svgUrl} className={styles.pair}>
                <div className={`${styles.cell} ${styles.figBox}`}>
                  <span className={styles.cellLabel}>
                    옛것 · 스캔 {s.rasterPx[0]}px
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={s.rasterUrl}
                    alt=""
                    style={figureWidthStyle(s.mm)}
                  />
                  <span className={styles.cellNote}>
                    {s.problemCode} · 그리는 폭{" "}
                    {figurePrintWidthMm(s.mm).toFixed(1)}mm ·{" "}
                    {Math.round(
                      printedDpi(s.rasterPx[0], figurePrintWidthMm(s.mm)),
                    )}
                    dpi
                  </span>
                </div>
                <div className={`${styles.cell} ${styles.figBox}`}>
                  <span className={styles.cellLabel}>
                    지금 나가는 것 · 벡터
                  </span>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={s.svgUrl} alt="" style={figureWidthStyle(s.mm)} />
                  <span className={styles.cellNote}>
                    viewBox {s.svgViewBox[0]}×{s.svgViewBox[1]} · 해상도 제한
                    없음
                  </span>
                </div>
              </div>
            ))
          )}
          <Verdict what="벡터가 종이에서 옛것보다 낫거나 같은가" />
        </section>

        {/* ── 3장 — 배경과 해상도 ──────────────────────────── */}
        <section className={styles.page}>
          <header className={styles.pageHead}>
            <span className={styles.pageTitle}>
              ③ 그림 배경 — 흰 네모가 뜨는가
            </span>
            <span className={styles.pageNo}>SPECIMEN 3</span>
          </header>

          <p className={styles.rowHead}>
            왼쪽이 지금 나가는 것(곱셈 혼합), 오른쪽이 안 걸었을 때
          </p>
          <p className={styles.lead}>
            오려 온 그림은 배경이 <strong>순백</strong>인데 지면은
            미색(#FCFCF8)입니다. 그대로 두면 그림 자리마다{" "}
            <strong>더 밝은 사각형</strong>이 뜹니다. 점선 안의 바탕과 그림
            배경이 <strong>이어져 보이면 통과</strong>, 오른쪽처럼 네모가 뜨면
            불합격입니다. 대신 <strong>연한 회색 획이 사라지지 않았는지</strong>
            도 같이 보세요.
          </p>
          <div className={styles.swatchRow}>
            <span className={styles.swatchLabel}>기준:</span>
            <span className={styles.swatchWarm} />
            <span className={styles.cellNote}>지면색 #FCFCF8</span>
            <span className={styles.swatchWhite} />
            <span className={styles.cellNote}>
              순백 #FFFFFF ← 이 톤이 그림 자리에 보이면 불합격
            </span>
          </div>
          {blendRows.map((r) => (
            <div key={r.url} className={styles.pair}>
              <div
                className={`${styles.cell} ${styles.warmField} ${styles.figBox}`}
              >
                <span className={styles.cellLabel}>지금 나가는 것</span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={r.url}
                  alt=""
                  className={styles.blend}
                  style={figureWidthStyle(r.mm)}
                />
              </div>
              <div
                className={`${styles.cell} ${styles.warmField} ${styles.figBox}`}
              >
                <span className={styles.cellLabel}>
                  안 걸었을 때(견줄 용도)
                </span>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={r.url} alt="" style={figureWidthStyle(r.mm)} />
              </div>
            </div>
          ))}
          <Verdict what="그림 배경이 지면과 이어지는가 · 연한 획이 살아 있는가" />
        </section>

        {/* ── 4장 — 종이 해상도 ────────────────────────────── */}
        <section className={styles.page}>
          <header className={styles.pageHead}>
            <span className={styles.pageTitle}>
              ④ 종이 해상도 — 가장 거친 것부터
            </span>
            <span className={styles.pageNo}>SPECIMEN 4</span>
          </header>
          <p className={styles.lead}>
            1,344장을 다시 오려 픽셀을 촘촘하게 만들었습니다. 다만{" "}
            <strong>종이에 찍히는 dpi 는 「가로 픽셀 ÷ 인쇄 폭」</strong>이라
            그림마다 다릅니다. 아래는 <strong>그 값이 가장 낮은 쪽부터</strong>{" "}
            골랐습니다 — 가장 나쁜 것이 견딜 만하면 나머지는 낫습니다. 눈금
            숫자·라벨이 읽히는지 보세요.
          </p>
          {dpiRows.map((d) => (
            <div key={d.url} className={styles.pair}>
              <div className={styles.cell}>
                <span className={styles.cellLabel}>{d.problemCode}</span>
                <span className={styles.cellNote}>
                  {d.px[0]}×{d.px[1]}px 를 {figurePrintWidthMm(d.mm).toFixed(1)}
                  mm 로 그린다 →{" "}
                  <strong>
                    {Math.round(printedDpi(d.px[0], figurePrintWidthMm(d.mm)))}
                    dpi
                  </strong>
                </span>
              </div>
              <div className={`${styles.cell} ${styles.figBox}`}>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={d.url} alt="" style={figureWidthStyle(d.mm)} />
              </div>
            </div>
          ))}
          <Verdict what="가장 거친 것도 글자·눈금이 읽히는가" />
        </section>
      </div>
    </div>
  );
}
