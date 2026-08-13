/**
 * Route Handler(`src/app/api/**`) 공용 응답 유틸.
 *
 * `src/mocks/handlers/_helpers.ts`(MSW용)와 동일한 형태를 유지한다 — 실제 API와 Mock의
 * 응답 포맷이 갈라지지 않도록(계약 SSOT 준수) 의도적으로 대칭 설계했다.
 * 차이점은 반환 타입뿐이다(MSW `HttpResponse` ↔ Next.js `NextResponse`).
 *
 * 참조: docs/planning/02-trd.md §8.2 (응답 형식: {data, meta} / {error:{code,message,details}})
 */
import { NextResponse } from "next/server";
import type { z, ZodError } from "zod";

import type { ErrorCode } from "@/contracts/common.contract";
import { errorResponseSchema } from "@/contracts/common.contract";

/** Zod SafeParse 실패 결과를 VALIDATION_ERROR 상세(details) 배열로 변환한다. */
export function toFieldErrorDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
}

/**
 * 계약 응답 스키마로 `.parse()`한 뒤 JSON 응답을 만든다.
 * parse 실패 시(=구현이 계약과 표류) 여기서 바로 예외를 던져 문제를 즉시 드러낸다.
 */
export function jsonOk<T extends z.ZodType>(
  schema: T,
  payload: z.infer<T>,
  init?: { status?: number },
) {
  const parsed = schema.parse(payload);
  return NextResponse.json(parsed, { status: init?.status ?? 200 });
}

/** 공통 에러 응답 — errorResponseSchema로 parse한 뒤 반환한다. */
export function jsonError(
  code: ErrorCode,
  message: string,
  status: number,
  details?: unknown,
) {
  const parsed = errorResponseSchema.parse({
    error: { code, message, details },
  });
  return NextResponse.json(parsed, { status });
}

/** VALIDATION_ERROR(400) 전용 단축 헬퍼. */
export function validationError(error: ZodError) {
  return jsonError(
    "VALIDATION_ERROR",
    "요청 값이 올바르지 않습니다.",
    400,
    toFieldErrorDetails(error),
  );
}

/** NOT_FOUND(404) 전용 단축 헬퍼. */
export function notFoundError(resource: string) {
  return jsonError("NOT_FOUND", `${resource}을(를) 찾을 수 없습니다.`, 404);
}

/** FORBIDDEN(403) 전용 단축 헬퍼 — 타 사용자 소유 데이터 접근 차단. */
export function forbiddenError() {
  return jsonError(
    "FORBIDDEN",
    "본인 소유의 데이터만 접근할 수 있습니다.",
    403,
  );
}

/** UNAUTHORIZED(401) 전용 단축 헬퍼 — 세션 없음. */
export function unauthorizedError() {
  return jsonError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
}
