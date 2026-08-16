// `server-only` 는 쓰지 않는다 — 이 저장소의 다른 서버 lib(`src/lib/tests/**` 등)과 같은
// 관례이고, Route Handler 를 함수로 직접 호출하는 API 테스트(jsdom)가 import 하지 못한다.
import { db } from "@/lib/db";

import {
  isRunOwnedBy,
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
 * 이 사용자에게 보이는 회차 전부 — **소유자는 `PredictionRun.userId`** 다.
 *
 * 📌 이력: 처음에는 "userId 컬럼이 아직 없다"는 전제로 `PredictionRun` 을 전량 읽어
 *    학생 도달성으로 앱에서 걸렀다. 전제가 틀렸고(컬럼은 이미 있었다), 그 결과
 *    **내 회차가 하나도 안 보였다** — 엔진이 학생별 예상 점수를 아직 내지 않아
 *    `predictedScores` 가 비어 있으면 되짚을 학생이 없기 때문이다.
 *    이제 SQL 이 `where: { userId }` 로 거른다. 전량 읽기도 함께 사라졌다
 *    (`@@index([userId, createdAt(sort: Desc)])` 가 그대로 쓰인다).
 *
 * 학생 목록은 여전히 필요하다 — **이름**을 붙이고, 남의 학생 이름이 새지 않게
 * 상세에서 한 번 더 거르는 데 쓴다(`toRoundDetail`). 다만 학생이 0명이어도 회차는
 * 보인다: 시험지 단위 청사진은 학생 없이도 유효한 산출물이고, 회차는 내 것이다.
 */
export async function loadVisibleRuns(userId: string): Promise<VisibleRuns> {
  const [ownedStudents, ownedRuns] = await Promise.all([
    loadOwnedStudents(userId),
    db.predictionRun.findMany({
      where: { userId },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  // SQL 이 이미 걸렀지만 조합 계층에서 같은 규칙을 한 번 더 잠근다(fail closed).
  const runs = (ownedRuns as PredictionRunRow[]).filter((run) =>
    isRunOwnedBy(run, userId),
  );

  const ownedIds = ownedStudents.map((s) => s.id);
  if (ownedIds.length === 0 || runs.length === 0) {
    return { runs, actuals: [], ownedStudents };
  }

  // 실측은 **내 학생 것만** 읽는다 — 같은 회차에 남의 학생 점수가 섞여 들어오지 않게.
  const actuals = (await db.actualExamScore.findMany({
    where: {
      runId: { in: runs.map((r) => r.id) },
      studentId: { in: ownedIds },
    },
  })) as ActualScoreRow[];

  return { runs, actuals, ownedStudents };
}
