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
  // 재학 정보는 응시 명단을 가르는 데 쓴다(examRoster.takesExam). 아직 채우는 화면이
  // 없어 대부분 null 이고, 그 경우 명단에서 빼지 않는다 — 모르는 것으로 막지 않는다.
  return students.map((s) => ({
    id: s.id,
    name: s.name,
    schoolName: s.schoolName,
    schoolLevel: s.schoolLevel,
    schoolGrade: s.schoolGrade,
  }));
}

export type VisibleRuns = {
  runs: PredictionRunRow[];
  actuals: ActualScoreRow[];
  ownedStudents: OwnedStudent[];
};

/**
 * 이 사용자에게 보이는 회차 전부 — `PredictionRun.userId` 로 **DB 가** 거른다.
 *
 * 예전에는 이 컬럼이 없어 전량을 읽고 앱에서 걸렀다. 그 필터가 `predictedScores` 를
 * 거치는데 그 Json 이 항상 비어 있어, 원장 본인의 새 회차가 자기 계기판에서 사라졌다
 * (adv-보정루프.md 🔴1). 컬럼과 `@@index([userId, createdAt desc])` 는 이미 있다.
 *
 * 학생이 아직 없어도 회차는 보여야 한다 — 예측을 먼저 돌리고 나중에 반을 만드는 순서도
 * 정상이고, 회차가 안 보이면 원장이 예측이 실패한 줄 안다.
 */
export async function loadVisibleRuns(userId: string): Promise<VisibleRuns> {
  const ownedStudents = await loadOwnedStudents(userId);
  const ownedIds = ownedStudents.map((s) => s.id);

  const [allRuns, ownedActuals] = await Promise.all([
    db.predictionRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
    ownedIds.length === 0
      ? Promise.resolve([])
      : db.actualExamScore.findMany({ where: { studentId: { in: ownedIds } } }),
  ]);

  // where 로 이미 걸렀지만 판정은 한 곳(`isRunVisibleTo`)에서만 한다 — 나중에 규칙이
  // 바뀔 때 쿼리와 앱이 어긋나지 않도록.
  const runs = (allRuns as PredictionRunRow[]).filter((run) =>
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
