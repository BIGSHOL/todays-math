/**
 * 문항 신고 · 검수 계정 계약 — 검수 콘솔(17).
 *
 * 대응 API 경로:
 *   POST  /api/problems/{id}/reports   — 문항 신고
 *   GET   /api/reports                 — 신고 목록 (검수 대기열)
 *   PATCH /api/reports/{id}            — 신고 처리 (resolved / dismissed)
 *
 * 왜 필요한가: 문항이 47,049건이라 **전량 검수가 불가능하다**(한 문항 10초로도
 * 131시간). 그래서 마지막 안전망은 「쓰다가 이상하면 누른다」이고, 그 기록이
 * 다음 검수의 대기열이 된다.
 *
 * ⚠️ 신고는 **문항을 바꾸지 않는다.** 출제 제외 여부(`directUseAllowed`)를 신고가
 *    직접 건드리면, 오신고 한 건이 멀쩡한 문항을 지면에서 지운다. 신고는 **기록**이고,
 *    빼는 것은 사람이 따로 결정한다(D-22 와 같은 결).
 *
 * 참조: docs/planning/18-qa-playbook.md · CLAUDE.md D-22
 */
import { z } from "zod";

import {
  dataResponseSchema,
  isoDateTimeSchema,
  listResponseSchema,
} from "./common.contract";

/**
 * 신고 사유. **기계 키**로 두고 화면 문구는 UI 가 붙인다 —
 * 한글 문구를 키로 쓰면 문구를 다듬는 순간 지난 기록이 갈라진다.
 */
export const reportReasonSchema = z.enum(
  ["figure", "content", "answer", "solution", "unit", "other"],
  { message: "신고 사유가 올바르지 않습니다." },
);
export type ReportReason = z.infer<typeof reportReasonSchema>;

export const reportStatusSchema = z.enum(["open", "resolved", "dismissed"], {
  message: "신고 상태가 올바르지 않습니다.",
});
export type ReportStatus = z.infer<typeof reportStatusSchema>;

/**
 * 해설이 **어디서 왔나.**
 *
 * 🔴 `original` 과 `ai` 를 반드시 갈라 둔다. 안 갈라 두면 다음 사람이 둘을 못 가르고,
 *    **틀린 AI 해설이 「원래 그랬던 것」이 된다.** 해설 없음이 32,931건(70%)이라
 *    AI 로 채울 물량이 크고, 그만큼 이 구분이 오래 남는다.
 *  · `none`     — 해설이 없다
 *  · `original` — 원본에 있던 것(교재·기출·자작). 우리가 만든 것이 아니다
 *  · `ai`       — 우리가 AI 로 만들었다
 */
export const solutionSourceSchema = z.enum(["none", "original", "ai"], {
  message: "해설 출처가 올바르지 않습니다.",
});
export type SolutionSource = z.infer<typeof solutionSourceSchema>;

/**
 * 계정 역할.
 *  · `director` — 원장. 지금까지의 모든 사용자가 이쪽이다
 *  · `reviewer` — 검수 전용. 문제은행을 보고 신고만 한다
 */
export const userRoleSchema = z.enum(["director", "reviewer"], {
  message: "계정 역할이 올바르지 않습니다.",
});
export type UserRole = z.infer<typeof userRoleSchema>;

/** 신고에 덧붙이는 설명. 너무 길면 검수자가 안 읽는다. */
export const reportNoteSchema = z
  .string()
  .trim()
  .max(500, { message: "설명은 500자를 넘을 수 없습니다." });

/**
 * 신고 등록 요청.
 *
 * 🔴 `other` 는 **설명이 있어야 받는다.** 「기타」에 설명이 없으면 다음 사람이
 *    무엇을 봐야 할지 알 수 없어 그 기록은 대기열만 늘린다.
 */
export const problemReportCreateRequestSchema = z
  .strictObject({
    reason: reportReasonSchema,
    note: reportNoteSchema.optional(),
  })
  .refine((v) => v.reason !== "other" || (v.note ?? "").length > 0, {
    message: "「기타」로 신고할 때는 무엇이 이상한지 적어야 합니다.",
    path: ["note"],
  });
export type ProblemReportCreateRequest = z.infer<
  typeof problemReportCreateRequestSchema
>;

export const problemReportSchema = z.strictObject({
  id: z.uuid(),
  problemId: z.uuid(),
  /** 누가 신고했나. 지운 계정도 기록은 남는다. */
  reporterId: z.uuid().nullable(),
  reason: reportReasonSchema,
  note: z.string().nullable(),
  status: reportStatusSchema,
  /** 처리하며 남긴 말 — 「왜 그대로 두는가」가 여기 남아야 같은 신고가 또 안 온다. */
  resolutionNote: z.string().nullable(),
  resolvedAt: isoDateTimeSchema.nullable(),
  createdAt: isoDateTimeSchema,
});
export type ProblemReportEntity = z.infer<typeof problemReportSchema>;

export const problemReportResponseSchema =
  dataResponseSchema(problemReportSchema);
export const problemReportListResponseSchema =
  listResponseSchema(problemReportSchema);

/**
 * 신고 처리 요청. `open` 으로는 되돌릴 수 없다 —
 * 처리한 사실을 지우면 「몇 건이 남았나」가 거짓이 된다.
 */
export const problemReportResolveRequestSchema = z.strictObject({
  status: z.enum(["resolved", "dismissed"], {
    message: "처리 결과는 resolved 또는 dismissed 여야 합니다.",
  }),
  resolutionNote: reportNoteSchema.optional(),
});
export type ProblemReportResolveRequest = z.infer<
  typeof problemReportResolveRequestSchema
>;
