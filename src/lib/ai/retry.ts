/**
 * "파싱 실패 시 재시도 1회" 공용 정책 — 생성(generator.ts)/변형(transformer.ts) 공유.
 * 참조: docs/planning/06-tasks.md T3.2.
 */
import { AiGenerationError, AiParseError } from "./errors";

/**
 * 파싱 실패(`AiParseError`)에 한해 동일 호출을 1회만 재시도한다. 파싱 실패가 아닌 에러
 * (네트워크/인증/설정 오류 등)는 재시도하지 않고 즉시 `AiGenerationError`로 통일해 던진다 —
 * 호출자(T3.1 Route Handler)가 예외 타입 하나만 잡으면 되게 한다.
 */
export async function withOneRetryOnParseFailure<T>(
  attempt: () => Promise<T>,
): Promise<T> {
  try {
    return await attempt();
  } catch (firstError) {
    if (!(firstError instanceof AiParseError)) {
      throw toAiGenerationError(firstError);
    }
    try {
      return await attempt();
    } catch (secondError) {
      throw new AiGenerationError(
        "AI 응답을 해석하지 못했습니다(재시도 1회 후에도 실패).",
        { cause: secondError },
      );
    }
  }
}

function toAiGenerationError(error: unknown): AiGenerationError {
  return error instanceof AiGenerationError
    ? error
    : new AiGenerationError("AI 호출에 실패했습니다.", { cause: error });
}
