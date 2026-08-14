"use client";

import { useEffect, useMemo, useState } from "react";

import { Button } from "@/components/ui/Button";
import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";
import type { UnitEntity } from "@/contracts/unit.contract";
import {
  loadProblems,
  type ProblemListFilters,
} from "@/lib/problem/problemApi";
import { loadUnits } from "@/lib/units/unitApi";

import { FieldSelect } from "./FieldSelect";
import { PROBLEM_TYPES } from "./labels";
import { ProblemCard } from "./ProblemCard";
import { ProblemGenerateForm } from "./ProblemGenerateForm";
import { ProblemRegisterForm } from "./ProblemRegisterForm";
import { ProblemTransformForm } from "./ProblemTransformForm";

type Panel = "register" | "generate" | "transform" | null;

function matchesFilters(
  problem: ProblemEntity,
  filters: ProblemListFilters,
): boolean {
  return (
    (!filters.unitId || problem.unitId === filters.unitId) &&
    (!filters.difficulty || problem.difficulty === filters.difficulty) &&
    (!filters.problemType || problem.problemType === filters.problemType) &&
    (!filters.reviewStatus || problem.reviewStatus === filters.reviewStatus)
  );
}

export function ProblemBank() {
  const [unitId, setUnitId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [problemType, setProblemType] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [problems, setProblems] = useState<ProblemEntity[]>([]);
  const [units, setUnits] = useState<UnitEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  const filters: ProblemListFilters = useMemo(
    () => ({
      unitId: unitId || undefined,
      difficulty: (difficulty || undefined) as Difficulty | undefined,
      problemType: (problemType || undefined) as ProblemType | undefined,
      reviewStatus: (reviewStatus || undefined) as ReviewStatus | undefined,
    }),
    [unitId, difficulty, problemType, reviewStatus],
  );

  useEffect(() => {
    let cancelled = false;
    loadProblems(filters)
      .then((body) => {
        if (cancelled) return;
        setProblems(body.data);
        setError(null);
        setLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setError("목록을 불러오지 못했습니다");
        setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [filters]);

  useEffect(() => {
    let cancelled = false;
    loadUnits()
      .then((body) => {
        if (cancelled) return;
        setUnits(body.data);
        setUnitsError(null);
        setUnitsLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setUnitsError("단원 목록을 불러오지 못했습니다");
        setUnitsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const defaultUnitId = unitId || units[0]?.id || "";
  const unitActionsDisabled = unitsLoading || units.length === 0;

  function startProblemReload() {
    setLoading(true);
    setError(null);
  }

  function toggle(next: Exclude<Panel, null>) {
    setPanel((current) => (current === next ? null : next));
  }

  function prepend(count: number, created: ProblemEntity[], label: string) {
    setProblems((current) => [
      ...created.filter((problem) => matchesFilters(problem, filters)),
      ...current,
    ]);
    setNotice(`${count}건 ${label}`);
    setPanel(null);
    setError(null);
  }

  return (
    <main className="px-[26px] py-6">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h1 className="text-[15px] font-black">문제은행</h1>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="ink"
            disabled={unitActionsDisabled}
            onClick={() => toggle("register")}
          >
            등록
          </Button>
          <Button
            disabled={unitActionsDisabled}
            onClick={() => toggle("generate")}
          >
            생성
          </Button>
          <Button variant="secondary" onClick={() => toggle("transform")}>
            변형
          </Button>
        </div>
      </div>

      <div className="mt-4 flex flex-wrap gap-3">
        <FieldSelect
          label="단원"
          value={unitId}
          disabled={unitsLoading || units.length === 0}
          onChange={(event) => {
            startProblemReload();
            setUnitId(event.target.value);
          }}
        >
          <option value="">전체</option>
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.section}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="난이도"
          value={difficulty}
          onChange={(event) => {
            startProblemReload();
            setDifficulty(event.target.value);
          }}
        >
          <option value="">전체</option>
          <option value="easy">쉬움</option>
          <option value="mid">보통</option>
          <option value="hard">어려움</option>
        </FieldSelect>
        <FieldSelect
          label="유형"
          value={problemType}
          onChange={(event) => {
            startProblemReload();
            setProblemType(event.target.value);
          }}
        >
          <option value="">전체</option>
          {PROBLEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="상태"
          value={reviewStatus}
          onChange={(event) => {
            startProblemReload();
            setReviewStatus(event.target.value);
          }}
        >
          <option value="">전체</option>
          <option value="pending">대기</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
        </FieldSelect>
      </div>

      {panel === "register" ? (
        <ProblemRegisterForm
          units={units}
          defaultUnitId={defaultUnitId}
          onCreated={(count, created) => prepend(count, created, "등록")}
          onError={setError}
        />
      ) : null}
      {panel === "generate" ? (
        <ProblemGenerateForm
          units={units}
          defaultUnitId={defaultUnitId}
          onCreated={(count, created) => prepend(count, created, "생성")}
          onError={setError}
        />
      ) : null}
      {panel === "transform" ? (
        <ProblemTransformForm
          problems={problems}
          onCreated={(count, created) => prepend(count, created, "변형")}
          onError={setError}
        />
      ) : null}

      {notice ? (
        <p className="mt-4 text-[12.5px] font-bold text-[#161616]">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-4 text-[12.5px] font-bold text-[#C5221F]">{error}</p>
      ) : null}
      {unitsError ? (
        <p className="mt-4 text-[12.5px] font-bold text-[#C5221F]">
          {unitsError}
        </p>
      ) : null}
      {loading ? (
        <p className="mt-4 text-[12.5px] text-[#6A6A68]">불러오는 중</p>
      ) : null}

      <section className="mt-4">
        {!loading && !error && problems.length === 0 ? (
          <p className="text-[12.5px] text-[#6A6A68]">등록된 문제가 없습니다</p>
        ) : !loading && !error ? (
          problems.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} />
          ))
        ) : null}
      </section>
    </main>
  );
}
