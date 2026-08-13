/**
 * Route Handler 공용 응답 헬퍼 — 계약(src/contracts/common.contract.ts)의 성공/에러 응답 래퍼를
 * `src/app/api/**` 전역에서 일관되게 생성하기 위한 모듈.
 *
 * MSW 목 핸들러 쪽 대응물: src/mocks/handlers/_helpers.ts — 에러 코드/메시지 관례를 동일하게 따른다
 * (실제 API와 Mock 응답이 표류하지 않도록 문구를 맞춘다).
 */
import { NextResponse } from "next/server";
import type { z, ZodError } from "zod";

import type { ErrorCode } from "@/contracts/common.contract";
import { errorResponseSchema } from "@/contracts/common.contract";

/** 계약 응답 스키마로 `.parse()`한 뒤 JSON 응답을 만든다 — 핸들러가 계약과 표류하면 여기서 즉시 예외로 드러난다. */
export function jsonData<T extends z.ZodType>(
  schema: T,
  payload: z.infer<T>,
  init?: { status?: number },
) {
  const parsed = schema.parse(payload);
  return NextResponse.json(parsed, { status: init?.status ?? 200 });
}

/** Zod SafeParse 실패 결과를 VALIDATION_ERROR 상세(details) 배열로 변환한다. */
export function toFieldErrorDetails(error: ZodError) {
  return error.issues.map((issue) => ({
    field: issue.path.join(".") || "(root)",
    message: issue.message,
  }));
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

export function validationErrorResponse(error: ZodError) {
  return jsonError(
    "VALIDATION_ERROR",
    "요청 값이 올바르지 않습니다.",
    400,
    toFieldErrorDetails(error),
  );
}

export function unauthorizedErrorResponse() {
  return jsonError("UNAUTHORIZED", "로그인이 필요합니다.", 401);
}

export function forbiddenErrorResponse() {
  return jsonError(
    "FORBIDDEN",
    "본인 소유의 데이터만 접근할 수 있습니다.",
    403,
  );
}

export function notFoundErrorResponse(resource: string) {
  return jsonError("NOT_FOUND", `${resource}을(를) 찾을 수 없습니다.`, 404);
}
