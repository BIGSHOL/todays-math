/**
 * GET /api/exam/rounds — '오늘의 시험' 계기판 목록 (T7.14).
 *
 * ⚠️ T7.7 의 `/api/predictions` 와 **중복이 아니다.** 역할이 다르다.
 *   - `/api/predictions` : 엔진 **실행·저장**(쓰기). 예측을 새로 내고 `PredictionRun` 을 남긴다.
 *   - `/api/exam/rounds` : 화면 **조회 전용**(GET 만). 이미 남은 run 과 실측·학생을 조합해
 *     계기판 한 화면에 필요한 형태로 낸다. 엔진을 돌리지 않는다.
 *   합치면 화면이 예측 실행을 유발하게 되어 위험하다. 그래서 갈라 둔다.
 *
 * 🔴 이 파일에는 GET 만 있다. 쓰기 금지.
 *
 * 대응 계약: src/components/exam/examScreen.contract.ts
 */
import { examRoundListResponseSchema } from "@/components/exam/examScreen.contract";
import { jsonOk, unauthorizedError } from "@/lib/apiResponse";
import { toRoundSummary } from "@/lib/exam/composeRounds";
import { loadVisibleRuns } from "@/lib/exam/loadRounds";
import { getSessionUser } from "@/lib/session";

export async function GET() {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const { runs, actuals, ownedStudents } = await loadVisibleRuns(session.id);

  // 시리즈·시점이 계약을 통과하지 못한 행은 뺀다(null). 억지로 그리지 않는다.
  const data = runs
    .map((run) => toRoundSummary(run, actuals, ownedStudents))
    .filter((summary) => summary !== null);

  // 빈 배열이 정상 응답이다 — 아직 예측을 한 번도 안 돌렸으면 회차가 없다.
  return jsonOk(examRoundListResponseSchema, { data });
}
