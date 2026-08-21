/**
 * eywa 동기화 — **순수 계획 로직** (계획 3판 §4).
 *
 * DB 를 만지기 전에 결정되는 것 전부가 여기 있다. 동기화 스크립트
 * (`scripts/sync/sync-eywa.ts`)는 이 함수들이 내놓은 계획을 트랜잭션 하나로
 * 적용만 한다 — 규칙이 스크립트에 흩어지면 시험할 수 없다.
 *
 * 적대적 리뷰가 잡은 자리들이 이 모듈의 형태를 정했다:
 *  - codex #25 다중 수학반(실측 133/193명) → `primaryClassOf` 주반 규칙
 *  - grok #10  eywa 반에는 학년이 없다 → `classGradeOf` 최빈값
 *  - grok #9   같은 트랜잭션 createdAt 동률 → eywa created_at + 줄 순서 1ms
 *  - grok #7   nearOrderIndex 이음 → `planStudentProgress` 가 보고서 사이를 잇는다
 */
import {
  resolveProgressText,
  type LineVerdict,
  type TextVerdict,
  type UnitIndex,
  type UnitRow,
} from "@/lib/eywa/resolveProgress";

/** 계약 3.2 — roster 의 반 하나. */
export interface EywaClassRef {
  id: string;
  name: string;
  startDate: string | null;
}

/** 계약 3.3 — progress 피드의 한 행. */
export interface EywaReport {
  id: string;
  studentId: string;
  reportDate: string;
  createdAt: string;
  progress: string;
  classId: string | null;
  makeupClassId: string | null;
}

/**
 * 주반 — `Student.classId` 는 단일 FK 인데 실측 69% 가 두 반 이상이다.
 * `startDate` 최신 반. 동률이면 이름 사전순 — **결정적**이어야 돌릴 때마다
 * 학생의 반이 안 바뀐다. 전체 소속은 동기화 보고에 찍어 2단계(D-07)가 본다.
 */
export function primaryClassOf(
  classes: readonly EywaClassRef[],
): EywaClassRef | null {
  if (classes.length === 0) return null;
  return [...classes].sort(
    (a, b) =>
      (b.startDate ?? "").localeCompare(a.startDate ?? "") ||
      a.name.localeCompare(b.name),
  )[0]!;
}

const GRADE_RANK = (grade: string): number => {
  const m = /^(초|중|고)(\d)/.exec(grade);
  if (!m) return Number.MAX_SAFE_INTEGER;
  return (m[1] === "초" ? 0 : m[1] === "중" ? 10 : 20) + Number(m[2]);
};

/**
 * 반 학년 — eywa `classes` 에는 학년 컬럼이 없다. 소속 학생 학년의 최빈값.
 * 동률이면 **낮은 학년** — 시험 범위가 넓어지는 쪽보다 좁아지는 쪽이 안전하다.
 */
