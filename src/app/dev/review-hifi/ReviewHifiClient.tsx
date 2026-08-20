"use client";

import { useEffect, useState } from "react";

import { PaperProblemView } from "@/components/print/PaperProblemView";

/**
 * 검수 콘솔 **Hi-fi 4안** — A(한 장씩) + E(대기열) 확정본의 시안 (D-07 2단계).
 *
 * 네 안이 다투는 것은 배치가 아니라 **대기열을 어디에 두느냐**다.
 *   ① 늘 옆에  ② 위에 한 줄  ③ 판정을 오른쪽에  ④ 고르고 나면 사라진다
 *
 * 🔴 **판정은 셋이다.** 문제은행의 70%(32,931건)가 해설이 없어 답을 검산할 수
 *    없다. 「통과 / 신고」 둘만 두면 **확인 못 한 것에 통과를 누르게** 되고,
 *    그러면 검수 기록 전체가 잡음이 된다. 「판단 못 하겠다」를 정식 결과로 둔다.
 */

type Row = {
  id: string;
  problemCode: string;
  content: string;
  answer: string;
  solution: string | null;
  questionType: string | null;
  figureUrls: string[];
  figureDims: number[];
  figureSourceMm: number[];
  directUseAllowed: boolean;
  unitName: string;
};

type Queue = {
  key: string;
  label: string;
  why: string;
  look: string;
  count: number;
  rows: Row[];
};

const HIFI = [
  {
    key: "1",
    name: "옆에 둔다",
    idea: "대기열이 왼쪽에 늘 있다. 맥락이 안 사라진다.",
  },
  {
    key: "2",
    name: "위에 한 줄",
    idea: "사유만 위에 한 줄. 지면이 가장 넓다.",
  },
  {
    key: "3",
    name: "판정을 오른쪽에",
    idea: "손이 한자리에 머문다. 키보드가 주인공.",
  },
  {
    key: "4",
    name: "고르고 몰입",
    idea: "먼저 대기열을 고르고, 들어가면 화면에 문항뿐.",
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

export function ReviewHifiClient({
  total,
  queues,
}: {
  total: number;
  queues: Queue[];
}) {
  const [hifi, setHifi] = useState<string>("1");
  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-divider px-6 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-base font-semibold">검수 콘솔 — Hi-fi 시안</h1>
          <p className="text-sm text-text-2">
            A(한 장씩) + E(대기열) 확정본. 다른 것은{" "}
            <strong className="text-ink">대기열을 어디에 두느냐</strong>뿐이다.
          </p>
        </div>
        <nav className="mt-3 flex flex-wrap gap-2">
          {HIFI.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => setHifi(h.key)}
              aria-pressed={hifi === h.key}
              className={
                "cursor-pointer rounded-md border px-3 py-1.5 text-sm transition-colors " +
                (hifi === h.key
                  ? "border-ink bg-ink text-white"
                  : "border-control bg-surface text-ink hover:bg-side")
              }
            >
              {h.key}. {h.name}
            </button>
          ))}
          <span className="self-center text-sm text-text-2">
            {HIFI.find((h) => h.key === hifi)?.idea}
          </span>
        </nav>
      </header>

      {hifi === "1" && <Hifi1 queues={queues} total={total} />}
      {hifi === "2" && <Hifi2 queues={queues} total={total} />}
      {hifi === "3" && <Hifi3 queues={queues} total={total} />}
      {hifi === "4" && <Hifi4 queues={queues} total={total} />}
    </div>
  );
}

/** 대기열 하나를 붙들고 한 문항씩 넘기는 상태. 네 안이 같이 쓴다. */
function useQueue(queues: Queue[]) {
  const [qi, setQi] = useState(0);
  const [k, setK] = useState(0);
  const [done, setDone] = useState(0);
  const q = queues[qi];
  const r = q.rows[k % q.rows.length];
  const next = () => {
    setK((v) => v + 1);
    setDone((v) => v + 1);
  };
  const pick = (i: number) => {
    setQi(i);
    setK(0);
  };
  return { q, r, qi, pick, next, done };
}

