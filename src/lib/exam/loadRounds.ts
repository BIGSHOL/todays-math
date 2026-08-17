// `server-only` 는 쓰지 않는다 — 이 저장소의 다른 서버 lib(`src/lib/tests/**` 등)과 같은
// 관례이고, Route Handler 를 함수로 직접 호출하는 API 테스트(jsdom)가 import 하지 못한다.
import { db } from "@/lib/db";

import {
  isRunVisibleTo,
  type LinkedTestRow,
  type ActualScoreRow,
  type OwnedStudent,
  type PredictionRunRow,
} from "./composeRounds";

/**
 * '오늘의 시험' 조회의 DB 접근 — 두 라우트가 같은 소유권 규칙을 쓰도록 한 곳에 모았다.
 *
 * 🔴 **읽기 전용.** 이 경로에는 create/update/delete 가 없다.
 */

/**
 * 화면이 `PredictionRun` 에서 **실제로 읽는 컬럼만**.
 *
 * 예전에는 select 가 없어 행 전체를 읽었고, 거기에는 엔진 파라미터 스냅샷(`params`,
 * Json — 엔진 버전마다 커진다)이 통째로 들어 있었다. 계기판은 그것을 그리지 않는다.
 * 뺀 것: params · cutoff* · riskFlags · actualSchool* · actualRecordedAt.
 *
 * `PredictionRunRow`(composeRounds) 가 요구하는 필드와 1:1 이다 — 하나라도 빠지면
 * 타입이 즉시 빨개진다. 그래서 이 목록은 조용히 어긋날 수 없다.
 */
const RUN_SELECT = {
  id: true,
  userId: true,
  examDate: true,
  createdAt: true,
  engineVersion: true,
  school: true,
  level: true,
  grade: true,
  subject: true,
  targetYear: true,
  targetSemester: true,
  targetRound: true,
  inputExamIds: true,
  predictedBlueprint: true,
  predictedScores: true,
} as const;

/**
 * 계기판 목록이 한 번에 읽는 회차 수 상한.
 *
 * ⚠️ **조용한 절단이다.** 이 목록 응답 계약(`examRoundListResponseSchema`)에는
 * 페이지네이션 칸이 없어서 "더 있다"를 응답에 실을 수가 없다. 계약을 바꾸는 것은
 * 이 작업(성능 수리)의 범위 밖이라, 지금은 **최신순 상한**으로 둔다.
 * 회차가 이 수를 넘기 시작하면 목록 계약에 페이지네이션을 붙여야 한다.
 */
const MAX_VISIBLE_RUNS = 50;

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
  /** 회차에 연결된 예측 문제지 — 파이프라인 문제지·채점 단계의 근거(15 §B). */
  linkedTests: LinkedTestRow[];
  runs: PredictionRunRow[];
  actuals: ActualScoreRow[];
  ownedStudents: OwnedStudent[];
};

/** 회차 id 목록에 연결된 예측 문제지와 채점 존재 여부. */
async function loadLinkedTests(runIds: string[]): Promise<LinkedTestRow[]> {
  if (runIds.length === 0) return [];
  const rows = await db.test.findMany({
    where: { predictionRunId: { in: runIds } },
    select: {
      id: true,
      predictionRunId: true,
      testResults: { select: { id: true }, take: 1 },
    },
  });
  return rows.map((t) => ({
    id: t.id,
    predictionRunId: t.predictionRunId,
    graded: t.testResults.length > 0,
  }));
}

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
      take: MAX_VISIBLE_RUNS,
      select: RUN_SELECT,
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

  // 연결된 예측 문제지와 채점 존재 여부 — 문제지·채점 단계의 실데이터 근거.
  const linkedTests = await loadLinkedTests([...visibleRunIds]);

  return {
    runs,
    actuals: (ownedActuals as ActualScoreRow[]).filter((a) =>
      visibleRunIds.has(a.runId),
    ),
    ownedStudents,
    linkedTests,
  };
}

export type VisibleRun = {
  run: PredictionRunRow;
  actuals: ActualScoreRow[];
  ownedStudents: OwnedStudent[];
  linkedTests: LinkedTestRow[];
};

/**
 * **회차 1건**만 읽는다 — 상세 화면 전용.
 *
 * 예전에는 상세도 `loadVisibleRuns` 로 내 회차를 **전부** 읽어 온 뒤 JS `find` 로 한 건을
 * 골랐다. 회차가 늘수록 상세 1건의 비용이 같이 늘고, 실측·연결 문제지도 전 회차분을
 * 읽어 버린다. 여기서는 그 세 조회를 전부 이 회차로 좁힌다.
 *
 * 🔴 소유권 판정은 그대로다 — 남의 회차는 403 이 아니라 **null**(호출부가 404)이다.
 *    `isRunVisibleTo` 를 그대로 쓰므로 판정 근거가 한 곳에 남는다.
 */
export async function loadVisibleRun(
  userId: string,
  runId: string,
): Promise<VisibleRun | null> {
  const run = (await db.predictionRun.findUnique({
    where: { id: runId },
    select: RUN_SELECT,
  })) as PredictionRunRow | null;
  if (!run || !isRunVisibleTo(run, userId)) return null;

  const ownedStudents = await loadOwnedStudents(userId);
  const ownedIds = ownedStudents.map((s) => s.id);

  const [ownedActuals, linkedTests] = await Promise.all([
    ownedIds.length === 0
      ? Promise.resolve([])
      : db.actualExamScore.findMany({
          where: { runId, studentId: { in: ownedIds } },
        }),
    loadLinkedTests([runId]),
  ]);

  return {
    run,
    actuals: ownedActuals as ActualScoreRow[],
    ownedStudents,
    linkedTests,
  };
}
