/**
 * 문항 신고 계약 — 검수 콘솔(17).
 *
 * 여기서 잠그는 것은 **제품 규칙**이지 타입이 아니다.
 *  ⑴ 「기타」는 설명이 없으면 못 받는다 — 사유 없는 기록은 대기열만 늘린다.
 *  ⑵ 해설 출처 `original`/`ai` 는 반드시 갈린다 — 안 갈리면 틀린 AI 해설이
 *     「원래 그랬던 것」이 된다.
 *  ⑶ 처리한 신고를 `open` 으로 되돌릴 수 없다 — 「몇 건 남았나」가 거짓이 된다.
 */
import { describe, expect, it } from "vitest";

import {
  problemReportCreateRequestSchema,
  problemReportResolveRequestSchema,
  reportReasonSchema,
  solutionSourceSchema,
  userRoleSchema,
} from "../../contracts/problemReport.contract";

describe("문항 신고 — 등록 요청", () => {
  it("사유만으로 신고할 수 있다", () => {
    const r = problemReportCreateRequestSchema.safeParse({ reason: "figure" });
    expect(r.success).toBe(true);
  });

  it("설명을 덧붙일 수 있다", () => {
    const r = problemReportCreateRequestSchema.safeParse({
      reason: "answer",
      note: "정답이 ③인데 풀면 ⑤가 나온다",
    });
    expect(r.success).toBe(true);
  });

  it("🔴 「기타」는 설명이 없으면 못 받는다", () => {
    const r = problemReportCreateRequestSchema.safeParse({ reason: "other" });
    expect(r.success).toBe(false);
    if (!r.success) {
      expect(r.error.issues[0]?.path).toEqual(["note"]);
    }
  });

  it("「기타」도 설명이 있으면 받는다", () => {
    const r = problemReportCreateRequestSchema.safeParse({
      reason: "other",
      note: "보기 ②와 ④가 같은 값이다",
    });
    expect(r.success).toBe(true);
  });

  it("설명이 공백뿐이면 「기타」로는 못 받는다", () => {
    const r = problemReportCreateRequestSchema.safeParse({
      reason: "other",
      note: "   ",
    });
    expect(r.success).toBe(false);
  });

  it("500자를 넘는 설명은 받지 않는다", () => {
    const r = problemReportCreateRequestSchema.safeParse({
      reason: "content",
      note: "가".repeat(501),
    });
    expect(r.success).toBe(false);
  });

  it("모르는 사유는 받지 않는다", () => {
    expect(
      problemReportCreateRequestSchema.safeParse({ reason: "그림이 이상하다" })
        .success,
    ).toBe(false);
  });

  it("사유는 기계 키다 — 화면 문구를 바꿔도 지난 기록이 안 갈린다", () => {
    expect(reportReasonSchema.options).toEqual([
      "figure",
      "content",
      "answer",
      "solution",
      "unit",
      "other",
    ]);
  });
});

describe("해설 출처 — 원본과 AI 를 가른다", () => {
  it("셋뿐이다", () => {
    expect(solutionSourceSchema.options).toEqual(["none", "original", "ai"]);
  });

  it("🔴 original 과 ai 는 서로 다른 값이다", () => {
    expect(solutionSourceSchema.parse("original")).not.toBe(
      solutionSourceSchema.parse("ai"),
    );
  });

  it("모르는 출처는 받지 않는다 — 「그냥 해설 있음」으로 뭉개지 않는다", () => {
    expect(solutionSourceSchema.safeParse("textbook").success).toBe(false);
    expect(solutionSourceSchema.safeParse("").success).toBe(false);
  });
});

describe("계정 역할", () => {
  it("원장과 검수 전용 둘뿐이다", () => {
    expect(userRoleSchema.options).toEqual(["director", "reviewer"]);
  });
});

describe("신고 처리", () => {
  it("처리하거나 기각할 수 있다", () => {
    expect(
      problemReportResolveRequestSchema.safeParse({ status: "resolved" })
        .success,
    ).toBe(true);
    expect(
      problemReportResolveRequestSchema.safeParse({ status: "dismissed" })
        .success,
    ).toBe(true);
  });

  it("🔴 open 으로 되돌릴 수 없다", () => {
    expect(
      problemReportResolveRequestSchema.safeParse({ status: "open" }).success,
    ).toBe(false);
  });

  it("처리하며 남긴 말을 붙일 수 있다", () => {
    const r = problemReportResolveRequestSchema.safeParse({
      status: "dismissed",
      resolutionNote: "원본 교재도 이렇게 되어 있다 — 그대로 둔다",
    });
    expect(r.success).toBe(true);
  });
});
