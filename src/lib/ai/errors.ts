/**
 * Claude API 래퍼(src/lib/ai/**) 공용 에러 타입.
 *
 * 호출자(T3.1의 `src/app/api/problems/generate|transform/route.ts`)는
 * `AiGenerationError` 하나만 잡으면 된다 — 파싱 실패/네트워크 실패/검증 실패를 모두 이
 * 타입으로 정리해 던지므로, 라우트는 `error instanceof AiGenerationError` 시
 * `jsonError("AI_GENERATION_FAILED", error.message, 502)`로 매핑하면 된다.
 */

/** AI 응답 텍스트를 JSON/계약 스키마로 해석하는 데 실패했을 때 — 재시도 대상(src/lib/ai/retry.ts). */
export class AiParseError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiParseError";
  }
}

/**
 * 재시도까지 소진했거나(파싱 실패), 애초에 재시도 대상이 아닌 실패(네트워크/인증/설정 오류,
 * 원본 재현 검사 전멸 등)일 때 던지는 최종 에러 — 호출자가 잡아야 하는 유일한 타입.
 */
export class AiGenerationError extends Error {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiGenerationError";
  }
}
