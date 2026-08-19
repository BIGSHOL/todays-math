/**
 * DeepSeek API 클라이언트 래퍼 — 서버 전용.
 *
 * ⚠️ 이 모듈은 Route Handler(`src/app/api/**`)에서만 import한다. 클라이언트 컴포넌트에서
 * import하면 `DEEPSEEK_API_KEY`가 번들에 노출될 수 있으므로 절대 금지
 * (07-coding-convention.md "AI API 키를 클라이언트 코드에 노출 금지").
 *
 * DeepSeek Chat API는 OpenAI 호환이라 `openai` SDK에 baseURL만 바꿔 그대로 쓴다
 * (`chat.completions.create`). eywa(D:\eywa_refactoring\src\lib\ai\deepseek.ts)에서 검증된 패턴.
 *
 * 호출마다 새 클라이언트를 만든다 — AI 호출은 상태를 유지할 필요가 없는 단발 HTTP 요청이라
 * `src/lib/db.ts`(Prisma)처럼 전역 싱글턴으로 캐싱해 커넥션을 아낄 이유가 없다
 * (불필요한 전역 가변 상태 회피 — 테스트 간 격리에도 유리하다).
 */
import OpenAI from "openai";

import { AiConfigError } from "./errors";

/** 문제 생성/변형에 사용하는 모델 — 프롬프트 버전과 마찬가지로 변경 시 사유를 남긴다. */
export const DEEPSEEK_MODEL = "deepseek-v4-pro";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * 추론형(v4-pro) 전용 max_tokens 하한. v4-pro는 사고과정(`reasoning_content`)이 max_tokens를
 * 함께 소모하므로, 호출부 값(4096 등)이 추론에 소진되면 정작 답변 JSON이 잘려
 * (`finish_reason === "length"`) 파싱이 실패한다(eywa 2026-07-16 실측: 추론만 ~8k 토큰).
 * max_tokens는 상한일 뿐 실사용 토큰만 과금되므로 넉넉히 잡아도 비용 영향이 없다.
 */
const DEEPSEEK_MIN_MAX_TOKENS = 32000;

function requireApiKey(): string {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new AiConfigError(
      "DEEPSEEK_API_KEY가 설정되어 있지 않습니다. 서버 환경변수를 확인해주세요.",
    );
  }
  return apiKey;
}

function createDeepseekClient(): OpenAI {
  return new OpenAI({ apiKey: requireApiKey(), baseURL: DEEPSEEK_BASE_URL });
}

export interface CallAiParams {
  system: string;
  prompt: string;
  maxTokens?: number;
}

/**
 * DeepSeek Chat Completions를 호출해 응답 텍스트를 반환한다.
 * JSON 잘림(truncation) 방지를 위해 `maxTokens`에 하한을 둔다 — 문제 생성/변형 응답은
 * 배열 전체가 한 번에 와야 파싱이 가능하다.
 *
 * ⚠️ `response_format: json_object`(JSON mode)는 쓰지 않는다 — 이 프로젝트의 프롬프트는
 * **JSON 배열**을 요구하는데 JSON mode는 객체 루트를 강제한다. 코드펜스/잡설은
 * `parseAiJsonArray`(jsonRepair.ts)가 걷어낸다.
 */
export async function callAi({
  system,
  prompt,
  maxTokens = 4096,
}: CallAiParams): Promise<string> {
  const client = createDeepseekClient();
  const response = await client.chat.completions.create({
    model: DEEPSEEK_MODEL,
    max_tokens: Math.max(maxTokens, DEEPSEEK_MIN_MAX_TOKENS),
    messages: [
      { role: "system", content: system },
      { role: "user", content: prompt },
    ],
  });

  // v4-pro는 답을 `content`에, 사고과정을 `reasoning_content`(OpenAI 표준 타입 밖)에 나눠 담는다.
  // content 우선 + 비어 있을 때만 reasoning_content 폴백(둘 다 비면 파싱 단계에서 표면화된다).
  const message = response.choices[0]?.message as
    | { content?: string | null; reasoning_content?: string | null }
    | undefined;

  return (message?.content?.trim() ? message.content : message?.reasoning_content) ?? "";
}
