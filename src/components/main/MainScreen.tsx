"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppChrome } from "@/components/chrome/AppChrome";
import type { ClassEntity, ProgressEntity } from "@/contracts/class.contract";
import type { WeeklyMetrics } from "@/contracts/metrics.contract";
import type { TestEntity } from "@/contracts/test.contract";
import type { UnitEntity } from "@/contracts/unit.contract";
import { recordProgress } from "@/lib/class/classApi";
import { loadMainDashboard } from "@/lib/main/loadMainDashboard";
import { buildClassRows, remainingCount } from "@/lib/main/pipeline";

import { ClassCard } from "./ClassCard";
import { DoneSummaryRow } from "./DoneSummaryRow";
import { LedgerTable } from "./LedgerTable";
import { ProgressPanel } from "./ProgressPanel";

type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | {
      status: "ready";
      classes: ClassEntity[];
      tests: TestEntity[];
      progressByClass: Record<string, ProgressEntity | null>;
      units: UnitEntity[];
      metrics: WeeklyMetrics;
    };

export function MainScreen() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedClassId, setSelectedClassId] = useState("");
  const [viewOverride, setViewOverride] = useState<"stack" | "ledger" | null>(
    null,
  );
  const [advanceError, setAdvanceError] = useState<string | null>(null);
  // 차시이동 화살표로 "열람 중인" 차시(진도 미기록). null이면 현재 기록된 진도를 본다.
  // 반을 바꾸거나 진도를 기록하면 null로 되돌려 그 반의 실제 진도를 다시 본다.
  const [viewedUnitId, setViewedUnitId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMainDashboard()
      .then((data) => {
        if (cancelled) return;
        setState({ status: "ready", ...data });
        const rows = buildClassRows(
          data.classes,
          data.tests,
          data.progressByClass,
          data.units,
        );
        const firstOpen = rows.find((r) => r.stage !== "done");
        setSelectedClassId(firstOpen?.classId ?? data.classes[0]?.id ?? "");
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", message: "목록을 불러오지 못했습니다" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const rows = useMemo(() => {
    if (state.status !== "ready") return [];
    return buildClassRows(
      state.classes,
      state.tests,
      state.progressByClass,
      state.units,
    );
  }, [state]);

  const remaining = remainingCount(rows);
  const autoView = remaining > 0 ? "stack" : "ledger";
  const view = viewOverride ?? autoView;
  const pending = rows.filter((r) => r.stage !== "done");
  const done = rows.filter((r) => r.stage === "done");
  const metrics = state.status === "ready" ? state.metrics : null;

  // 실제 기록된 현재 진도 차시.
  const committedUnitId =
    state.status === "ready"
      ? (state.progressByClass[selectedClassId]?.unitId ?? null)
      : null;
  // 화면에 보여줄 차시 = 열람 중이면 그 차시, 아니면 현재 진도. (열람은 DB에 안 남는다)
  const displayedUnitId = viewedUnitId ?? committedUnitId;
  const canRecord =
    displayedUnitId !== null && displayedUnitId !== committedUnitId;

  const handleSelectClass = useCallback((classId: string) => {
    setSelectedClassId(classId);
    setViewedUnitId(null); // 반을 바꾸면 그 반의 실제 진도를 보도록 열람 위치를 초기화한다.
  }, []);

  // 차시이동 화살표 — 진도를 기록하지 않고 열람 위치만 바꾼다(예전엔 클릭마다 진도가 쌓였다).
  const handleStep = useCallback((unitId: string) => {
    setViewedUnitId(unitId);
  }, []);

  // "이 차시로 진도 기록" — 열람 중인 차시를 실제 진도로 커밋한다(명시적 기록).
  const handleRecord = useCallback(async () => {
    if (
      !selectedClassId ||
      state.status !== "ready" ||
      displayedUnitId === null ||
      displayedUnitId === committedUnitId
    ) {
      return;
    }
    setAdvanceError(null);
    try {
      const next = await recordProgress(selectedClassId, displayedUnitId);
      setState((prev) => {
        if (prev.status !== "ready") return prev;
        return {
          ...prev,
          progressByClass: {
            ...prev.progressByClass,
            [selectedClassId]: next,
          },
        };
      });
      setViewedUnitId(null); // 기록 후엔 방금 기록한 차시(=현재 진도)를 본다.
    } catch {
      setAdvanceError("진도를 저장하지 못했습니다");
    }
  }, [selectedClassId, state.status, displayedUnitId, committedUnitId]);

  if (state.status === "loading") {
    return (
      <div className="min-h-screen bg-canvas px-7 py-8 text-ink">
        불러오는 중
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="min-h-screen bg-canvas px-7 py-8 text-ink">
        {state.message}
      </div>
    );
  }

  return (
    <AppChrome
      remaining={remaining}
      extraNav={
        <button
          type="button"
          onClick={() => setViewOverride(view === "stack" ? "ledger" : "stack")}
          className="cursor-pointer bg-[#161616] px-2.5 py-0.5 text-[15.75px] font-extrabold text-[#ECECEA]"
        >
          {view === "stack" ? "전체 표 ⇄" : "오늘 작업 ⇄"}
        </button>
      }
    >
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1">
          {view === "stack" ? (
            <>
              {pending.map((row, i) => (
                <ClassCard
                  key={row.classId}
                  row={row}
                  index={i + 1}
                  hot={i === 0}
                  onProgress={handleSelectClass}
                />
              ))}
              {done.map((row) => (
                <DoneSummaryRow key={row.classId} row={row} />
              ))}
            </>
          ) : (
            <LedgerTable rows={rows} onProgress={handleSelectClass} />
          )}
        </div>
        <ProgressPanel
          classes={state.classes}
          units={state.units}
          selectedClassId={selectedClassId}
          selectedUnitId={displayedUnitId}
          printedDays={metrics?.printedDays ?? 0}
          unmodifiedRate={Math.round((metrics?.unmodifiedRate ?? 0) * 100)}
          error={advanceError}
          canRecord={canRecord}
          onSelectClass={handleSelectClass}
          onStep={handleStep}
          onRecord={() => {
            void handleRecord();
          }}
        />
      </div>
    </AppChrome>
  );
}
