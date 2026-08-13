/**
 * 진도 해석 순수 함수 (Phase 2, T2.2) — DB/AI 등 외부 의존성 없이, 이미 조회한 PROGRESS 이력
 * 배열만으로 "현재 진도"를 판정한다. `src/app/api/progress/**`는 DB 조회 후 이 함수로
 * 위임만 하고, T4.2(출제 API, `src/lib/generator/**`)도 동일한 판정 로직을 재사용한다.
 *
 * 반/개별 이중 구조 (docs/planning/04-database-design.md §2.6):
 *   - student_id IS NULL 인 이력 = 반 전체 진도
 *   - student_id 가 있는 이력 = 해당 학생의 개별 진도
 *   - Student.use_individual_progress = true 이면 반 진도 대신 개별 진도가 적용된다
 *     (단, 아직 개별 진도 이력이 한 건도 없으면 반 진도로 폴백한다)
 *
 * "최신" 판정: recordedAt(날짜) 내림차순, 동일 날짜면 createdAt(기록 시각) 내림차순.
 */

export interface ProgressRecordLike {
  id: string;
  classId: string;
  studentId: string | null;
  unitId: string;
  /** YYYY-MM-DD (Progress.recordedAt) */
  recordedAt: string;
  /** ISO 8601 datetime (Progress.createdAt) */
  createdAt: string;
}

export interface GetCurrentProgressInput<T extends ProgressRecordLike> {
  /** 반 전체 진도 이력(studentId=null). 정렬 불필요 — 이 함수 내부에서 최신을 계산한다. */
  classProgress: T[];
  /** 조회 대상 학생의 개별 진도 이력. 학생을 지정하지 않았으면 생략(또는 빈 배열). */
  studentProgress?: T[];
  /** Student.useIndividualProgress — true여야 개별 진도가 반 진도보다 우선 적용된다. */
  useIndividualProgress?: boolean;
}

/** 이력 배열에서 "최신" 1건을 찾는다. 배열이 비어 있으면 null. */
export function findLatestProgress<T extends ProgressRecordLike>(
  records: T[],
): T | null {
  if (records.length === 0) return null;
  return records.reduce((latest, row) => {
    if (row.recordedAt !== latest.recordedAt) {
      return row.recordedAt > latest.recordedAt ? row : latest;
    }
    return row.createdAt > latest.createdAt ? row : latest;
  });
}

/**
 * 반/개별 이중 구조를 적용해 "현재 진도" 1건을 계산한다.
 * useIndividualProgress가 true이고 개별 이력이 1건 이상이면 개별 진도의 최신 건을,
 * 그렇지 않으면 반 진도의 최신 건을 반환한다. 이력이 전혀 없으면 null(진도 미기록).
 */
export function getCurrentProgress<T extends ProgressRecordLike>({
  classProgress,
  studentProgress = [],
  useIndividualProgress = false,
}: GetCurrentProgressInput<T>): T | null {
  if (useIndividualProgress) {
    const latestIndividual = findLatestProgress(studentProgress);
    if (latestIndividual) return latestIndividual;
  }
  return findLatestProgress(classProgress);
}

/** "다음 소단원 1클릭 진행"(D-19) — 전역 연속 order_index(D-27) 기준 다음 orderIndex. */
export function nextOrderIndex(currentOrderIndex: number): number {
  return currentOrderIndex + 1;
}
