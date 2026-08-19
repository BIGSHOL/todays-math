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

import { AiCapacityError, AiConfigError } from "./errors";

/** 문제 생성/변형에 사용하는 모델 — 프롬프트 버전과 마찬가지로 변경 시 사유를 남긴다. */
export const DEEPSEEK_MODEL = "deepseek-v4-pro";

const DEEPSEEK_BASE_URL = "https://api.deepseek.com";

/**
 * 추론형(v4-pro) 전용 max_tokens 하한. v4-pro는 사고과정(`reasoning_content`)이 max_tokens를
 * 함께 소모하므로, 호출부 값(4096 등)이 추론에 소진되면 정작 답변 JSON이 잘려
 * (`finish_reason === "length"`) 파싱이 실패한다.
 * max_tokens는 상한일 뿐 실사용 토큰만 과금되므로 넉넉히 잡아도 비용 영향이 없다.
 *
 * ⚠️ **32,000 은 부족했다.** 2026-08-19 실측: 그림 문항(내접 정사각형 수열) 변형에서
 *    추론만으로 32k 를 다 써서 `content` 가 비고 `reasoning_content` 54KB 가 문장 중간에
 *    끊긴 채 왔다 — JSON 배열은 0개. 도형 스펙까지 요구하면 답변 자체도 길어진다.
 *    API 는 200,000 까지 받는다(실측). 환경마다 조절할 수 있게 열어 둔다.
 */
const DEEPSEEK_MIN_MAX_TOKENS = Number(
  process.env.DEEPSEEK_MAX_TOKENS ?? 64000,
);

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

  const choice = response.choices[0];

  // ⚠️ **잘림을 먼저 본다.** 이 검사가 없으면 아래 `reasoning_content` 폴백이 «답이 아닌
  //    생각»을 돌려주고, 그것은 절대 JSON 이 될 수 없어 "유효한 JSON 이 아닙니다"로만 남는다.
  //    실패가 침묵하는 자리다 — 원인(예산 부족)이 화면 어디에도 안 나온다.
  if (choice?.finish_reason === "length") {
    throw new AiCapacityError(
      "AI 응답이 최대 길이에서 잘렸습니다(추론이 예산을 소진).",
    );
  }

  // v4-pro는 답을 `content`에, 사고과정을 `reasoning_content`(OpenAI 표준 타입 밖)에 나눠 담는다.
  // content 우선 + 비어 있을 때만 reasoning_content 폴백(둘 다 비면 파싱 단계에서 표면화된다).
  const message = choice?.message as
    | { content?: string | null; reasoning_content?: string | null }
    | undefined;

  return (message?.content?.trim() ? message.content : message?.reasoning_content) ?? "";
}
