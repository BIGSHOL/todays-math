import { z, type ZodError } from "zod";

import {
  errorResponseSchema,
  fieldErrorDetailSchema,
} from "@/contracts/common.contract";

export const CREDENTIALS_ERROR = "이메일 또는 비밀번호가 올바르지 않습니다.";

const fieldErrorListSchema = z.array(fieldErrorDetailSchema);

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
  const json: unknown = await res.json().catch(() => null);
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