/* ── 알맹이들 ─────────────────────────────────────────────────── */

function Meta({ r }: { r: Row }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2">
      <span className="rounded border border-divider px-1.5 py-0.5 font-medium tracking-wide text-ink">
        {r.problemCode}
      </span>
      <span>{r.unitName}</span>
      {r.questionType ? <span>{r.questionType}</span> : null}
      {r.figureUrls.length > 0 ? (
        <span>그림 {r.figureUrls.length}장</span>
      ) : null}
      {!r.directUseAllowed ? (
        <span className="font-medium text-[var(--red-text)]">출제 제외</span>
      ) : null}
    </div>
  );
}

/**
 * 본문 + **그림 다시 그리기**.
 *
 * 🔴 새로 그린 그림은 **반드시 원본과 나란히** 보여야 판정할 수 있다. 오늘 하루
 *    이 방식으로 SVG 채택을 검수했고, 「비율·잉크량이 맞는 다른 그림」이 수치
 *    가드를 전부 통과한 채 나왔다 — 한 장만 보면 절대 안 걸린다.
 */
function Body({ r }: { r: Row }) {
  const [fig, setFig] = useState<"none" | "loading" | "made">("none");
  const has = r.figureUrls.length > 0;
  return (
    <div>
      <div className="min-w-0 overflow-x-auto text-[15px] leading-relaxed">
        <PaperProblemView
          content={r.content}
          figureUrls={r.figureUrls}
          figureDims={r.figureDims}
          figureSourceMm={r.figureSourceMm}
        />
      </div>

      {has && fig === "none" ? (
        <button
          type="button"
          onClick={() => {
            setFig("loading");
            window.setTimeout(() => setFig("made"), 900);
          }}
          className="mt-2 cursor-pointer rounded-md border border-control bg-surface px-2.5 py-1 text-[13px] font-medium hover:bg-side"
        >
          SVG 로 다시 그리기
        </button>
      ) : null}

      {fig === "loading" ? (
        <p className="mt-2 text-[13px] text-text-2" role="status">
          도형 엔진이 그리는 중…
        </p>
      ) : null}

      {fig === "made" ? (
        <div className="mt-3 rounded-md border border-[var(--yellow-text)]/40 bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[var(--yellow-text)] px-1.5 py-0.5 text-[12px] font-semibold text-white">
              엔진이 다시 그린 그림 · 검수 전
            </span>
            <span className="text-[12px] text-text-2">
              원본과 나란히 놓고 봐야 다른 그림인지 보인다.
            </span>
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <figure className="min-w-0">
              <figcaption className="mb-1 text-[12px] text-text-2">
                지금 (원본)
              </figcaption>
              <div className="overflow-x-auto rounded border border-divider p-2">
                <PaperProblemView
                  content="[그림]"
                  figureUrls={r.figureUrls.slice(0, 1)}
                  figureDims={r.figureDims.slice(0, 2)}
                  figureSourceMm={r.figureSourceMm.slice(0, 1)}
                />
              </div>
            </figure>
            <figure className="min-w-0">
              <figcaption className="mb-1 text-[12px] text-text-2">
                새로 그린 것
              </figcaption>
              <div className="flex min-h-[120px] items-center justify-center rounded border border-divider p-2 text-[12px] text-text-3">
                (시안) 엔진이 그린 SVG 가 같은 인쇄 크기로 여기 들어간다
              </div>
            </figure>
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-md border border-ink bg-ink px-3 py-1.5 text-[13px] font-medium text-white"
            >
              이 그림 쓴다
            </button>
            <button
              type="button"
              onClick={() => setFig("loading")}
              className="cursor-pointer rounded-md border border-control bg-surface px-3 py-1.5 text-[13px] hover:bg-side"
            >
              다시 그리기
            </button>
            <button
              type="button"
              onClick={() => setFig("none")}
              className="cursor-pointer rounded-md border border-control bg-surface px-3 py-1.5 text-[13px] hover:bg-side"
            >
              버린다
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

/**
 * 정답 — 해설이 없으면 그 사실을 **답 옆에** 붙인다. 그게 판정을 가르는 정보다.
 *
 * 🔴 해설 없음이 32,931건(70%)이라 「해설 생성」이 여기 붙는다. 다만 만들어진
 *    해설은 **교재 해설과 반드시 구분해서** 보인다 — 안 그러면 다음 사람이
 *    둘을 못 가르고, 틀린 해설이 「원래 그랬던 것」이 된다.
 *    그리고 생성 직후는 **검수 전**이다. 사람이 「이 해설 쓴다」를 눌러야 남는다(D-22 결).
 */
function Answer({ r }: { r: Row }) {
  const [state, setState] = useState<"none" | "loading" | "made">("none");
  return (
    <div className="mt-5 border-t border-divider pt-3">
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="text-[13px] text-text-2">정답</span>
        <span className="text-[15px] font-semibold">{r.answer}</span>
      </div>

      {r.solution ? (
        <details className="mt-2">
          <summary className="cursor-pointer text-[13px] text-blue">
            해설 보기
          </summary>
          <div className="mt-2 text-[14px] leading-relaxed text-text-2">
            <PaperProblemView content={r.solution} />
          </div>
        </details>
      ) : state === "none" ? (
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-[var(--red-text)]">
            해설이 없다 — 이 화면만으로는 답을 검산할 수 없다.
          </p>
          <button
            type="button"
            onClick={() => {
              setState("loading");
              window.setTimeout(() => setState("made"), 900);
            }}
            className="cursor-pointer rounded-md border border-control bg-surface px-2.5 py-1 text-[13px] font-medium hover:bg-side"
          >
            해설 생성
          </button>
        </div>
      ) : state === "loading" ? (
        <p className="mt-2 text-[13px] text-text-2" role="status">
          해설을 만드는 중… (10~30초)
        </p>
      ) : (
        <div className="mt-2 rounded-md border border-[var(--yellow-text)]/40 bg-surface p-3">
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-[var(--yellow-text)] px-1.5 py-0.5 text-[12px] font-semibold text-white">
              AI 가 만든 해설 · 검수 전
            </span>
            <span className="text-[12px] text-text-2">
              교재 해설이 아니다. 맞는지 보고 결정하시라.
            </span>
          </div>
          <div className="mt-2 text-[14px] leading-relaxed text-text-2">
            <PaperProblemView
              content={
                "(시안) 정답 " + r.answer + " 로 가는 풀이가 여기 들어간다."
              }
            />
          </div>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              className="cursor-pointer rounded-md border border-ink bg-ink px-3 py-1.5 text-[13px] font-medium text-white"
            >
              이 해설 쓴다
            </button>
            <button
              type="button"
              onClick={() => setState("loading")}
              className="cursor-pointer rounded-md border border-control bg-surface px-3 py-1.5 text-[13px] hover:bg-side"
            >
              다시 만들기
            </button>
            <button
              type="button"
              onClick={() => setState("none")}
              className="cursor-pointer rounded-md border border-control bg-surface px-3 py-1.5 text-[13px] hover:bg-side"
            >
              버린다
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * 판정 — **셋**이다. 「판단 못 하겠다」가 없으면 확인 못 한 것에 통과가 눌린다.
 */
function Verdict({
  onNext,
  onReport,
  reporting,
  vertical,
}: {
  onNext: () => void;
  onReport: () => void;
  reporting: boolean;
  vertical?: boolean;
}) {
  const btnBase =
    "cursor-pointer rounded-md px-4 py-2.5 text-sm font-medium transition-colors";
  return (
    <div className={vertical ? "flex flex-col gap-2" : "flex flex-wrap gap-2"}>
      <button
        type="button"
        onClick={onNext}
        className={
          btnBase + " border border-ink bg-ink text-white hover:opacity-90"
        }
      >
        문제 없다 <kbd className="ml-1 font-normal opacity-70">1</kbd>
      </button>
      <button
        type="button"
        onClick={onReport}
        aria-pressed={reporting}
        className={
          btnBase +
          " border " +
          (reporting
            ? "border-[var(--red-text)] bg-[var(--red-text)] text-white"
            : "border-control bg-surface hover:bg-side")
        }
      >
        신고 <kbd className="ml-1 font-normal opacity-70">2</kbd>
      </button>
      <button
        type="button"
        onClick={onNext}
        className={btnBase + " border border-control bg-surface hover:bg-side"}
      >
        판단 못 하겠다 <kbd className="ml-1 font-normal opacity-70">3</kbd>
      </button>
    </div>
  );
}

function ReportPanel({ open }: { open: boolean }) {
  if (!open) return null;
  return (
    <div className="mt-3 rounded-md border border-[var(--red-text)]/40 bg-surface p-3">
      <p className="text-[13px] font-semibold text-[var(--red-text)]">
        무엇이 이상한가
      </p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {REASONS.map((x) => (
          <button
            key={x}
            type="button"
            className="cursor-pointer rounded-full border border-control px-2.5 py-1 text-[13px] hover:bg-side"
          >
            {x}
          </button>
        ))}
      </div>
      <textarea
        rows={2}
        placeholder="덧붙일 말 (선택)"
        className="mt-2 w-full rounded-md border border-control bg-surface p-2 text-sm"
      />
      <div className="mt-2 flex gap-2">
        <button
          type="button"
          className="cursor-pointer rounded-md border border-[var(--red-text)] bg-[var(--red-text)] px-3 py-1.5 text-sm font-medium text-white"
        >
          신고하고 다음
        </button>
      </div>
    </div>
  );
}

/** 진행 — 「얼마나 남았나」가 안 보이면 47,049 앞에서 사람이 지친다. */
function Progress({ q, done }: { q: Queue; done: number }) {
  const pct = Math.min(100, (done / Math.max(q.count, 1)) * 100);
  return (
    <div className="min-w-[140px]">
      <div className="flex items-baseline justify-between text-[13px]">
        <span className="text-text-2">오늘 본 것</span>
        <span className="font-semibold tabular-nums">
          {n(done)}{" "}
          <span className="font-normal text-text-2">/ {n(q.count)}</span>
        </span>
      </div>
      <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-seg-empty">
        <div className="h-full bg-ink" style={{ width: pct + "%" }} />
      </div>
    </div>
  );
}

function QueueList({
  queues,
  qi,
  pick,
  compact,
}: {
  queues: Queue[];
  qi: number;
  pick: (i: number) => void;
  compact?: boolean;
}) {
  return (
    <ul className="space-y-1.5">
      {queues.map((x, i) => (
        <li key={x.key}>
          <button
            type="button"
            onClick={() => pick(i)}
            aria-current={i === qi}
            className={
              "block w-full cursor-pointer rounded-md border px-3 py-2 text-left transition-colors " +
              (i === qi
                ? "border-ink bg-side"
                : "border-divider bg-surface hover:bg-side")
            }
          >
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{x.label}</span>
              <span className="text-[13px] tabular-nums text-text-2">
                {n(x.count)}
              </span>
            </div>
            {!compact && (
              <p className="mt-1 text-[12px] leading-snug text-text-2">
                {x.why}
              </p>
            )}
          </button>
        </li>
      ))}
    </ul>
  );
}

/** 「무엇을 보라」 — 사유마다 볼 것이 다르다. 이게 없으면 그냥 넘기게 된다. */
function LookFor({ q }: { q: Queue }) {
  return (
    <p className="text-[13px] text-text-2">
      <span className="font-medium text-ink">볼 것</span> · {q.look}
    </p>
  );
}

/* ── ① 옆에 둔다 ────────────────────────────────────────────── */
function Hifi1({ queues, total }: { queues: Queue[]; total: number }) {
  const { q, r, qi, pick, next, done } = useQueue(queues);
  const [rep, setRep] = useState(false);
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[280px_1fr]">
      <aside>
        <p className="text-[13px] text-text-2">
          전체 {n(total)}문항 — 다 볼 수는 없다. 무엇부터 볼지 고른다.
        </p>
        <div className="mt-3">
          <QueueList queues={queues} qi={qi} pick={pick} />
        </div>
        <div className="mt-5">
          <Progress q={q} done={done} />
        </div>
      </aside>
      <main className="mx-auto w-full max-w-2xl">
        <LookFor q={q} />
        <article className="mt-3 rounded-lg border border-divider bg-surface p-6">
          <Meta r={r} />
          <div className="mt-4">
            <Body r={r} />
          </div>
          <Answer r={r} />
        </article>
        <div className="mt-4">
          <Verdict
            onNext={() => {
              setRep(false);
              next();
            }}
            onReport={() => setRep((v) => !v)}
            reporting={rep}
          />
          <ReportPanel open={rep} />
        </div>
      </main>
    </div>
  );
}

/* ── ② 위에 한 줄 ──────────────────────────────────────────── */
function Hifi2({ queues, total }: { queues: Queue[]; total: number }) {
  const { q, r, qi, pick, next, done } = useQueue(queues);
  const [rep, setRep] = useState(false);
  const [open, setOpen] = useState(false);
  return (
    <div>
      <div className="border-b border-divider bg-side/40 px-6 py-2">
        <div className="mx-auto flex max-w-4xl flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="cursor-pointer rounded-md border border-control bg-surface px-3 py-1.5 text-sm hover:bg-side"
          >
            {q.label}{" "}
            <span className="tabular-nums text-text-2">{n(q.count)}</span>{" "}
            <span aria-hidden>{open ? "▲" : "▼"}</span>
          </button>
          <LookFor q={q} />
          <div className="ml-auto">
            <Progress q={q} done={done} />
          </div>
        </div>
        {open && (
          <div className="mx-auto mt-2 max-w-4xl">
            <QueueList queues={queues} qi={qi} pick={pick} compact />
            <p className="mt-2 text-[12px] text-text-2">
              전체 {n(total)}문항. 대기열은 「무엇부터 볼까」를 대신 정해 준다.
            </p>
          </div>
        )}
      </div>
      <main className="mx-auto w-full max-w-4xl p-6">
        <article className="rounded-lg border border-divider bg-surface p-8">
          <Meta r={r} />
          <div className="mt-4">
            <Body r={r} />
          </div>
          <Answer r={r} />
        </article>
        <div className="mt-4">
          <Verdict
            onNext={() => {
              setRep(false);
              next();
            }}
            onReport={() => setRep((v) => !v)}
            reporting={rep}
          />
          <ReportPanel open={rep} />
        </div>
      </main>
    </div>
  );
}

/* ── ③ 판정을 오른쪽에 ─────────────────────────────────────── */
function Hifi3({ queues, total }: { queues: Queue[]; total: number }) {
  const { q, r, qi, pick, next, done } = useQueue(queues);
  const [rep, setRep] = useState(false);
  // 키보드가 주인공인 안이라, 실제로 키가 먹는지 눌러 보실 수 있게 한다.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      if (e.key === "1") {
        setRep(false);
        next();
      }
      if (e.key === "2") setRep((v) => !v);
      if (e.key === "3") {
        setRep(false);
        next();
      }
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  });
  return (
    <div className="grid gap-6 p-6 lg:grid-cols-[1fr_300px]">
      <main className="mx-auto w-full max-w-2xl">
        <div className="flex flex-wrap items-center gap-x-3">
          <span className="rounded-md bg-side px-2 py-1 text-[13px] font-medium">
            {q.label}
          </span>
          <LookFor q={q} />
        </div>
        <article className="mt-3 rounded-lg border border-divider bg-surface p-6">
          <Meta r={r} />
          <div className="mt-4">
            <Body r={r} />
          </div>
          <Answer r={r} />
        </article>
      </main>
      <aside className="lg:sticky lg:top-6 lg:self-start">
        <Verdict
          onNext={() => {
            setRep(false);
            next();
          }}
          onReport={() => setRep((v) => !v)}
          reporting={rep}
          vertical
        />
        <ReportPanel open={rep} />
        <div className="mt-5">
          <Progress q={q} done={done} />
        </div>
        <p className="mt-3 text-[12px] text-text-2">
          키보드 1·2·3 이 실제로 먹는다. 눌러 보시라.
        </p>
        <details className="mt-4">
          <summary className="cursor-pointer text-[13px] text-blue">
            대기열 바꾸기
          </summary>
          <div className="mt-2">
            <QueueList queues={queues} qi={qi} pick={pick} compact />
          </div>
          <p className="mt-2 text-[12px] text-text-2">전체 {n(total)}문항</p>
        </details>
      </aside>
    </div>
  );
}

/* ── ④ 고르고 몰입 ─────────────────────────────────────────── */
function Hifi4({ queues, total }: { queues: Queue[]; total: number }) {
  const { q, r, qi, pick, next, done } = useQueue(queues);
  const [inside, setInside] = useState(false);
  const [rep, setRep] = useState(false);

  if (!inside) {
    return (
      <div className="mx-auto max-w-3xl p-6">
        <p className="text-[13px] text-text-2">
          전체 {n(total)}문항. 한 문항 10초로도 131시간이라 다 볼 수는 없다.
          <strong className="text-ink"> 오늘 무엇을 볼지 하나만 고른다.</strong>
        </p>
        <ul className="mt-4 space-y-3">
          {queues.map((x, i) => (
            <li key={x.key}>
              <button
                type="button"
                onClick={() => {
                  pick(i);
                  setInside(true);
                }}
                className="block w-full cursor-pointer rounded-lg border border-divider bg-surface p-5 text-left transition-colors hover:bg-side"
              >
                <div className="flex items-baseline justify-between gap-3">
                  <span className="text-base font-semibold">{x.label}</span>
                  <span className="text-lg font-semibold tabular-nums">
                    {n(x.count)}
                  </span>
                </div>
                <p className="mt-1.5 text-sm leading-snug text-text-2">
                  {x.why}
                </p>
                <p className="mt-2 text-[13px] text-text-2">
                  <span className="font-medium text-ink">볼 것</span> · {x.look}
                </p>
              </button>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl p-6">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <button
          type="button"
          onClick={() => setInside(false)}
          className="cursor-pointer rounded-md border border-control bg-surface px-2.5 py-1 text-[13px] hover:bg-side"
        >
          ← 대기열
        </button>
        <span className="text-[13px] font-medium">{q.label}</span>
        <div className="ml-auto">
          <Progress q={q} done={done} />
        </div>
      </div>
      <article className="mt-4 rounded-lg border border-divider bg-surface p-8">
        <Meta r={r} />
        <div className="mt-4">
          <Body r={r} />
        </div>
        <Answer r={r} />
      </article>
      <div className="mt-4">
        <Verdict
          onNext={() => {
            setRep(false);
            next();
          }}
          onReport={() => setRep((v) => !v)}
          reporting={rep}
        />
        <ReportPanel open={rep} />
      </div>
      <p className="mt-4 text-[12px] text-text-2">
        {qi >= 0 ? <LookFor q={q} /> : null}
      </p>
    </div>
  );
}
