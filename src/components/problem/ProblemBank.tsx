"use client";

import { useEffect, useMemo, useState } from "react";

import { PROBLEM_CARD_MIN_WIDTH } from "@/components/print/tokens";
import { Button } from "@/components/ui/Button";
import type { Difficulty, ReviewStatus } from "@/contracts/common.contract";
import type { ProblemEntity, ProblemType } from "@/contracts/problem.contract";
import type { UnitEntity } from "@/contracts/unit.contract";
import {
  loadProblems,
  PROBLEM_PAGE_SIZE,
  type ProblemListFilters,
} from "@/lib/problem/problemApi";
import { loadUnits } from "@/lib/units/unitApi";

import { FieldSelect, FIELD_SELECT_WIDTH } from "./FieldSelect";
import { PROBLEM_TYPES } from "./labels";
import { ProblemCard } from "./ProblemCardLazy";
import {
  ProblemGenerateForm,
  ProblemRegisterForm,
  ProblemTransformForm,
} from "./ProblemPanelsLazy";

type Panel = "register" | "generate" | "transform" | null;

/** 초등 chapter는 "1-1 9까지의 수" 꼴 — 앞 숫자가 학기. 그 외 학년은 학기 개념이 없다. */
const SEMESTER_CHAPTER_RE = /^[12]-/;

/**
 * 목록 다단 배치 (2026-08-17 원장님 지시 "기본 2단, 창 크기 따라 3단 혹은 1단").
 *
 * 카드 **본문**은 인쇄 문항 열과 같은 폭으로 고정돼 있어(`PaperProblemView`) 넓은
 * 화면에서도 늘어나지 않는다 — 그래서 한 단으로 깔면 우측이 통째로 빈다. 폭을 늘리면
 * 줄바꿈이 지면과 갈라지므로(2026-08-17 "인쇄시와 동일한 뷰"), 폭은 그대로 두고
 * **카드를 여러 열로** 깐다.
 *
 * 창 크기 브레이크포인트를 박지 않고 `auto-fit` 을 쓰는 이유: 실제로 남는 폭에 반응해야
 * 사이드 여백·확대 배율이 달라져도 맞는다. `min(100%, …)` 가 **너무 좁은 창 가드**다 —
 * 남는 폭이 카드 한 장보다 좁아지면 열 하한이 100%로 내려가 1단이 된다(가로 스크롤 대신).
 *
 * `print:block` — 문제은행 화면을 그대로 인쇄할 때의 결과를 종전과 같게 둔다.
 * 시험지 인쇄는 이 화면이 아니라 `TestPrint` 가 그린다.
 */
const PROBLEM_GRID_STYLE = {
  gridTemplateColumns: `repeat(auto-fit, minmax(min(100%, ${PROBLEM_CARD_MIN_WIDTH}), 1fr))`,
} as const;

/**
 * 필터 바 (2026-08-17 원장님 "필터 선택할때마다 크기 제각각인데 고정된 크기에서
 * 선택만 바뀌도록").
 *
 * 종전 `flex flex-wrap` 은 각 칸이 **내용만큼** 자랐다 — 네이티브 select 는 가장 긴
 * option 만큼 넓어지므로 소단원만 466px 로 벌어지고(실측), 선택을 바꾸면 자리가 흔들렸다.
 * 그리드로 바꿔 **모든 칸을 같은 고정 폭**으로 두고, 창이 좁아지면 열 수만 줄인다
 * (카드 다단과 같은 원칙 — 브레이크포인트 대신 남는 폭에 반응).
 *
 * `auto-fill` 인 이유: 학기 칸은 초등에서만 나타나 칸 수가 6↔7 로 변한다. `auto-fit`
 * 이면 빈 트랙이 접혀 남은 칸이 늘어나므로, 칸이 하나 생겼다 사라질 때 폭이 흔들린다.
 * `auto-fill` 은 트랙을 유지하므로 **칸 수가 변해도 폭이 그대로**다.
 */
const FILTER_GRID_STYLE = {
  gridTemplateColumns: `repeat(auto-fill, ${FIELD_SELECT_WIDTH})`,
} as const;

