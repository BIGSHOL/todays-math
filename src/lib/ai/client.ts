/**
 * Claude API 클라이언트 래퍼 — 서버 전용.
 *
 * ⚠️ 이 모듈은 Route Handler(`src/app/api/**`)에서만 import한다. 클라이언트 컴포넌트에서
 * import하면 `ANTHROPIC_API_KEY`가 번들에 노출될 수 있으므로 절대 금지
 * (07-coding-convention.md "Claude API 키를 클라이언트 코드에 노출 금지").
 *
 * 호출마다 새 클라이언트를 만든다 — Claude 호출은 상태를 유지할 필요가 없는 단발 HTTP
 * 요청이라 `src/lib/db.ts`(Prisma)처럼 전역 싱글턴으로 캐싱해 커넥션을 아낄 이유가 없다
 * (불필요한 전역 가변 상태 회피 — 테스트 간 격리에도 유리하다).
 */
import Anthropic from "@anthropic-ai/sdk";

import { AiGenerationError } from "./errors";

/** 문제 생성/변형에 사용하는 모델 — 프롬프트 버전과 마찬가지로 변경 시 사유를 남긴다. */
export const CLAUDE_MODEL = "claude-sonnet-4-5-20250929";

function requireApiKey(): string {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new AiGenerationError(
      "ANTHROPIC_API_KEY가 설정되어 있지 않습니다. 서버 환경변수를 확인해주세요.",
    );
  }
  return apiKey;
}

function createAnthropicClient(): Anthropic {
  return new Anthropic({ apiKey: requireApiKey() });
}

export interface CallClaudeParams {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * Claude Messages API를 호출해 텍스트 블록만 이어붙여 반환한다.
 * JSON 잘림(truncation) 방지를 위해 `maxTokens` 기본값을 넉넉히 잡는다 — 문제 생성/변형
 * 응답은 배열 전체가 한 번에 와야 파싱이 가능하다.
 */
export async function callClaude({
  system,
  prompt,
  maxTokens = 4096,
}: CallClaudeParams): Promise<string> {
  const client = createAnthropicClient();
  const response = await client.messages.create({
    model: CLAUDE_MODEL,
    max_tokens: maxTokens,
    system,
    messages: [{ role: "user", content: prompt }],
  });

  return response.content
    .filter((block): block is Anthropic.TextBlock => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}
