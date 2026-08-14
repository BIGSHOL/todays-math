/**
 * "정답 미이관" 센티널 — import 변환기가 원본에 정답이 없을 때 채워 넣는 값.
 * 생산처: src/lib/import/convertRpm.ts, src/lib/import/convertPastExam.ts
 *
 * 2026-08-14 전수검사: 9,197건 중 5,781건(62.9%)이 이 상태였고,
 * 자동 출제가 정답 유무를 보지 않아 시험지 전 문항이 채점 불가로 나갔다.
 * 정답이 채워지기 전까지 자동 출제 풀에서 제외한다.
 */
export const MISSING_ANSWER = "(정답 없음)";

/** 실제 정답이 들어 있는가 (센티널·공백 제외). */
export const hasRealAnswer = (answer: string | null | undefined): boolean =>
  typeof answer === "string" &&
  answer.trim().length > 0 &&
  answer.trim() !== MISSING_ANSWER;
