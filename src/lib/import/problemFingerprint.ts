import { createHash } from "node:crypto";

export interface ProblemFingerprintInput {
  source: string;
  difficulty: string;
  problemType: string;
  content: string;
  answer: string;
  solution: string | null;
  directUseAllowed: boolean;
}

/**
 * DB UUID나 단원 UUID와 무관하게 같은 이관 행을 대조하는 안정적 지문.
 *
 * 단원은 환경별 UUID가 달라 제외한다. 배열 순서와 버전 문자열이 직렬화 계약을
 * 고정하므로, 필드 추가가 필요할 때는 버전을 올려 기존 감사 결과를 보존한다.
 */
export function problemFingerprint(input: ProblemFingerprintInput): string {
  const canonical = JSON.stringify([
    "todays-math/problem-fingerprint/v1",
    input.source,
    input.difficulty,
    input.problemType,
    input.content,
    input.answer,
    input.solution,
    input.directUseAllowed,
  ]);

  return createHash("sha256").update(canonical, "utf8").digest("hex");
}
