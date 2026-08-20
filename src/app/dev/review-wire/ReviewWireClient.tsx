"use client";

import { useState } from "react";

import { PaperProblemView } from "@/components/print/PaperProblemView";

/**
 * 검수 콘솔 **와이어 5안** — 눌러 보고 고르는 물건이다 (D-07 1단계).
 *
 * 🔴 ASCII 로 고른 것은 확정이 아니다(2026-08-19 확인테스트 범위 시안).
 *    그래서 처음부터 진짜 화면·진짜 데이터로 낸다.
 */

type Counts = {
  total: number;
  excluded: number;
  pending: number;
  withFigure: number;
  figureNoMm: number;
  noSolution: number;
  units: number;
};

type Row = {
  id: string;
  problemCode: string;
  content: string;
  answer: string;
  solution: string | null;
  questionType: string | null;
  difficulty: string;
  source: string;
  school: string | null;
  figureUrls: string[];
  figureDims: number[];
  figureSourceMm: number[];
  reviewStatus: string;
  directUseAllowed: boolean;
  unitName: string;
};

const WIRES = [
  {
    key: "A",
    name: "한 장씩",
    idea: "한 문항이 화면을 채운다. 넘기고 판정만 한다.",
  },
  { key: "B", name: "목록 + 상세", idea: "왼쪽에서 훑고 오른쪽에서 본다." },
  {
    key: "C",
    name: "격자 대조",
    idea: "여러 개를 한눈에. 튀는 것이 눈에 걸린다.",
  },
  {
    key: "D",
    name: "지면 그대로",
    idea: "시험지 지면으로 본다. 결함은 종이에서 난다.",
  },
  {
    key: "E",
    name: "대기열",
    idea: "무엇을 볼지 시스템이 고른다. 사유를 함께 보여 준다.",
  },
] as const;

const REASONS = [
  "그림이 이상하다",
  "문제가 이상하다",
  "답이 틀렸다",
  "해설이 없다·틀렸다",
  "단원이 틀렸다",
];

const n = (v: number) => v.toLocaleString("ko-KR");

export function ReviewWireClient({
  counts,
  sample,
}: {
  counts: Counts;
  sample: Row[];
}) {
  const [wire, setWire] = useState<string>("A");
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-divider px-6 py-4">
        <h1 className="text-lg font-semibold">
          문제은행 검수 콘솔 — 와이어 시안
        </h1>
        <p className="mt-1 text-sm text-text-2">
          실제 문제은행 {n(counts.total)}문항으로 그렸다. 단원 {n(counts.units)}
          개.
        </p>
        <Scale counts={counts} />
        <nav className="mt-4 flex flex-wrap gap-2">
          {WIRES.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWire(w.key)}
              aria-pressed={wire === w.key}
              className={
                "cursor-pointer rounded border px-3 py-1.5 text-sm " +
                (wire === w.key
                  ? "border-ink bg-ink text-white"
                  : "border-control bg-surface text-ink hover:bg-side")
              }
            >
              {w.key}. {w.name}
            </button>
          ))}
        </nav>
        <p className="mt-2 text-sm text-text-2">
          {WIRES.find((w) => w.key === wire)?.idea}
        </p>
      </header>

      <main className="p-6">
        {wire === "A" && <WireA rows={sample} counts={counts} />}
        {wire === "B" && <WireB rows={sample} counts={counts} />}
        {wire === "C" && <WireC rows={sample} counts={counts} />}
        {wire === "D" && <WireD rows={sample} />}
        {wire === "E" && <WireE rows={sample} counts={counts} />}
      </main>
    </div>
  );
}

/** 🔴 시안이 「47,049」의 무게를 안 보여 주면, 고른 뒤에 무너진다. */
function Scale({ counts }: { counts: Counts }) {
  const hours = Math.round((counts.total * 10) / 3600);
  return (
    <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
      <Stat label="전체" value={n(counts.total)} />
      <Stat label="그림 있음" value={n(counts.withFigure)} />
      <Stat label="해설 없음" value={n(counts.noSolution)} warn />
      <Stat label="출제 제외" value={n(counts.excluded)} />
      <Stat label="검수 대기" value={n(counts.pending)} />
      <Stat label="한 문항 10초로 전부 보면" value={hours + "시간"} warn />
    </dl>
  );
}

function Stat({
  label,
  value,
  warn,
}: {
  label: string;
  value: string;
  warn?: boolean;
}) {
  return (
    <div className="flex gap-1.5">
      <dt className="text-text-2">{label}</dt>
      <dd
        className={
          warn ? "font-semibold text-[var(--red-text)]" : "font-semibold"
        }
      >
        {value}
      </dd>
    </div>
  );
}

