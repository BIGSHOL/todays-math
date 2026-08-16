"use client";

import { useState } from "react";

import { ActualScoreSaveError, saveActualScore } from "./examApi";
import { formatScore } from "./viewModel";

/**
 * 실측 기둥의 점수 칸 — 보정 루프의 **유일한 입력구**.
 *
 * 확정 시안(05 §8.7 `[확정 — T7.0 Wire]`)이 학생 행 안에 `[입력]` 을 둔 그 자리다.
 * 별도 화면이나 일괄 입력 모드로 빼지 않는다 — 시안이 대조표 안에서 입력하게 정했고,
 * 그래야 **친 즉시 옆 칸에 잔차가 뜬다.** 88 을 예측한 학생에 8 을 잘못 치면
 * `−80 빗나감` 이 그 자리에서 보인다. 오타를 나중에 발견하면 이미 보정이 오염된 뒤다.
 *
 * ## 지키는 것
 * - **응시하지 않은 학생에게는 이 칸을 아예 그리지 않는다**(호출부가 가른다).
 *   붙일 예측이 없어 서버가 422 로 거절할 요청을 화면이 만들지 않는다.
 * - 저장이 실패하면 **입력값을 남긴 채** 이유를 적는다. 조용히 사라지면 원장은
 *   저장된 줄 안다.
 * - 재저장은 갱신이다(API `@@unique([runId, studentId])`). 그래서 「고치기」를 연다.
 * - D-30 — 누르는 것은 버튼뿐이다. 행에는 어떤 어포던스도 주지 않는다.
 */
const MIN = 0;
const MAX = 100;

const BTN =
  "rounded border border-divider px-2 py-0.5 text-[11.5px] font-bold text-muted " +
  "hover:border-ink hover:text-ink";

type Props = {
  runId: string;
  studentId: string;
  studentName: string;
  actualScore: number | null;
  /** 저장이 끝나면 상위가 화면 상태를 갱신한다. */
  onSaved: (studentId: string, actualScore: number) => void;
};

export function ActualScoreCell({
  runId,
  studentId,
  studentName,
  actualScore,
  onSaved,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function open() {
    setDraft(actualScore === null ? "" : String(actualScore));
    setError(null);
    setEditing(true);
  }

  function cancel() {
    setEditing(false);
    setError(null);
  }

  async function commit() {
    const trimmed = draft.trim();
    // 빈 값은 "0점"이 아니다 — 아직 안 들어온 것이다. 보내지 않는다.
    if (trimmed === "") return;

    const value = Number(trimmed);
    if (!Number.isFinite(value) || value < MIN || value > MAX) {
      setError(`점수는 ${MIN}에서 ${MAX} 사이여야 합니다`);
      return;
    }

    setBusy(true);
    setError(null);
    try {
      await saveActualScore(runId, studentId, value);
      onSaved(studentId, value);
      setEditing(false);
    } catch (cause) {
      setError(
        cause instanceof ActualScoreSaveError
          ? cause.message
          : "점수를 저장하지 못했습니다",
      );
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <span className="inline-flex items-center gap-1.5">
        <input
          aria-label={`${studentName} 실점수`}
          autoFocus
          className="w-14 rounded border border-ink px-1.5 py-0.5 text-right text-[13px] tabular-nums"
          disabled={busy}
          inputMode="numeric"
          max={MAX}
          min={MIN}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              event.preventDefault();
              void commit();
            }
            if (event.key === "Escape") {
              event.preventDefault();
              cancel();
            }
          }}
          type="number"
          value={draft}
        />
        {/* 오류는 색이 아니라 말로 알린다. role=alert 이라야 화면을 못 보는 사용자에게도 닿는다. */}
        {error ? (
          <span
            className="text-[11.5px] font-bold text-g-red-text"
            role="alert"
          >
            {error}
          </span>
        ) : (
          <span className="text-[11.5px] text-ghost">
            Enter 저장 · Esc 취소
          </span>
        )}
      </span>
    );
  }

  if (actualScore === null) {
    return (
      <span className="inline-flex items-center gap-2">
        <span className="text-ghost">—</span>
        <button className={BTN} onClick={open} type="button">
          실점수 입력
        </button>
      </span>
    );
  }

  return (
    <span className="inline-flex items-center gap-2">
      <span className="font-bold">{formatScore(actualScore)}</span>
      <button className={BTN} onClick={open} type="button">
        실점수 고치기
      </button>
    </span>
  );
}
