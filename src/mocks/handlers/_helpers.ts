/**
 * MSW 핸들러 공용 유틸 (T0.5.2).
 *
 * 모든 핸들러는 응답을 보내기 전에 반드시 계약(Zod) 응답 스키마로 `.parse()`한다 — Mock이
 * 계약과 표류하면(필드 누락/타입 불일치) 여기서 즉시 예외가 발생해 테스트가 실패하도록 강제한다
 * (T0.5.2 완료 조건 "모든 핸들러 응답이 Zod 계약 파싱 통과").
 */
import { HttpResponse, type JsonBodyType } from "msw";
import type { z, ZodError } from "zod";

import type { ErrorCode, PaginationParams } from "@/contracts/common.contract";
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
 * parse 실패 시(=Mock이 계약과 표류) 여기서 바로 예외를 던져 테스트를 실패시킨다.
 */
export function jsonOk<T extends z.ZodType>(
  schema: T,
  payload: z.infer<T>,
  init?: { status?: number },
) {
  const parsed = schema.parse(payload);
  // parse()의 반환 타입은 z.infer<T>이지만 실제로는 항상 JSON 직렬화 가능한 순수 객체다
  // (스키마가 z.strictObject 기반이므로) — MSW의 JsonBodyType으로 안전하게 좁힌다.
  return HttpResponse.json(parsed as JsonBodyType, {
    status: init?.status ?? 200,
  });
}

/** 공통 에러 응답 — errorResponseSchema로 parse한 뒤 반환한다(Mock 표류 방지는 에러 쪽도 동일 적용). */
export function jsonError(
  code: ErrorCode,
  message: string,
  status: number,
  details?: unknown,
) {
  const parsed = errorResponseSchema.parse({
    error: { code, message, details },
  });
  return HttpResponse.json(parsed, { status });
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

export function notFoundError(resource: string) {
  return jsonError("NOT_FOUND", `${resource}을(를) 찾을 수 없습니다.`, 404);
}

export function forbiddenError() {
  return jsonError(
    "FORBIDDEN",
    "본인 소유의 데이터만 접근할 수 있습니다.",
    403,
  );
}

/** page/pageSize 파라미터로 배열을 자르고 목록 응답 meta를 만든다. */
export function paginate<T>(items: T[], params: PaginationParams) {
  const start = (params.page - 1) * params.pageSize;
  const data = items.slice(start, start + params.pageSize);
  return {
    data,
    meta: { page: params.page, pageSize: params.pageSize, total: items.length },
  };
}
