/**
 * Playwright webServer / globalSetup 이 공유하는 로컬 E2E DB 연결.
 * 운영 Supabase 는 쓰지 않는다. 로컬 Docker 는 5432 충돌을 피해 5433 을 쓴다.
 */
export const E2E_DATABASE_URL =
  "postgresql://postgres:postgres@localhost:5433/todaysmath_e2e";

export const E2E_ENV: Record<string, string> = {
  POSTGRES_PORT: "5433",
  POSTGRES_USER: "postgres",
  POSTGRES_PASSWORD: "postgres",
  POSTGRES_DB: "app",
  DATABASE_URL: E2E_DATABASE_URL,
  DIRECT_URL: E2E_DATABASE_URL,
  AUTH_SECRET: "e2e-auth-secret-todaysmath-phase6-do-not-use",
  AUTH_TRUST_HOST: "true",
  AUTH_URL: "http://localhost:3001",
  E2E_MOCK_AI: "1",
  ANTHROPIC_API_KEY: "",
  GOOGLE_CLIENT_ID: "e2e-google-client-id",
  GOOGLE_CLIENT_SECRET: "e2e-google-client-secret",
};

export const E2E_ACCOUNTS = {
  daily: {
    email: "e2e.daily@todaysmath.test",
    password: "password1",
    name: "일상원장",
    className: "중2 일상반",
    studentName: "김학생",
  },
  shortfall: {
    email: "e2e.shortfall@todaysmath.test",
    password: "password1",
    name: "부족원장",
    className: "중2 부족반",
    studentName: "박학생",
  },
} as const;

export const E2E_TARGET_SECTION = "유리수와 소수";
export const E2E_NEXT_SECTION = "순환소수";
export const E2E_TARGET_GRADE = "중2";
