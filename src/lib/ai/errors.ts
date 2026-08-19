/**
 * AI(DeepSeek) API 래퍼(src/lib/ai/**) 공용 에러 타입.
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

/**
 * **설정**이 없어서 AI 를 아예 부르지 못한 경우 — `DEEPSEEK_API_KEY` 미설정 등.
 *
 * `AiGenerationError` 를 상속하므로 기존 `instanceof AiGenerationError` 검사는 그대로
 * 잡는다(안전). 다만 라우트는 이것을 **먼저** 검사해 원장님이 화면에서 바로 알아볼 수 있는
 * 사유를 돌려준다 — 값(키)은 절대 싣지 않고 "무엇이 없다"만 말한다.
 *
 * ⚠️ 이 타입이 없던 2026-08-19, `DEEPSEEK_API_KEY` 가 어느 워크트리에도 없어 변형이 100%
 *    실패하고 있었는데 화면에는 "변형에 실패했습니다" 한 줄뿐이라 원인을 볼 수 없었다.
 *    상속 관계 때문에 **검사 순서가 뒤집히면 다시 조용해진다** — 라우트에 가드 테스트가 있다.
 */
export class AiConfigError extends AiGenerationError {
  constructor(message: string, options?: { cause?: unknown }) {
    super(message, options);
    this.name = "AiConfigError";
  }
}
