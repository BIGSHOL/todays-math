"use client";

/**
 * 검수 콘솔 — 원장님이 고르신 **③안(판정을 오른쪽에)**. D-07 2단계 확정본.
 * 시안: /dev/review-hifi · 계약: src/contracts/review.contract.ts
 *
 * 🔴 **판정은 셋이다.** 문제은행의 70%가 해설이 없어 답을 검산할 수 없다.
 *    「통과 / 신고」 둘만 두면 확인 못 한 것에 통과를 누르게 되고, 그러면
 *    검수 기록 전체가 잡음이 된다. 「판단 못 하겠다」를 정식 결과로 둔다.
 *
 * 🔴 **판정 결과는 서버가 확정한다.** 화면이 「통과를 눌렀으니 승인됐겠지」라고
 *    가정하면 서버 규칙이 바뀐 날 화면만 거짓말을 한다.
 *
 * ⚠️ 「해설 생성」·「그림 다시 그리기」는 아직 라우트가 없다. 시안에는 있지만
 *    여기 안 붙였다 — **눌러도 아무 일도 안 하는 단추**는 검수자를 속인다.
 */
import { useCallback, useEffect, useRef, useState } from "react";

import { PaperProblemView } from "@/components/print/PaperProblemView";
import { REASON_LABELS, REASON_ORDER } from "@/components/review/reasonLabels";
import type { ReportReason } from "@/contracts/problemReport.contract";
import type {
  ReviewQueueKey,
  ReviewVerdict,
} from "@/contracts/review.contract";