/** 신고 — 어느 안이든 알맹이는 같다. 다른 것은 **어디에 붙느냐**다. */
function ReportBox({ compact }: { compact?: boolean }) {
  return (
    <div
      className={
        "rounded border border-divider bg-surface " + (compact ? "p-2" : "p-3")
      }
    >
      <p className="text-sm font-semibold">신고</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS.map((r) => (
          <button
            key={r}
            type="button"
            className="cursor-pointer rounded-full border border-control px-2.5 py-1 text-xs hover:bg-side"
          >
            {r}
          </button>
        ))}
      </div>
      {!compact && (
        <textarea
          rows={2}
          placeholder="무엇이 이상한지 (선택)"
          className="mt-2 w-full rounded border border-control bg-surface p-2 text-sm"
        />
      )}
    </div>
  );
}

function Badges({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-xs text-text-2">
      <span className="rounded border border-divider px-1.5 py-0.5">
        {r.problemCode}
      </span>
      <span>{r.unitName}</span>
      {r.questionType ? <span>· {r.questionType}</span> : null}
      {r.figureUrls.length > 0 ? (
        <span>· 그림 {r.figureUrls.length}</span>
      ) : null}
      {!r.solution ? (
        <span className="text-[var(--red-text)]">· 해설 없음</span>
      ) : null}
      {!r.directUseAllowed ? (
        <span className="text-[var(--red-text)]">· 출제 제외</span>
      ) : null}
    </div>
  );
}

function Problem({ r }: { r: Row }) {
  return (
    <PaperProblemView
      content={r.content}
      figureUrls={r.figureUrls}
      figureDims={r.figureDims}
      figureSourceMm={r.figureSourceMm}
    />
  );
}

