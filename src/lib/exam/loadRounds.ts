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
 * 이 사용자에게 보이는 회차 전부 — 소유자 컬럼으로 **SQL 에서** 좁힌다.
 *
 * 예전에는 소유자 컬럼이 없어 전량을 읽고 "그 회차에 내 학생이 있는가"로 앱에서 걸렀다.
 * 그 우회가 실제로는 기능을 죽였다 — `predictedScores` 가 항상 비어 있어 방금 만든
 * 회차가 자기에게도 안 보였다(`isRunVisibleTo` 주석 참조).
 */
export async function loadVisibleRuns(userId: string): Promise<VisibleRuns> {
  const ownedStudents = await loadOwnedStudents(userId);
  const ownedIds = new Set(ownedStudents.map((s) => s.id));

  // 학생이 아직 없어도 **내 회차는 보여야 한다** — 예측을 먼저 돌려 볼 수 있다.
  const [myRuns, ownedActuals] = await Promise.all([
    db.predictionRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    ownedIds.size === 0
      ? Promise.resolve([])
      : db.actualExamScore.findMany({
          where: { studentId: { in: [...ownedIds] } },
        }),
  ]);

  // 이중 확인 — where 절이 나중에 느슨해져도 앱에서 한 번 더 닫는다.
  const runs = (myRuns as PredictionRunRow[]).filter((run) =>
    isRunVisibleTo(run, userId),
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