export function classGradeOf(
  memberGrades: readonly (string | null)[],
): string | null {
  const counts = new Map<string, number>();
  for (const grade of memberGrades) {
    if (!grade) continue;
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  if (counts.size === 0) return null;
  return [...counts].sort(
    (a, b) => b[1] - a[1] || GRADE_RANK(a[0]) - GRADE_RANK(b[0]),
  )[0]![0];
}

/**
 * 학년 문자열 → 학교 필드. 초등은 내신이 없어 '오늘의 시험' 대상이 아니다 —
 * `schoolLevel` 을 비운다(스키마 주석 그대로).
 */
export function schoolFieldsOf(grade: string | null): {
  schoolLevel: "중" | "고" | null;
  schoolGrade: number | null;
} {
  const m = grade ? /^(중|고)(\d)$/.exec(grade.trim()) : null;
  if (!m) return { schoolLevel: null, schoolGrade: null };
  return { schoolLevel: m[1] as "중" | "고", schoolGrade: Number(m[2]) };
}

/** 한 줄 판정의 대표 단원 — 진도 위치로 적을 것. */
function representativeUnits(line: LineVerdict): UnitRow[] {
  if (line.kind === "차시") return line.units;
  const sorted = [...line.units].sort((a, b) => a.orderIndex - b.orderIndex);
  // 총괄 = 그 장을 **끝냈다** → 장 끝. 맨 대단원 = 어디까지인지 모른다 → 장 첫
  // 단원(보수적 — 반대로 하면 안 배운 단원이 시험 범위에 들어간다).
  if (line.kind === "총괄") return sorted.slice(-1);
  if (line.kind === "대단원") return sorted.slice(0, 1);
  return [];
}

/** 보고서 하나의 판정 → 남길 (unitId, orderIndex) 목록. 같은 단원은 한 번만. */
export function unitsToRecord(
  verdict: TextVerdict,
): Array<{ unitId: string; orderIndex: number }> {
  const seen = new Set<string>();
  const out: Array<{ unitId: string; orderIndex: number }> = [];
  for (const line of verdict.lines) {
    for (const unit of representativeUnits(line)) {
      if (seen.has(unit.id)) continue;
      seen.add(unit.id);
      out.push({ unitId: unit.id, orderIndex: unit.orderIndex });
    }
  }
  return out;
}

/**
 * 마지막 보고서 — «그날 수업했나»와 «원문에 뭐라고 적혔나»의 근거 (D-64).
 *
 * 시험기간(내신대비·모의고사…)만 적힌 날은 진도 행이 하나도 안 생긴다. 그 학생을
 * 화면이 「자동 출제 제외 — 표시만」으로 보여 주려면, 진도와 **별도로** 마지막
 * 보고서의 날짜·원문이 학생에 남아 있어야 한다. 같은 날 보고서가 여러 장이면
 * 전부 합친다 — 한 장만 남기면 원문 표시가 반쪽이 된다.
 */
export function lastReportOf(
  reports: readonly EywaReport[],
): { date: string; text: string } | null {
  if (reports.length === 0) return null;
  const ordered = [...reports].sort(
    (a, b) =>
      a.reportDate.localeCompare(b.reportDate) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );
  const date = ordered.at(-1)!.reportDate;
  const text = ordered
    .filter((r) => r.reportDate === date)
    .map((r) => r.progress)
    .join("\n");
  return { date, text };
}

export interface PlannedProgressRow {
  eywaReportId: string;
  unitId: string;
  /** Progress.recordedAt — 수업일(report_date). */
  recordedAt: string;
  /**
   * Progress.createdAt — **eywa 의 created_at + 줄 순서 1ms.**
   * 우리 트랜잭션의 now() 를 쓰면 한 실행의 모든 행이 같은 시각이 되어
   * `getCurrentProgress`(recordedAt → createdAt 내림차순)의 «현재 진도»가
   * 비결정이 된다(grok #9). eywa 시각을 물려받으면 «그날의 마지막 진도»가
   * 결정적으로 이긴다.
   */
  createdAt: Date;
}

export interface StudentProgressPlan {
  rows: PlannedProgressRow[];
  /** «애매»로 남아 행을 못 만든 판정 수 — 조용히 버리지 않는다. */
  ambiguous: number;
  /** 미분류 원문 — 화면·보고서에 그대로 찍는다. */
  unresolved: string[];
  /** 시험기간만 적힌 보고서 수. */
  examOnly: number;
  /** 마지막으로 닿은 orderIndex — 대사·보고용. */
  furthestOrderIndex: number | null;
}

/**
 * 한 학생의 보고서 나열 → 진도 행 계획.
 *
 * 보고서는 (reportDate, createdAt, id) 오름차순으로 처리한다 — 계약의 정렬
 * 그대로. 앞 보고서가 정한 위치(`furthestOrderIndex`)가 뒤 보고서의 «애매»
 * (1학기/2학기 같은 이름 대단원)를 가른다(grok #7). 이 이음을 끊으면 계량기의
 * 「애매 0」이 제품에서 재현되지 않는다.
 */
export function planStudentProgress(
  index: UnitIndex,
  reports: readonly EywaReport[],
): StudentProgressPlan {
  const ordered = [...reports].sort(
    (a, b) =>
      a.reportDate.localeCompare(b.reportDate) ||
      a.createdAt.localeCompare(b.createdAt) ||
      a.id.localeCompare(b.id),
  );

  const rows: PlannedProgressRow[] = [];
  const unresolved: string[] = [];
  let ambiguous = 0;
  let examOnly = 0;
  let near: number | null = null;

  for (const report of ordered) {
    const verdict = resolveProgressText(index, report.progress, {
      nearOrderIndex: near,
    });
    unresolved.push(...verdict.unresolved);
    ambiguous += verdict.lines.filter((line) => line.kind === "애매").length;
    if (verdict.examPeriod && !verdict.current) examOnly += 1;

    const base = new Date(report.createdAt).getTime();
    unitsToRecord(verdict).forEach((unit, lineIndex) => {
      rows.push({
        eywaReportId: report.id,
        unitId: unit.unitId,
        recordedAt: report.reportDate,
        createdAt: new Date(base + lineIndex),
      });
      near = unit.orderIndex;
    });
    if (verdict.furthestOrderIndex !== null) near = verdict.furthestOrderIndex;
  }

  return { rows, ambiguous, unresolved, examOnly, furthestOrderIndex: near };
}
