"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { AppChrome } from "@/components/chrome/AppChrome";
import type { ClassEntity, ProgressEntity } from "@/contracts/class.contract";
import type { TestEntity } from "@/contracts/test.contract";
import type { UnitEntity } from "@/contracts/unit.contract";
import { recordProgress } from "@/lib/class/classApi";
import { loadMainDashboard } from "@/lib/main/loadMainDashboard";
import { buildClassRows, remainingCount, weekStats } from "@/lib/main/pipeline";

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
    };

export function MainScreen() {
  const [state, setState] = useState<LoadState>({ status: "loading" });
  const [selectedClassId, setSelectedClassId] = useState("");
  const [viewOverride, setViewOverride] = useState<"stack" | "ledger" | null>(
    null,
  );
  const [advanceError, setAdvanceError] = useState<string | null>(null);

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
  const stats = state.status === "ready" ? weekStats(state.tests) : null;

  const selectedUnitId =
    state.status === "ready"
      ? (state.progressByClass[selectedClassId]?.unitId ?? null)
      : null;

  const handleStep = useCallback(
    async (unitId: string) => {
      if (!selectedClassId || state.status !== "ready") return;
      setAdvanceError(null);
      try {
        const next = await recordProgress(selectedClassId, unitId);
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
      } catch {
        setAdvanceError("진도를 저장하지 못했습니다");
      }
    },
    [selectedClassId, state.status],
  );

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
          className="cursor-pointer bg-[#161616] px-2.5 py-0.5 text-[10.5px] font-extrabold text-[#ECECEA]"
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
                  onProgress={setSelectedClassId}
                />
              ))}
              {done.map((row) => (
                <DoneSummaryRow key={row.classId} row={row} />
              ))}
            </>
          ) : (
            <LedgerTable rows={rows} onProgress={setSelectedClassId} />
          )}
        </div>
        <ProgressPanel
          classes={state.classes}
          units={state.units}
          selectedClassId={selectedClassId}
          selectedUnitId={selectedUnitId}
          printedDays={stats?.printedDays ?? 0}
          unmodifiedRate={stats?.unmodifiedRate ?? 0}
          error={advanceError}
          onSelectClass={setSelectedClassId}
          onStep={(unitId) => {
            void handleStep(unitId);
          }}
        />
      </div>
    </AppChrome>
  );
}
