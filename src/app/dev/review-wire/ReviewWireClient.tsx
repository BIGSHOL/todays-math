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
      <dd className={warn ? "font-semibold text-red-text" : "font-semibold"}>
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
      {!r.solution ? <span className="text-red-text">· 해설 없음</span> : null}
      {!r.directUseAllowed ? (
        <span className="text-red-text">· 출제 제외</span>
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
          <p className="mt-1 text-sm text-red-text">
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
function WireC({ rows, counts }: { rows: Row[]; counts: Counts }) {
  return (
    <div>
      <p className="mb-3 text-sm text-text-2">
        한 화면에 12개. {n(counts.total)}문항이면{" "}
        {n(Math.ceil(counts.total / 12))}화면. 튀는 것만 눌러서 크게 본다.
      </p>
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-4">
        {rows.slice(0, 12).map((r) => (
          <div
            key={r.id}
            className="rounded border border-divider bg-surface p-2"
          >
            <Badges r={r} />
            <div className="mt-1 max-h-56 overflow-hidden text-[11px]">
              <Problem r={r} />
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

/* ── D. 지면 그대로 ─────────────────────────────────────────── */
function WireD({ rows }: { rows: Row[] }) {
  return (
    <div>
      <p className="mb-3 text-sm text-text-2">
        시험지와 같은 두 단 배치. 넘침·겹침처럼 종이에서만 나는 결함이 보인다.
      </p>
      <div className="mx-auto max-w-4xl rounded border border-divider bg-surface p-6">
        <div className="columns-2 gap-8">
          {rows.slice(0, 8).map((r, i) => (
            <div key={r.id} className="mb-5 break-inside-avoid">
              <p className="text-xs text-text-3">
                {i + 1}번 · {r.problemCode}
              </p>
              <Problem r={r} />
              <button
                type="button"
                className="mt-1 cursor-pointer text-xs text-blue underline"
              >
                이 문항 신고
              </button>
            </div>
          ))}
        </div>
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