/* ── A. 한 장씩 ─────────────────────────────────────────────── */
function WireA({ rows, counts }: { rows: Row[]; counts: Counts }) {
  const [i, setI] = useState(0);
  const r = rows[i];
  return (
    <div className="mx-auto max-w-3xl">
      <div className="flex items-center justify-between text-sm text-text-2">
        <span>
          {n(i + 1)} / {n(counts.total)}
        </span>
        <span>키보드: ← → 이동 · 1 통과 · 2 신고</span>
      </div>
      <div className="mt-2 rounded border border-divider bg-surface p-6">
        <Badges r={r} />
        <div className="mt-4">
          <Problem r={r} />
        </div>
        <p className="mt-4 border-t border-divider pt-3 text-sm">
          <span className="text-text-2">정답</span> {r.answer}
        </p>
        {!r.solution ? (
          <p className="mt-1 text-sm text-[var(--red-text)]">
            해설이 없다 — 답이 맞는지 이 화면에서 검산할 수 없다 (
            {n(counts.noSolution)}건이 이렇다)
          </p>
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setI(Math.max(0, i - 1))}
          className="cursor-pointer rounded border border-control px-3 py-2 text-sm hover:bg-side"
        >
          ← 이전
        </button>
        <button
          type="button"
          onClick={() => setI(Math.min(rows.length - 1, i + 1))}
          className="cursor-pointer rounded border border-control px-3 py-2 text-sm hover:bg-side"
        >
          다음 →
        </button>
        <button
          type="button"
          className="cursor-pointer rounded border border-ink bg-ink px-4 py-2 text-sm text-white"
        >
          통과
        </button>
      </div>
      <div className="mt-3">
        <ReportBox />
      </div>
    </div>
  );
}

/* ── B. 목록 + 상세 ─────────────────────────────────────────── */
function WireB({ rows, counts }: { rows: Row[]; counts: Counts }) {
  const [sel, setSel] = useState(0);
  const r = rows[sel];
  return (
    <div className="grid gap-4 lg:grid-cols-[380px_1fr]">
      <div className="rounded border border-divider bg-surface">
        <p className="border-b border-divider px-3 py-2 text-sm text-text-2">
          {n(counts.total)}문항 · 아래로 계속
        </p>
        <ul className="max-h-[70vh] overflow-y-auto">
          {rows.map((x, i) => (
            <li key={x.id}>
              <button
                type="button"
                onClick={() => setSel(i)}
                aria-current={i === sel}
                className={
                  "block w-full cursor-pointer border-b border-divider px-3 py-2 text-left text-sm hover:bg-side " +
                  (i === sel ? "bg-side" : "")
                }
              >
                <span className="text-text-3">{x.problemCode}</span>{" "}
                <span className="text-text-2">{x.unitName}</span>
                <span className="mt-0.5 line-clamp-2 block text-ink">
                  {x.content.replace(/[$][^$]*[$]/g, " ▫ ").slice(0, 70)}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded border border-divider bg-surface p-5">
        <Badges r={r} />
        <div className="mt-4">
          <Problem r={r} />
        </div>
        <p className="mt-4 border-t border-divider pt-3 text-sm">
          <span className="text-text-2">정답</span> {r.answer}
        </p>
        <div className="mt-4">
          <ReportBox />
        </div>
      </div>
    </div>
  );
}

/* ── C. 격자 대조 ───────────────────────────────────────────── */
/**
 * 🔴 1차 시안에서 칸을 `max-h-56` 으로 **잘라** 놨더니 원장님이 바로 짚으셨다 —
 *    「아래쪽 문제가 짤리는 것 같고, 안 짤리면 생각해볼만함」.
 *    잘리는 것은 격자의 성질이 아니라 **내가 자른 것**이다. 그래서 안 자르고
 *    세우고, 「안 자르면 한 화면에 몇 개가 들어가나」를 **재서** 보여 준다.
 */
function WireC({ rows, counts }: { rows: Row[]; counts: Counts }) {
  const [clip, setClip] = useState(false);
  const [cols, setCols] = useState(3);
  const colClass =
    cols === 2
      ? "md:grid-cols-2"
      : cols === 3
        ? "md:grid-cols-3"
        : "md:grid-cols-4";
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={clip}
            onChange={(e) => setClip(e.target.checked)}
            className="cursor-pointer"
          />
          칸 높이를 자른다
        </label>
        <span className="text-text-2">칸 수</span>
        {[2, 3, 4].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCols(c)}
            aria-pressed={cols === c}
            className={
              "cursor-pointer rounded border px-2 py-1 " +
              (cols === c
                ? "border-ink bg-ink text-white"
                : "border-control bg-surface hover:bg-side")
            }
          >
            {c}
          </button>
        ))}
        <span className="text-text-2">
          {clip
            ? "자르면 한눈에 많이 들어오지만 아래쪽 보기·정답이 사라진다"
            : "안 자르면 문항이 통째로 보이는 대신 칸 높이가 들쭉날쭉해진다"}
        </span>
      </div>
      <p className="mb-3 text-sm text-text-2">
        전체 {n(counts.total)}문항. 아래는 실제 문항 {rows.length}개를 그린
        것이다 —
        <strong className="text-ink">
          {" "}
          화면 하나에 몇 개가 들어가는지 직접 세어 보시라.
        </strong>
      </p>
      <div className={"grid grid-cols-1 gap-3 " + colClass}>
        {rows.map((r) => (
          <div
            key={r.id}
            data-card="1"
            className="flex min-w-0 flex-col rounded border border-divider bg-surface p-2"
          >
            <Badges r={r} />
            <div
              className={
                "mt-1 min-w-0 text-[12px] " +
                (clip ? "max-h-56 overflow-hidden" : "overflow-x-auto")
              }
            >
              <Problem r={r} />
              <p className="mt-2 border-t border-divider pt-1 text-text-2">
                정답 {r.answer}
              </p>
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                type="button"
                className="cursor-pointer rounded border border-control px-2 py-1 text-xs hover:bg-side"
              >
                크게
              </button>
              <button
                type="button"
                className="cursor-pointer rounded border border-control px-2 py-1 text-xs hover:bg-side"
              >
                신고
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── D. 단 흐름 ─────────────────────────────────────────────── */
/**
 * 🔴 원장님 지적 둘을 다 고친 자리다.
 *
 * ⑴ 「너무 구분이 없어서 정신없을 것 같다」 — 맞다. 시험지는 **학생이 순서대로
 *    푸는** 지면이라 구분이 약해도 되지만, 검수는 **한 문항씩 판정**하는 일이라
 *    경계가 있어야 한다. 구분을 켜고 끌 수 있게 두고 켠 쪽을 기본으로 한다.
 *
 * ⑵ CSS 다단(`columns`)으로 그렸더니 **4단에서 칸이 서로 겹쳤다.** 칸이 단 높이보다
 *    크면 `break-inside-avoid` 를 지킬 수 없어 넘쳐 나온 것이다. 그래서 다단을
 *    버리고 **단을 명시적으로 나눈다** — 겹칠 수가 없다.
 *    (측정으로만 드러났다. 2단에서는 멀쩡해 보였다.)
 */
function WireD({ rows }: { rows: Row[] }) {
  const [divide, setDivide] = useState(true);
  const [cols, setCols] = useState(3);
  // 단을 직접 나눈다 — 번갈아 넣으면 개수가 고르게 퍼진다.
  const columns: Row[][] = Array.from({ length: cols }, () => []);
  rows.forEach((r, k) => columns[k % cols].push(r));
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex cursor-pointer items-center gap-1.5">
          <input
            type="checkbox"
            checked={divide}
            onChange={(e) => setDivide(e.target.checked)}
            className="cursor-pointer"
          />
          문항 구분을 준다
        </label>
        <span className="text-text-2">단 수</span>
        {[2, 3, 4].map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => setCols(c)}
            aria-pressed={cols === c}
            className={
              "cursor-pointer rounded border px-2 py-1 " +
              (cols === c
                ? "border-ink bg-ink text-white"
                : "border-control bg-surface hover:bg-side")
            }
          >
            {c}
          </button>
        ))}
        <span className="text-text-2">
          격자와 달리 칸 높이가 달라도 빈자리가 안 생긴다
        </span>
      </div>
      <div className="flex items-start gap-4">
        {columns.map((col, ci) => (
          <div key={ci} className="flex min-w-0 flex-1 flex-col gap-4">
            {col.map((r) => (
              <div
                key={r.id}
                data-card="1"
                className={
                  "min-w-0 " +
                  (divide ? "rounded border border-divider p-3" : "")
                }
              >
                <div className="flex items-center gap-2">
                  <span
                    className={
                      "text-xs " +
                      (divide
                        ? "rounded bg-ink px-1.5 py-0.5 font-semibold text-white"
                        : "text-text-3")
                    }
                  >
                    {r.problemCode}
                  </span>
                  {!r.solution ? (
                    <span className="text-xs text-[var(--red-text)]">
                      해설 없음
                    </span>
                  ) : null}
                  {!r.directUseAllowed ? (
                    <span className="text-xs text-[var(--red-text)]">
                      출제 제외
                    </span>
                  ) : null}
                </div>
                <div className="mt-2 min-w-0 overflow-x-auto">
                  <Problem r={r} />
                </div>
                <p className="mt-2 text-xs text-text-2">정답 {r.answer}</p>
                <button
                  type="button"
                  className="mt-1 cursor-pointer text-xs text-blue underline"
                >
                  이 문항 신고
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ── E. 대기열 ──────────────────────────────────────────────── */
function WireE({ rows, counts }: { rows: Row[]; counts: Counts }) {
  const queue = [
    {
      why: "그림은 있는데 원본 크기(mm)를 모른다 — 인쇄 크기가 추측이다",
      count: counts.figureNoMm,
    },
    { why: "검수 대기 — 사람이 아직 안 봤다", count: counts.pending },
    {
      why: "출제에서 빠져 있다 — 사유가 아직 안 풀렸다",
      count: counts.excluded,
    },
    {
      why: "해설이 없다 — 답을 검산할 근거가 화면에 없다",
      count: counts.noSolution,
    },
  ];
  const [k, setK] = useState(0);
  const r = rows[k];
  return (
    <div className="grid gap-4 lg:grid-cols-[300px_1fr]">
      <div>
        <p className="text-sm text-text-2">왜 이게 올라왔나</p>
        <ul className="mt-2 space-y-2">
          {queue.map((q) => (
            <li
              key={q.why}
              className="rounded border border-divider bg-surface p-3"
            >
              <p className="text-sm">{q.why}</p>
              <p className="mt-1 text-sm font-semibold">{n(q.count)}건</p>
            </li>
          ))}
        </ul>
        <p className="mt-3 text-sm text-text-2">
          전부 보는 것은 불가능하다({n(counts.total)}문항). 그래서 시스템이
          고른다.
        </p>
      </div>
      <div className="rounded border border-divider bg-surface p-5">
        <p className="text-sm text-text-2">
          지금 사유:{" "}
          <span className="text-ink">그림은 있는데 원본 크기(mm)를 모른다</span>
        </p>
        <div className="mt-3">
          <Badges r={r} />
          <div className="mt-3">
            <Problem r={r} />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          <button
            type="button"
            className="cursor-pointer rounded border border-ink bg-ink px-4 py-2 text-sm text-white"
          >
            문제 없다
          </button>
          <button
            type="button"
            onClick={() => setK((k + 1) % rows.length)}
            className="cursor-pointer rounded border border-control px-3 py-2 text-sm hover:bg-side"
          >
            건너뛰기
          </button>
        </div>
        <div className="mt-3">
          <ReportBox compact />
        </div>
      </div>
    </div>
  );
}
