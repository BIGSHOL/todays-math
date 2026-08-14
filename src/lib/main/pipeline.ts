import type { ClassEntity, ProgressEntity } from "@/contracts/class.contract";
import type { TestEntity } from "@/contracts/test.contract";

import { unitSectionName } from "./unitLookup";

export const MAIN_ROW_GRID =
  "grid grid-cols-[44px_minmax(0,1fr)_232px_112px] items-center gap-4 px-6";

export type PipelineStage =
  "progress" | "generate" | "review" | "print" | "done";

export const STAGE_LABELS = ["진도", "출제", "검수", "인쇄"] as const;

const STACK_SORT: Record<PipelineStage, number> = {
  review: 0,
  print: 1,
  generate: 2,
  progress: 3,
  done: 4,
};

export type ClassRow = {
  classId: string;
  name: string;
  testTypeLabel: string | null;
  unitLabel: string;
  meta: string;
  stage: PipelineStage;
  testId?: string;
  hasProgress: boolean;
};

export function pickActiveTest(
  tests: TestEntity[],
  currentUnitId: string | null,
): TestEntity | undefined {
  const classLevel = tests.filter((t) => t.studentId === null);
  // 일일테스트는 "현재 진도 차시"의 것만 오늘의 테스트로 본다. 진도가 그 차시를 지나가면
  // 지난 일일테스트이므로 대시보드에서 제외한다 — 안 그러면 옛 차시의 테스트가 모든 차시에
  // 그대로 남아 "차시를 바꿔도 같은 문제"로 보인다(원장 관찰, 2026-08-14).
  // 확인테스트(review)는 여러 차시를 아우르는 범위형이라 현재 차시와 무관하게 유지한다.
  const relevant = classLevel.filter((t) =>
    t.testType === "daily"
      ? currentUnitId !== null && t.rangeEndUnitId === currentUnitId
      : true,
  );
  return (
    relevant.find((t) => t.status === "draft") ??
    relevant.find((t) => t.status === "confirmed") ??
    relevant.find((t) => t.status === "printed")
  );
}

export function resolveStage(
  test: TestEntity | undefined,
  hasProgress: boolean,
): PipelineStage {
  if (test?.status === "draft") return "review";
  if (test?.status === "confirmed") return "print";
  if (test?.status === "printed") return "done";
  return hasProgress ? "generate" : "progress";
}

export function stageCurrentIndex(stage: PipelineStage): number {
  if (stage === "done") return 4;
  return STAGE_LABELS.findIndex(
    (_, i) =>
      (["progress", "generate", "review", "print"] as const)[i] === stage,
  );
}

export function testTypeLabel(type: TestEntity["testType"] | undefined) {
  if (type === "daily") return "일일테스트";
  if (type === "review") return "확인테스트";
  return null;
}

function metaFor(
  stage: PipelineStage,
  unitLabel: string,
  problemCount: number,
): string {
  if (stage === "review") return `${unitLabel} · ${problemCount}문항 준비됨`;
  if (stage === "print") return `${unitLabel} · 검수 완료`;
  if (stage === "generate") return `${unitLabel} · 출제 대기`;
  if (stage === "done") return `${unitLabel} · 인쇄됨`;
  return "어제 진도가 비어 있습니다";
}

export function buildClassRows(
  classes: ClassEntity[],
  tests: TestEntity[],
  progressByClass: Record<string, ProgressEntity | null>,
  units?: readonly { id: string; section: string }[],
): ClassRow[] {
  const rows = classes.map((cls) => {
    const classTests = tests.filter((t) => t.classId === cls.id);
    const progress = progressByClass[cls.id] ?? null;
    const hasProgress = progress !== null;
    const test = pickActiveTest(classTests, progress?.unitId ?? null);
    const stage = resolveStage(test, hasProgress);
    const unitLabel = unitSectionName(
      progress?.unitId ?? test?.rangeEndUnitId ?? null,
      units,
    );
    return {
      classId: cls.id,
      name: cls.name,
      testTypeLabel: testTypeLabel(test?.testType),
      unitLabel,
      meta: metaFor(stage, unitLabel, cls.defaultProblemCount),
      stage,
      testId: test?.id,
      hasProgress,
    };
  });

  return rows.sort((a, b) => STACK_SORT[a.stage] - STACK_SORT[b.stage]);
}

export function remainingCount(rows: ClassRow[]): number {
  return rows.filter((r) => r.stage !== "done").length;
}

export type PrimaryAction = {
  label: "진도 입력" | "출제" | "검수" | "인쇄" | "다시 보기";
  href?: string;
};

export function primaryAction(row: ClassRow): PrimaryAction {
  if (row.stage === "review" && row.testId) {
    return { label: "검수", href: `/tests/${row.testId}` };
  }
  if (row.stage === "print" && row.testId) {
    return { label: "인쇄", href: `/tests/${row.testId}/print` };
  }
  if (row.stage === "done" && row.testId) {
    return { label: "다시 보기", href: `/tests/${row.testId}` };
  }
  if (row.stage === "generate") {
    return { label: "출제", href: `/tests/new?classId=${row.classId}` };
  }
  return { label: "진도 입력" };
}

export function formatMastheadDate(date = new Date()): string {
  const days = ["일", "월", "화", "수", "목", "금", "토"];
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d} ${days[date.getDay()]}`;
}