function matchesFilters(
  problem: ProblemEntity,
  filters: ProblemListFilters,
  unitById: Map<string, UnitEntity>,
): boolean {
  if (filters.unitId && problem.unitId !== filters.unitId) return false;
  if (filters.grade || filters.chapter || filters.chapterPrefix) {
    const unit = unitById.get(problem.unitId);
    if (!unit) return false;
    if (filters.grade && unit.grade !== filters.grade) return false;
    // 서버(route.ts)와 동일: chapter 정확 일치가 있으면 chapterPrefix는 무시.
    if (filters.chapter) {
      if (unit.chapter !== filters.chapter) return false;
    } else if (
      filters.chapterPrefix &&
      !unit.chapter.startsWith(filters.chapterPrefix)
    ) {
      return false;
    }
  }
  return (
    (!filters.difficulty || problem.difficulty === filters.difficulty) &&
    (!filters.problemType || problem.problemType === filters.problemType) &&
    (!filters.reviewStatus || problem.reviewStatus === filters.reviewStatus)
  );
}

export function ProblemBank() {
  const [grade, setGrade] = useState("");
  const [semester, setSemester] = useState("");
  const [chapter, setChapter] = useState("");
  const [unitId, setUnitId] = useState("");
  const [difficulty, setDifficulty] = useState("");
  const [problemType, setProblemType] = useState("");
  const [reviewStatus, setReviewStatus] = useState("");
  const [hasFigure, setHasFigure] = useState(false);
  const [hasSolution, setHasSolution] = useState(false);
  const [hasAnswer, setHasAnswer] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [problems, setProblems] = useState<ProblemEntity[]>([]);
  const [units, setUnits] = useState<UnitEntity[]>([]);
  const [loading, setLoading] = useState(true);
  const [unitsLoading, setUnitsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unitsError, setUnitsError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [panel, setPanel] = useState<Panel>(null);

  // 서버에 보낼 단원 필터 우선순위: 소단원 > 중단원 > 학기 > 학년 (가장 좁은 것 하나만).
  const filters: ProblemListFilters = useMemo(() => {
    const unitFilter: ProblemListFilters = unitId
      ? { unitId }
      : chapter
        ? { grade, chapter }
        : semester
          ? { grade, chapterPrefix: `${semester}-` }
          : grade
            ? { grade }
            : {};
    return {
      ...unitFilter,
      difficulty: (difficulty || undefined) as Difficulty | undefined,
      problemType: (problemType || undefined) as ProblemType | undefined,
      reviewStatus: (reviewStatus || undefined) as ReviewStatus | undefined,
      hasFigure: hasFigure || undefined,
      hasSolution: hasSolution || undefined,
      hasAnswer: hasAnswer || undefined,
    };
  }, [
    unitId,
    chapter,
    semester,
    grade,
    difficulty,
    problemType,
    reviewStatus,
    hasFigure,
    hasSolution,
    hasAnswer,
  ]);

  useEffect(() => {
    let cancelled = false;
    loadProblems(filters, page)
      .then((body) => {
        if (cancelled) return;
        setProblems(body.data);
        setTotal(body.meta.total);
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
  }, [filters, page]);

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
  const totalPages = Math.max(1, Math.ceil(total / PROBLEM_PAGE_SIZE));

  const unitById = useMemo(
    () => new Map(units.map((unit) => [unit.id, unit])),
    [units],
  );
  // 학년 옵션 — units 등장 순서(=orderIndex 순) 그대로, 중복 제거.
  const gradeOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const unit of units) {
      if (seen.has(unit.grade)) continue;
      seen.add(unit.grade);
      list.push(unit.grade);
    }
    return list;
  }, [units]);
  // 학기 select는 chapter가 "1-"/"2-"로 시작하는 학년(초등)에서만 보인다.
  const semesterVisible =
    grade !== "" &&
    units.some(
      (unit) => unit.grade === grade && SEMESTER_CHAPTER_RE.test(unit.chapter),
    );
  // 학년(+학기)으로 좁힌 단원 — 중단원/소단원 옵션의 모집단.
  const scopedUnits = useMemo(
    () =>
      units.filter(
        (unit) =>
          (!grade || unit.grade === grade) &&
          (!semester || unit.chapter.startsWith(`${semester}-`)),
      ),
    [units, grade, semester],
  );
  const chapterOptions = useMemo(() => {
    const seen = new Set<string>();
    const list: string[] = [];
    for (const unit of scopedUnits) {
      if (seen.has(unit.chapter)) continue;
      seen.add(unit.chapter);
      list.push(unit.chapter);
    }
    return list;
  }, [scopedUnits]);
  const sectionOptions = chapter
    ? scopedUnits.filter((unit) => unit.chapter === chapter)
    : scopedUnits;

  function startProblemReload() {
    setLoading(true);
    setError(null);
  }

  /** 필터가 바뀌면 항상 1페이지부터 다시 본다. */
  function resetToFirstPage() {
    startProblemReload();
    setPage(1);
  }

  function goToPage(next: number) {
    startProblemReload();
    setPage(next);
  }

  // 상위 select를 바꾸면 하위 선택은 전체("")로 되돌리고 1페이지부터 본다.
  function handleGradeChange(next: string) {
    resetToFirstPage();
    setGrade(next);
    setSemester("");
    setChapter("");
    setUnitId("");
  }

  function handleSemesterChange(next: string) {
    resetToFirstPage();
    setSemester(next);
    setChapter("");
    setUnitId("");
  }

  function handleChapterChange(next: string) {
    resetToFirstPage();
    setChapter(next);
    setUnitId("");
  }

  function toggle(next: Exclude<Panel, null>) {
    setPanel((current) => (current === next ? null : next));
  }

  function prepend(count: number, created: ProblemEntity[], label: string) {
    const matching = created.filter((problem) =>
      matchesFilters(problem, filters, unitById),
    );
    setProblems((current) => [...matching, ...current]);
    setTotal((current) => current + matching.length);
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

      <div
        className="mt-4 grid gap-3"
        style={FILTER_GRID_STYLE}
        data-filter-bar
      >
        <FieldSelect
          label="학년"
          value={grade}
          disabled={unitsLoading || units.length === 0}
          onChange={(event) => handleGradeChange(event.target.value)}
        >
          <option value="">전체</option>
          {gradeOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FieldSelect>
        {semesterVisible ? (
          <FieldSelect
            label="학기"
            value={semester}
            onChange={(event) => handleSemesterChange(event.target.value)}
          >
            <option value="">전체</option>
            <option value="1">1학기</option>
            <option value="2">2학기</option>
          </FieldSelect>
        ) : null}
        <FieldSelect
          label="중단원"
          value={chapter}
          disabled={unitsLoading || units.length === 0 || grade === ""}
          onChange={(event) => handleChapterChange(event.target.value)}
        >
          <option value="">전체</option>
          {chapterOptions.map((option) => (
            <option key={option} value={option}>
              {option}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="소단원"
          value={unitId}
          disabled={unitsLoading || units.length === 0}
          onChange={(event) => {
            resetToFirstPage();
            setUnitId(event.target.value);
          }}
        >
          <option value="">전체</option>
          {sectionOptions.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.section}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          label="난이도"
          value={difficulty}
          onChange={(event) => {
            resetToFirstPage();
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
            resetToFirstPage();
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
            resetToFirstPage();
            setReviewStatus(event.target.value);
          }}
        >
          <option value="">전체</option>
          <option value="pending">대기</option>
          <option value="approved">승인</option>
          <option value="rejected">반려</option>
        </FieldSelect>
        {/*
          「자료」 토글 셋 — 그림 · 해설 · 정답 (원장님 지시 2026-08-19).

          만들기 전에 실측으로 셋 다 뜻이 있는지 확인했다 (DB 47,152건):
            그림  9,448 (20.0%) · 해설 13,909 (29.5%) · 정답 45,041 (95.5%)

          ⚠️ `answer` 는 **빈 값이 0건**이라 「비어 있지 않은가」로 만들면 100% 를
             통과시켜 아무것도 안 거른다. 실제 자리표시자는 `(정답 없음)` 2,111건이다.

          ⚠️ 묶음은 `fieldset`/`legend` 로 짠다. 낱개 이름은 「그림」 한 글자뿐이라
             그것만으로는 무엇을 거르는지 모른다 — 묶음 이름이 그 뜻을 진다.
             (예전에는 제목을 `aria-hidden` 으로 숨겼는데, 그러면 화면 낭독기에
              묶음 이름이 아예 없다.)

          ⚠️ D-30 — 손가락 커서는 실제로 누르는 것(체크박스와 그 label)에만 준다.
             묶음 상자 자체에는 주지 않는다.
        */}
        <fieldset className="flex min-w-0 flex-col gap-1 border-0 p-0">
          <legend className="p-0 text-[10.5px] font-black tracking-[1.5px] text-text-2">
            자료
          </legend>
          <div className="flex h-11 items-center gap-4 border border-control bg-white px-3">
            {(
              [
                ["그림", hasFigure, setHasFigure],
                ["해설", hasSolution, setHasSolution],
                ["정답", hasAnswer, setHasAnswer],
              ] as const
            ).map(([label, checked, setChecked]) => (
              <label
                className="flex cursor-pointer items-center gap-1.5"
                key={label}
              >
                <input
                  checked={checked}
                  className="h-4 w-4 cursor-pointer accent-[var(--blue)]"
                  onChange={(event) => {
                    resetToFirstPage();
                    setChecked(event.target.checked);
                  }}
                  type="checkbox"
                />
                <span className="whitespace-nowrap text-[12.5px] text-ink">
                  {label}
                </span>
              </label>
            ))}
          </div>
        </fieldset>
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
        <p className="mt-4 text-[12.5px] font-bold text-ink">{notice}</p>
      ) : null}
      {error ? (
        <p className="mt-4 text-[12.5px] font-bold text-g-red-text">{error}</p>
      ) : null}
      {unitsError ? (
        <p className="mt-4 text-[12.5px] font-bold text-g-red-text">
          {unitsError}
        </p>
      ) : null}
      {loading ? (
        <p className="mt-4 text-[12.5px] text-text-2">불러오는 중</p>
      ) : null}

      {!loading && !error ? (
        <PaginationRow
          page={page}
          totalPages={totalPages}
          total={total}
          onMove={goToPage}
        />
      ) : null}

      <section
        className="mt-4 grid gap-6 print:block"
        style={PROBLEM_GRID_STYLE}
        data-problem-grid
      >
        {!loading && !error && problems.length === 0 ? (
          <p className="text-[12.5px] text-text-2">등록된 문제가 없습니다</p>
        ) : !loading && !error ? (
          problems.map((problem) => (
            <ProblemCard key={problem.id} problem={problem} />
          ))
        ) : null}
      </section>

      {!loading && !error && problems.length > 0 ? (
        <PaginationRow
          page={page}
          totalPages={totalPages}
          total={total}
          onMove={goToPage}
        />
      ) : null}
    </main>
  );
}

type PaginationRowProps = {
  page: number;
  totalPages: number;
  total: number;
  onMove: (page: number) => void;
};

function PaginationRow({
  page,
  totalPages,
  total,
  onMove,
}: PaginationRowProps) {
  return (
    <nav
      aria-label="페이지"
      className="mt-4 flex flex-wrap items-center justify-between gap-3"
    >
      <span className="text-[12.5px] text-text-2">
        {`총 ${total.toLocaleString("ko-KR")}문제`}
      </span>
      <span className="flex items-center gap-3">
        <Button
          variant="secondary"
          disabled={page <= 1}
          onClick={() => onMove(page - 1)}
        >
          이전
        </Button>
        <span className="text-[12.5px] font-bold text-ink">
          {`${page} / ${totalPages} 페이지`}
        </span>
        <Button
          variant="secondary"
          disabled={page >= totalPages}
          onClick={() => onMove(page + 1)}
        >
          다음
        </Button>
      </span>
    </nav>
  );
}
