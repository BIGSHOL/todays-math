/**
 * Mock 데이터 전역 공유 UUID 상수 (T0.5.2).
 *
 * 목적: `src/mocks/data/*.ts` 픽스처와 `src/mocks/handlers/*.ts`, 그리고 이후 컴포넌트/E2E
 * 테스트가 "같은 반/학생/문제/테스트"를 가리킬 때 항상 같은 문자열을 참조하도록 한다.
 * 계약의 `uuidSchema`(`z.uuid()`)를 통과하는 형식(8-4-4-4-12, 버전 니블 4 / 변형 니블 8)을
 * 유지하되, 값 자체는 사람이 도메인을 알아볼 수 있게 접두 숫자로 구분한다.
 *
 * 대응 API 경로: 없음 (전 계약 파일이 참조하는 테스트 전용 데이터 모듈).
 */

/**
 * 유효한 UUID(v4 형식) 문자열을 만든다.
 * @param domain 4자리 숫자 문자열 — 엔티티 종류를 구분하는 접두 (예: "1000" = 사용자).
 * @param seq 1부터 시작하는 일련번호.
 */
function makeId(domain: string, seq: number): string {
  const group1 = `${domain}0000`;
  const suffix = seq.toString().padStart(12, "0");
  return `${group1}-0000-4000-8000-${suffix}`;
}

// ── 사용자 (Auth) ────────────────────────────────────────────
/** 기본 로그인 사용자 — 대부분의 Mock 데이터(반/문제/테스트)의 소유자. */
export const USER_TEACHER_ID = makeId("1000", 1);
/** 소유권 검증(403 FORBIDDEN) 테스트 전용 — 다른 사용자. */
export const USER_OTHER_ID = makeId("1000", 2);

// ── 반 (Class) ───────────────────────────────────────────────
/** 수준 높은 반 (심화) — 난이도 배분 easy 비중 낮음. */
export const CLASS_A_ID = makeId("2000", 1);
/** 수준 낮은 반 (기초) — 난이도 배분 easy 비중 높음. */
export const CLASS_B_ID = makeId("2000", 2);
/** USER_OTHER_ID 소유 — 소유권 403 테스트 전용. */
export const CLASS_OTHER_ID = makeId("2000", 99);
/** 현재 진도가 "등록된 문제 0건" 단원(MOCK_EMPTY_PROBLEM_UNIT)인 반 — INSUFFICIENT_PROBLEMS 재현 전용. */
export const CLASS_STARVED_ID = makeId("2000", 98);

// ── 학생 (Student) ───────────────────────────────────────────
export const STUDENT_IDS = [1, 2, 3, 4, 5].map((n) => makeId("3000", n));

// ── 단원 (Unit) — 실제 값은 src/mocks/data/units.ts가 시드에서 발췌해 채운다.
export function unitId(seq: number): string {
  return makeId("4000", seq);
}

// ── 문제 (Problem) — 등록형(manual/past_exam) 30건.
export function problemId(seq: number): string {
  return makeId("5000", seq);
}
/** USER_OTHER_ID 소유 private — 소유권 403 테스트 전용. */
export const PROBLEM_OTHER_ID = makeId("5000", 99);
/** USER_OTHER_ID 소유 shared — 공용 풀 조회 테스트 전용 (D-31). */
export const PROBLEM_OTHER_SHARED_ID = makeId("5000", 98);

// ── AI 생성/변형 문제 (aiProblems.ts) ─────────────────────────
export function aiGeneratedProblemId(seq: number): string {
  return makeId("6000", seq);
}
export function aiTransformedProblemId(seq: number): string {
  return makeId("7000", seq);
}

// ── 진도 (Progress) ──────────────────────────────────────────
export function progressId(seq: number): string {
  return makeId("8000", seq);
}

// ── 테스트 (Test) ────────────────────────────────────────────
export const TEST_DRAFT_ID = makeId("9000", 1);
export const TEST_CONFIRMED_ID = makeId("9000", 2);
export const TEST_PRINTED_ID = makeId("9000", 3);
/** INSUFFICIENT_PROBLEMS 실패 경로 재현용 — 이 id로 GET하면 존재하지 않는 테스트(NOT_FOUND)로 취급한다. */
export const TEST_NOT_FOUND_ID = makeId("9000", 999);

// ── 시험지-문제 연결 (TestProblem) ───────────────────────────
export function testProblemId(seq: number): string {
  return makeId("9100", seq);
}

/** 목록/단건 조회에서 "존재하지 않는 id"를 표현할 때 공통으로 쓰는 임의의 유효 UUID. */
export const NOT_FOUND_ID = makeId("0000", 1);

// ── 응시 결과(TestResult/ProblemAnswer/AnalysisReport) — T7.1 ─────────────────
/** 채점/분석 리포트 테스트 전용 Test — CLASS_A_ID 소속, 문항 3개(객관식 정답/오답 + 서술형). */
export const TEST_RESULT_FIXTURE_TEST_ID = makeId("9000", 50);
export function testResultFixtureProblemId(seq: number): string {
  return makeId("5000", 300 + seq);
}
