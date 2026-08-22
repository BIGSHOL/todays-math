/**
 * 오늘의 학생별 확인테스트 — **순수 계획 로직** (2단계 화면, D-63·D-64).
 *
 * 「오늘 수업한 학생」을 세 무리로 가른다:
 *   · groups      — 기본 범위가 나온 학생을 같은 범위끼리 묶은 것(한 묶음 = 시험지 한 종)
 *   · examOrUnread — 보고서는 있는데 오늘 진도 행이 없는 학생(시험기간·미분류).
 *                    원장님 확정(D-64): 표시만 하고 자동 출제에서 뺀다.
 *   · noRange     — 진도 행은 있는데 범위를 못 낸 학생(단원 목록 밖 등). 조용히
 *                    버리지 않는다 — 화면이 세어 보여 준다.
 *
 * 범위는 제품 함수 그대로 쓴다: `getCurrentProgress` → `resolveDefaultReviewRange`
 * (D-63 첫 회 대단원 제한 포함) → `resolveRange`(소단원 목록 — 출제와 같은 함수).
 * 문항 풀 세기는 DB 가 필요하므로 여기 없다 — 라우트가 묶음마다 센다.
 */
import {
  resolveDefaultReviewRange,
  type ChapterAwareUnit,
} from "@/lib/generator/defaultReviewRange";
import { resolveRange } from "@/lib/generator/resolveRange";
import { getCurrentProgress } from "@/lib/progressResolver";

export interface DailyStudent {
  id: string;
  name: string;
  classId: string;
  className: string;
  classGrade: string;
  defaultProblemCount: number;
  schoolLevel: string | null;
  schoolGrade: number | null;
  /** YYYY-MM-DD — 마지막 eywa 보고서 날짜(D-64). null 이면 보고서가 없는 학생. */
  lastReportDate: string | null;
  lastReportText: string | null;
}

export interface DailyProgressRow {
  studentId: string;
  unitId: string;
  /** YYYY-MM-DD */
  recordedAt: string;
  /** ISO — 같은 날 안의 «마지막 진도» 판정용. */
  createdAt: string;
}

export interface LastReviewRef {
  studentId: string;
  rangeEndUnitId: string | null;
}

export interface DailyGroupStudent {
  id: string;
  name: string;
  /** 출제 요청(POST /api/tests/generate)이 요구한다. */
  classId: string;
  /** 화면 표기용 학년 — 학교 학년(중2)이 있으면 그것, 없으면 반 학년. */
  grade: string;
  className: string;
}

export interface DailyGroup {
  key: string;
  rangeStartUnitId: string;
  rangeEndUnitId: string;
  startedFrom:
    "last-review" | "progress-start" | "chapter-start" | "current-only";
  /** 출제가 실제로 쓸 소단원 목록 — 풀 세기·출제 요청이 그대로 쓴다. */
  unitIds: string[];
  /** 이 묶음에 필요한 문항 수 — 구성원 반 기본 문항 수의 최댓값(부족 판정 기준). */
  neededCount: number;
  students: DailyGroupStudent[];
}

export interface ExceptionStudent extends DailyGroupStudent {
  /** 보고서 원문 줄(중복 제거) — 「내신대비」 같은 사유가 그대로 보인다. */
  lines: string[];
}

export interface DailyReviewPlan {
  /** 오늘 보고서가 있는 학생 수(분모). */
  attended: number;
  groups: DailyGroup[];
  examOrUnread: ExceptionStudent[];
  noRange: DailyGroupStudent[];
}

const gradeOf = (s: DailyStudent): string =>
  s.schoolLevel && s.schoolGrade
    ? `${s.schoolLevel}${s.schoolGrade}`
    : s.classGrade;

export function planDailyReview(args: {
  /** 기준일 YYYY-MM-DD (호출자가 KST 로 정한다 — 서버 시계의 UTC 자정 아님). */
  day: string;
  students: readonly DailyStudent[];
  progressRows: readonly DailyProgressRow[];
  lastReviews: readonly LastReviewRef[];
  units: readonly (ChapterAwareUnit & { id: string })[];
}): DailyReviewPlan {
  const { day, students, progressRows, lastReviews, units } = args;

  const rowsByStudent = new Map<string, DailyProgressRow[]>();
  for (const row of progressRows) {
    const list = rowsByStudent.get(row.studentId) ?? [];
    list.push(row);
    rowsByStudent.set(row.studentId, list);
  }
  const lastReviewByStudent = new Map(
    lastReviews.map((r) => [r.studentId, r.rangeEndUnitId]),
  );

  const attendedStudents = students.filter((s) => s.lastReportDate === day);
  const groups = new Map<string, DailyGroup>();
  const examOrUnread: ExceptionStudent[] = [];
  const noRange: DailyGroupStudent[] = [];

  for (const st of attendedStudents) {
    const entry: DailyGroupStudent = {
      id: st.id,
      name: st.name,
      classId: st.classId,
      grade: gradeOf(st),
      className: st.className,
    };
    const rows = rowsByStudent.get(st.id) ?? [];
    const hasToday = rows.some((r) => r.recordedAt === day);
    if (!hasToday) {
      // 오늘 보고서는 있는데 진도 행이 없다 — 시험기간·미분류 (D-64: 표시만).
      const lines = [
        ...new Set(
          (st.lastReportText ?? "")
            .split("\n")
            .map((l) => l.trim())
            .filter(Boolean),
        ),
      ];
      examOrUnread.push({ ...entry, lines });
      continue;
    }

    const current = getCurrentProgress({
      classProgress: [],
      studentProgress: rows.map((r) => ({
        id: "",
        classId: st.classId,
        studentId: st.id,
        unitId: r.unitId,
        recordedAt: r.recordedAt,
        createdAt: r.createdAt,
      })),
      useIndividualProgress: true,
    });
    if (!current) {
      noRange.push(entry);
      continue;
    }
    const range = resolveDefaultReviewRange({
      units: [...units],
      currentUnitId: current.unitId,
      lastReviewEndUnitId: lastReviewByStudent.get(st.id) ?? null,
      progressUnitIds: rows.map((r) => r.unitId),
    });
    if (!range) {
      noRange.push(entry);
      continue;
    }
    const key = `${range.startUnitId}~${range.endUnitId}`;
    let group = groups.get(key);
    if (!group) {
      // 소단원 목록은 출제와 **같은 함수**로 센다(default-range 라우트와 동일 원칙).
      const { unitIds } = resolveRange({
        testType: "review",
        rangeStartUnitId: range.startUnitId,
        rangeEndUnitId: range.endUnitId,
        units: [...units],
      });
      group = {
        key,
        rangeStartUnitId: range.startUnitId,
        rangeEndUnitId: range.endUnitId,
        startedFrom: range.startedFrom,
        unitIds,
        neededCount: 0,
        students: [],
      };
      groups.set(key, group);
    }
    group.students.push(entry);
    group.neededCount = Math.max(group.neededCount, st.defaultProblemCount);
  }

  const sortedGroups = [...groups.values()]
    .map((g) => ({
      ...g,
      students: [...g.students].sort((a, b) =>
        a.name.localeCompare(b.name, "ko"),
      ),
    }))
    .sort(
      (a, b) =>
        b.students.length - a.students.length || a.key.localeCompare(b.key),
    );

  return {
    attended: attendedStudents.length,
    groups: sortedGroups,
    examOrUnread: examOrUnread.sort((a, b) =>
      a.name.localeCompare(b.name, "ko"),
    ),
    noRange: noRange.sort((a, b) => a.name.localeCompare(b.name, "ko")),
  };
}
