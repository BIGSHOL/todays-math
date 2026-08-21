/**
 * 검수 콘솔 계약 — 「사람이 문항을 보고 무엇이라 했나」와 「다음에 무엇을 볼까」.
 *
 * 대응 구현: src/app/api/problems/[id]/review/route.ts
 *            src/app/api/review/queue/route.ts
 * 이웃 계약: src/contracts/problemReport.contract.ts (신고 사유·설명은 그쪽 것을 쓴다)
 *
 * 🔴 판정이 **셋**이다. 문제은행의 70%(32,931건)가 해설이 없어 답을 검산할 수 없다.
 *    「통과 / 신고」 둘만 두면 **확인 못 한 것에 통과를 누르게** 되고, 그러면
 *    검수 기록 전체가 잡음이 된다. 「판단 못 하겠다」를 정식 결과로 둔다.
 */
import { z } from "zod";

import { dataResponseSchema } from "@/contracts/common.contract";
import { problemSchema } from "@/contracts/problem.contract";
import {
  reportReasonSchema,
  reportNoteSchema,
} from "@/contracts/problemReport.contract";

export const reviewVerdictSchema = z.enum(["pass", "unsure", "defect"], {
  error: "검수 판정 값이 올바르지 않습니다.",
});
export type ReviewVerdict = z.infer<typeof reviewVerdictSchema>;

/**
 * 판정 한 건.
 *
 * ⚠️ `defect` 는 **사유가 있어야** 받는다. 사유 없는 신고는 대기열만 늘린다.
 * ⚠️ 반대로 `pass`·`unsure` 에 사유가 붙어 오면 **거절한다** — 화면이 상태를
 *    안 지우고 보낸 것이고, 그대로 받으면 신고가 아닌 것이 신고로 쌓인다.
 */
export const reviewSubmitRequestSchema = z
  .strictObject({
    verdict: reviewVerdictSchema,
    reason: reportReasonSchema.optional(),
    note: reportNoteSchema.optional(),
  })
  .refine((v) => v.verdict !== "defect" || v.reason !== undefined, {
    message: "신고하려면 무엇이 이상한지 골라야 합니다.",
    path: ["reason"],
  })
  .refine((v) => v.verdict === "defect" || v.reason === undefined, {
    message: "신고가 아닌 판정에는 사유를 붙일 수 없습니다.",
    path: ["reason"],
  })
  .refine(
    (v) =>
      v.verdict !== "defect" ||
      v.reason !== "other" ||
      (v.note ?? "").length > 0,
    {
      message: "「기타」로 신고할 때는 무엇이 이상한지 적어야 합니다.",
      path: ["note"],
    },
  );
export type ReviewSubmitRequest = z.infer<typeof reviewSubmitRequestSchema>;

export const reviewLogSchema = z.strictObject({
  id: z.uuid(),
  problemId: z.uuid(),
  reviewerId: z.uuid().nullable(),
  verdict: reviewVerdictSchema,
  note: z.string().nullable(),
  createdAt: z.iso.datetime(),
});
export type ReviewLogEntity = z.infer<typeof reviewLogSchema>;

/**
 * 판정 결과 — **문항이 어떻게 됐는지 같이 돌려준다.**
 * 화면이 「통과를 눌렀으니 승인됐겠지」라고 **가정하면** 서버 규칙이 바뀐 날
 * 화면만 거짓말을 한다. 서버가 실제로 만든 값을 보낸다.
 */
export const reviewSubmitResponseSchema = dataResponseSchema(
  z.strictObject({
    log: reviewLogSchema,
    /** 판정 뒤 문항의 검수 상태. `pass` 일 때만 바뀐다. */
    reviewStatus: z.enum(["pending", "approved", "rejected"]),
    /** 신고를 만들었으면 그 id. 이미 같은 신고가 열려 있었으면 그 id. */
    reportId: z.uuid().nullable(),
  }),
);

/* ── 대기열 ──────────────────────────────────────────────────────── */

export const reviewQueueKeySchema = z.enum(
  ["mm", "pending", "excluded", "nosolution", "figure"],
  { error: "대기열 값이 올바르지 않습니다." },
);
export type ReviewQueueKey = z.infer<typeof reviewQueueKeySchema>;

export const reviewQueueQuerySchema = z.strictObject({
  key: reviewQueueKeySchema,
  /**
   * 한 번에 가져올 문항 수. 검수는 한 장씩 보므로 크게 받을 이유가 없고,
   * 크게 받으면 판정하는 동안 목록이 낡는다.
   */
  limit: z.coerce.number().int().min(1).max(50).default(10),
});
export type ReviewQueueQuery = z.infer<typeof reviewQueueQuerySchema>;

/** 대기열 한 갈래 — 「왜 올라왔나」·「무엇을 볼까」를 화면이 그대로 보여 준다. */
export const reviewQueueSummarySchema = z.strictObject({
  key: reviewQueueKeySchema,
  label: z.string(),
  why: z.string(),
  look: z.string(),
  /** 이 사람이 **아직 안 본** 문항 수. 전체 건수가 아니다. */
  remaining: z.number().int().nonnegative(),
});

export const reviewQueueResponseSchema = z.strictObject({
  data: z.array(problemSchema),
  meta: z.strictObject({
    queue: reviewQueueSummarySchema,
    /** 내가 오늘까지 이 대기열에서 판정한 수 — 「얼마나 했나」. */
    reviewedByMe: z.number().int().nonnegative(),
  }),
});

export const reviewQueueListResponseSchema = dataResponseSchema(
  z.array(reviewQueueSummarySchema),
);