export type ConsoleProblem = {
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

export type ConsoleQueue = {
  key: ReviewQueueKey;
  label: string;
  why: string;
  look: string;
  remaining: number;
};

const n = (v: number) => v.toLocaleString("ko-KR");

/** 이 아래로 남으면 다음 묶음을 더 가져온다. 0에서 가져오면 화면이 한 번 빈다. */
const REFILL_AT = 3;

export function ReviewConsole({
  queues,
  initialKey,
  initialRows,
  reviewedByMe,
}: {
  queues: ConsoleQueue[];
  initialKey: ReviewQueueKey;
  initialRows: ConsoleProblem[];
  reviewedByMe: number;
}) {
  const [qs, setQs] = useState(queues);
  const [key, setKey] = useState<ReviewQueueKey>(initialKey);
  const [rows, setRows] = useState<ConsoleProblem[]>(initialRows);
  const [done, setDone] = useState(0);
  const [total, setTotal] = useState(reviewedByMe);
  const [reporting, setReporting] = useState(false);
  const [reason, setReason] = useState<ReportReason | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const queue = qs.find((q) => q.key === key) ?? qs[0];
  const row = rows[0];
  const loading = useRef(false);

  const load = useCallback(async (k: ReviewQueueKey, replace: boolean) => {
    if (loading.current) return;
    loading.current = true;
    try {
      const res = await fetch(
        `/api/review/queue?key=${encodeURIComponent(k)}&limit=10`,
      );
      if (!res.ok) throw new Error("대기열을 불러오지 못했습니다.");
      const body = (await res.json()) as {
        data: ConsoleProblem[];
        meta: { queue: ConsoleQueue; reviewedByMe: number };
      };
      setRows((prev) => {
        if (replace) return body.data;
        const have = new Set(prev.map((p) => p.id));
        return [...prev, ...body.data.filter((p) => !have.has(p.id))];
      });
      setQs((prev) =>
        prev.map((q) => (q.key === k ? { ...q, ...body.meta.queue } : q)),
      );
      setTotal(body.meta.reviewedByMe);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "대기열을 불러오지 못했습니다.",
      );
    } finally {
      loading.current = false;
    }
  }, []);

  const submit = useCallback(
    async (verdict: ReviewVerdict, why?: ReportReason, memo?: string) => {
      if (!row || busy) return;
      setBusy(true);
      setError(null);
      try {
        const res = await fetch(`/api/problems/${row.id}/review`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            verdict,
            ...(why ? { reason: why } : {}),
            ...(memo && memo.trim() ? { note: memo.trim() } : {}),
          }),
        });
        if (!res.ok) {
          const b = (await res.json().catch(() => null)) as {
            error?: { message?: string };
          } | null;
          throw new Error(b?.error?.message ?? "판정을 저장하지 못했습니다.");
        }
        /**
         * 🔴 보충을 **효과에 걸지 않는다.** `rows.length` 를 보는 효과로 하면
         *    렌더 중에 상태를 또 바꾸는 꼴이라 ESLint(react-hooks/set-state-in-effect)
         *    가 막고, 실제로도 대기열을 바꾸는 순간 두 번 부르게 된다.
         *    「판정했으니 하나 줄었다」는 **여기서만** 참이므로 여기서 채운다.
         */
        const left = rows.length - 1;
        setRows((prev) => prev.slice(1));
        if (left <= REFILL_AT) void load(key, false);
        setDone((v) => v + 1);
        setTotal((v) => v + 1);
        setQs((prev) =>
          prev.map((q) =>
            q.key === key
              ? { ...q, remaining: Math.max(0, q.remaining - 1) }
              : q,
          ),
        );
        setReporting(false);
        setReason(null);
        setNote("");
      } catch (e) {
        setError(
          e instanceof Error ? e.message : "판정을 저장하지 못했습니다.",
        );
      } finally {
        setBusy(false);
      }
    },
    [row, rows.length, busy, key, load],
  );

  // 키보드가 주인공인 안이다(③). 글자를 치는 중에는 가로채지 않는다.
  useEffect(() => {
    const on = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === "1") void submit("pass");
      if (e.key === "2") setReporting((v) => !v);
      if (e.key === "3") void submit("unsure");
    };
    window.addEventListener("keydown", on);
    return () => window.removeEventListener("keydown", on);
  }, [submit]);

  function pick(k: ReviewQueueKey) {
    setKey(k);
    setRows([]);
    setDone(0);
    setReporting(false);
    setReason(null);
    setNote("");
    void load(k, true);
  }

  return (
    <div className="min-h-screen bg-bg text-ink">
      <header className="border-b border-divider px-6 py-3">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
          <h1 className="text-base font-semibold">문제은행 검수</h1>
          <p className="text-sm text-text-2">지금까지 {n(total)}문항을 봤다.</p>
        </div>
      </header>

      <div className="grid gap-6 p-6 lg:grid-cols-[1fr_320px]">
        <main className="mx-auto w-full max-w-2xl">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="rounded-md bg-side px-2 py-1 text-[13px] font-medium">
              {queue.label}
            </span>
            <p className="text-[13px] text-text-2">
              <span className="font-medium text-ink">볼 것</span> · {queue.look}
            </p>
          </div>

          {error ? (
            <p
              role="alert"
              className="mt-3 rounded-md border border-[var(--red-text)] bg-surface p-3 text-sm text-[var(--red-text)]"
            >
              {error}
            </p>
          ) : null}

          {row ? (
            <article className="mt-3 rounded-lg border border-divider bg-surface p-6">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-text-2">
                <span className="rounded border border-divider px-1.5 py-0.5 font-medium tracking-wide text-ink">
                  {row.problemCode}
                </span>
                <span>{row.unitName}</span>
                {row.questionType ? <span>{row.questionType}</span> : null}
                {row.figureUrls.length > 0 ? (
                  <span>그림 {row.figureUrls.length}장</span>
                ) : null}
                {!row.directUseAllowed ? (
                  <span className="font-medium text-[var(--red-text)]">
                    출제 제외
                  </span>
                ) : null}
              </div>

              <div className="mt-4 min-w-0 overflow-x-auto text-[15px] leading-relaxed">
                <PaperProblemView
                  content={row.content}
                  figureUrls={row.figureUrls}
                  figureDims={row.figureDims}
                  figureSourceMm={row.figureSourceMm}
                />
              </div>

              <div className="mt-5 border-t border-divider pt-3">
                <div className="flex flex-wrap items-baseline gap-x-3">
                  <span className="text-[13px] text-text-2">정답</span>
                  <span className="text-[15px] font-semibold">
                    {row.answer}
                  </span>
                </div>
                {row.solution ? (
                  <details className="mt-2">
                    <summary className="cursor-pointer text-[13px] text-blue">
                      해설 보기
                    </summary>
                    <div className="mt-2 text-[14px] leading-relaxed text-text-2">
                      <PaperProblemView content={row.solution} />
                    </div>
                  </details>
                ) : (
                  <p className="mt-2 text-[13px] text-[var(--red-text)]">
                    해설이 없다 — 이 화면만으로는 답을 검산할 수 없다.
                  </p>
                )}
              </div>
            </article>
          ) : (
            <p className="mt-6 rounded-lg border border-divider bg-surface p-6 text-sm text-text-2">
              이 대기열에서 볼 것이 없다. 오른쪽에서 다른 대기열을 고른다.
            </p>
          )}
        </main>

        <aside className="lg:sticky lg:top-6 lg:self-start">
          <div className="flex flex-col gap-2">
            <button
              type="button"
              disabled={!row || busy}
              onClick={() => void submit("pass")}
              className="cursor-pointer rounded-md border border-ink bg-ink px-4 py-2.5 text-sm font-medium text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
            >
              문제 없다 <kbd className="ml-1 font-normal opacity-70">1</kbd>
            </button>
            <button
              type="button"
              disabled={!row || busy}
              aria-pressed={reporting}
              onClick={() => setReporting((v) => !v)}
              className={
                "cursor-pointer rounded-md border px-4 py-2.5 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-40 " +
                (reporting
                  ? "border-[var(--red-text)] bg-[var(--red-text)] text-white"
                  : "border-control bg-surface hover:bg-side")
              }
            >
              신고 <kbd className="ml-1 font-normal opacity-70">2</kbd>
            </button>
            <button
              type="button"
              disabled={!row || busy}
              onClick={() => void submit("unsure")}
              className="cursor-pointer rounded-md border border-control bg-surface px-4 py-2.5 text-sm font-medium transition-colors hover:bg-side disabled:cursor-not-allowed disabled:opacity-40"
            >
              판단 못 하겠다{" "}
              <kbd className="ml-1 font-normal opacity-70">3</kbd>
            </button>
          </div>

          {reporting ? (
            <div className="mt-3 rounded-md border border-[var(--red-text)]/40 bg-surface p-3">
              <p className="text-[13px] font-semibold text-[var(--red-text)]">
                무엇이 이상한가
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {REASON_ORDER.map((r) => (
                  <button
                    key={r}
                    type="button"
                    aria-pressed={reason === r}
                    onClick={() => setReason(r)}
                    className={
                      "cursor-pointer rounded-full border px-2.5 py-1 text-[13px] transition-colors " +
                      (reason === r
                        ? "border-ink bg-ink text-white"
                        : "border-control hover:bg-side")
                    }
                  >
                    {REASON_LABELS[r]}
                  </button>
                ))}
              </div>
              <label className="mt-2 block">
                <span className="sr-only">덧붙일 말</span>
                <textarea
                  rows={2}
                  value={note}
                  onChange={(e) => setNote(e.target.value)}
                  placeholder={
                    reason === "other"
                      ? "무엇이 이상한지 적는다 (필수)"
                      : "덧붙일 말 (선택)"
                  }
                  className="w-full rounded-md border border-control bg-surface p-2 text-sm"
                />
              </label>
              <button
                type="button"
                disabled={
                  busy ||
                  reason === null ||
                  (reason === "other" && note.trim().length === 0)
                }
                onClick={() => reason && void submit("defect", reason, note)}
                className="mt-2 cursor-pointer rounded-md border border-[var(--red-text)] bg-[var(--red-text)] px-3 py-1.5 text-sm font-medium text-white disabled:cursor-not-allowed disabled:opacity-40"
              >
                신고하고 다음
              </button>
            </div>
          ) : null}

          <p className="mt-5 text-[13px] text-text-2">
            이번에 {n(done)}문항 · 남은 것 {n(queue.remaining)}
          </p>

          <div className="mt-4 border-t border-divider pt-3">
            <p className="text-[13px] font-medium">대기열</p>
            <ul className="mt-2 space-y-1.5">
              {qs.map((q) => (
                <li key={q.key}>
                  <button
                    type="button"
                    onClick={() => pick(q.key)}
                    aria-pressed={q.key === key}
                    className={
                      "w-full cursor-pointer rounded-md border px-2.5 py-1.5 text-left text-[13px] transition-colors " +
                      (q.key === key
                        ? "border-ink bg-side"
                        : "border-control bg-surface hover:bg-side")
                    }
                  >
                    <span className="flex items-baseline justify-between gap-2">
                      <span>{q.label}</span>
                      <span className="tabular-nums">{n(q.remaining)}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-[12px] leading-snug text-text-2">
              {queue.why}
            </p>
          </div>
        </aside>
      </div>
    </div>
  );
}
