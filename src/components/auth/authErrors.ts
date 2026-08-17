import type { ZodError } from "zod";

export const CREDENTIALS_ERROR = "이메일 또는 비밀번호가 올바르지 않습니다.";

/**
 * zod 와 계약 스키마를 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 *
 * 로그인/가입 화면은 수식도 목록도 없는데 zod + 계약 모듈(279KB)이 초기 번들에
 * 실려 첫 페인트를 막고 있었다. 여기서 하는 검증은 전부 `fetch` 응답이 온 뒤
 * (`fieldErrorsFromResponse`)라 그 시점에 불러도 늦지 않다. `ZodError` 는 타입만
 * 쓰므로 `import type` 이면 런타임 코드가 남지 않는다.
 */
async function loadErrorSchemas() {
  const [{ z }, contract] = await Promise.all([
    import("zod"),
    import("@/contracts/common.contract"),
  ]);
  return {
    errorResponseSchema: contract.errorResponseSchema,
    fieldErrorListSchema: z.array(contract.fieldErrorDetailSchema),
  };
}

export function fieldErrorsFromZod(error: ZodError): Record<string, string> {
  const next: Record<string, string> = {};
  for (const issue of error.issues) {
    const key = String(issue.path[0] ?? "");
    if (key && !next[key]) {
      next[key] = issue.message;
    }
  }
  return next;
}

export async function fieldErrorsFromResponse(
  res: Response,
): Promise<Record<string, string>> {
  const [json, { errorResponseSchema, fieldErrorListSchema }] =
    await Promise.all([
      res.json().catch(() => null) as Promise<unknown>,
      loadErrorSchemas(),
    ]);
  const parsed = errorResponseSchema.safeParse(json);
  if (!parsed.success) {
    return { email: "요청을 처리할 수 없습니다." };
  }

  const { code, message, details } = parsed.data.error;
  if (code === "CONFLICT") {
    return { email: message };
  }

  const fieldDetails = fieldErrorListSchema.safeParse(details);
  if (code === "VALIDATION_ERROR" && fieldDetails.success) {
    const next: Record<string, string> = {};
    for (const item of fieldDetails.data) {
      if (!next[item.field]) {
        next[item.field] = item.message;
      }
    }
    if (Object.keys(next).length > 0) {
      return next;
    }
  }

  return { email: message };
}
