// `server-only` 는 쓰지 않는다 — 이 저장소의 다른 서버 lib(`src/lib/tests/**` 등)과 같은
// 관례이고, Route Handler 를 함수로 직접 호출하는 API 테스트(jsdom)가 import 하지 못한다.
import { db } from "@/lib/db";

import {
  isRunVisibleTo,
  type ActualScoreRow,
  type OwnedStudent,
  type PredictionRunRow,
} from "./composeRounds";

/**
 * '오늘의 시험' 조회의 DB 접근 — 두 라우트가 같은 소유권 규칙을 쓰도록 한 곳에 모았다.
 *
 * 🔴 **읽기 전용.** 이 경로에는 create/update/delete 가 없다.
 */

/** 이 사용자가 소유한 학생 — 반(Class.userId)까지 거슬러 확인한다. */
export async function loadOwnedStudents(
  userId: string,
): Promise<OwnedStudent[]> {
  const classes = await db.class.findMany({ where: { userId } });
  if (classes.length === 0) return [];

  const students = await db.student.findMany({
    where: { classId: { in: classes.map((c) => c.id) } },
  });
  return students.map((s) => ({ id: s.id, name: s.name }));
}

export type VisibleRuns = {
  runs: PredictionRunRow[];
  actuals: ActualScoreRow[];
  ownedStudents: OwnedStudent[];
};

/**
 * 이 사용자에게 보이는 회차 전부.
 *
 * ⚠️ 성능 메모: `PredictionRun` 에 `userId` 가 없어 SQL 로 좁히지 못하고 전량을 읽어
 *    앱에서 거른다. 학원 한 곳 규모(회차 수십 건)에서는 문제가 없지만, `userId` 컬럼이
 *    생기면 `where: { userId }` 로 바꿔 이 왕복을 없애야 한다.
 *    학교명으로 미리 좁히는 방법도 검토했으나, `Student.schoolName` 이 NULL 인 학생의
 *    회차가 통째로 사라져 **조용한 누락**이 생기므로 쓰지 않았다.
 */
export async function loadVisibleRuns(userId: string): Promise<VisibleRuns> {
  const ownedStudents = await loadOwnedStudents(userId);
  const ownedIds = new Set(ownedStudents.map((s) => s.id));
  if (ownedIds.size === 0) {
    return { runs: [], actuals: [], ownedStudents };
  }

  const [allRuns, ownedActuals] = await Promise.all([
    db.predictionRun.findMany({ orderBy: { createdAt: "desc" } }),
    db.actualExamScore.findMany({
      where: { studentId: { in: [...ownedIds] } },
    }),
  ]);

  const runs = (allRuns as PredictionRunRow[]).filter((run) =>
    isRunVisibleTo(run, ownedActuals as ActualScoreRow[], ownedIds),
  );
  const visibleRunIds = new Set(runs.map((r) => r.id));

  return {
    runs,
    actuals: (ownedActuals as ActualScoreRow[]).filter((a) =>
      visibleRunIds.has(a.runId),
    ),
    ownedStudents,
  };
}
