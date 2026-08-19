/**
 * 🔴 RED → 🟢 GREEN — 변형 고도화 (원장님 확정 2026-08-19).
 *
 * 변형이 **두 단계**로 갈라진다.
 *   POST /api/problems/transform        → 후보만 만든다. **DB 를 건드리지 않는다.**
 *   POST /api/problems/transform/adopt  → 미리보기에서 채택한 것만 넣는다.
 *
 * 종전에는 한 번에 생성+적재라 원장님이 결과를 보기 전에 이미 은행에 쌓였다.
 * 단위 테스트(src/__tests__/unit/aiGenerator.test.ts)가 순수 래퍼를 검증하고,
 * 이 파일은 HTTP 계층(세션·계약·영속·에러 매핑)만 본다.
 */
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

const { mockTransformProblem } = vi.hoisted(() => ({
  mockTransformProblem: vi.fn(),
}));

vi.mock("@/lib/ai/transformer", () => ({
  transformProblem: mockTransformProblem,
}));

import { POST as adoptRoute } from "@/app/api/problems/transform/adopt/route";
import { POST as transformRoute } from "@/app/api/problems/transform/route";
import { errorResponseSchema } from "@/contracts/common.contract";
import {
  problemTransformAdoptResponseSchema,
  problemTransformResponseSchema,
  shiftDifficulty,
} from "@/contracts/problem.contract";
import { AiConfigError, AiGenerationError } from "@/lib/ai/errors";
import {
  MOCK_PROBLEM_OTHER_USER,
  MOCK_PROBLEMS,
  NOT_FOUND_ID,
  USER_TEACHER_ID,
} from "@/mocks/data";
import { prismaTestDouble } from "@/mocks/prismaTestDouble";

function jsonRequest(url: string, body?: unknown) {
  return new NextRequest(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

/** 검사를 통과한 후보 하나. */
function passing(content = "변형된 문제") {
  return {
    content,
    answer: "2",
    solution: null,
    verified: true,
    originalAnswerRecomputed: "원본과 같은 값",
  };
}

beforeEach(() => {
  mockTransformProblem.mockReset();
});

describe("shiftDifficulty — 난이도 사다리 (계약 SSOT)", () => {
  it("한 단계 올리고 내리며, 양 끝에서는 제자리다", () => {
    expect(shiftDifficulty("easy", "up")).toBe("mid");
    expect(shiftDifficulty("mid", "up")).toBe("hard");
    expect(shiftDifficulty("hard", "up")).toBe("hard"); // 상한
    expect(shiftDifficulty("hard", "down")).toBe("mid");
    expect(shiftDifficulty("mid", "down")).toBe("easy");
    expect(shiftDifficulty("easy", "down")).toBe("easy"); // 하한
    expect(shiftDifficulty("mid", "keep")).toBe("mid");
  });
});

describe("POST /api/problems/transform — 후보만 만든다", () => {
  it("원본이 있으면 200과 후보 배열을 반환하고 **DB 는 그대로**다", async () => {
    const origin = MOCK_PROBLEMS[0]!;
    mockTransformProblem.mockResolvedValueOnce([passing()]);
    const before = await prismaTestDouble.problem.count({
      where: { userId: USER_TEACHER_ID },
    });

    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: origin.id,
        count: 1,
      }),
    );

    expect(res.status).toBe(200);
    const body = problemTransformResponseSchema.parse(await res.json());
    expect(body.data).toHaveLength(1);
    expect(body.data[0]?.verified).toBe(true);
    // 이게 이 엔드포인트의 전부다 — 채택 전에는 은행에 아무것도 쌓이지 않는다.
    expect(
      await prismaTestDouble.problem.count({
        where: { userId: USER_TEACHER_ID },
      }),
    ).toBe(before);
  });

  it("검사에 떨어진 후보도 사유와 함께 돌려준다 (걸러 보내지 않는다)", async () => {
    const origin = MOCK_PROBLEMS[0]!;
    mockTransformProblem.mockResolvedValueOnce([
      passing("통과한 변형"),
      {
        content: "떨어진 변형",
        answer: "9.99",
        solution: null,
        verified: false,
        originalAnswerRecomputed: "전혀 다른 값",
      },
    ]);

    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: origin.id,
        count: 2,
      }),
    );

    const body = problemTransformResponseSchema.parse(await res.json());
    // 걸러 보내면 화면은 「2개 요청했는데 1개만 왔다」만 알고 **이유를 못 본다**.
    expect(body.data).toHaveLength(2);
    expect(body.data[1]?.verified).toBe(false);
    expect(body.data[1]?.originalAnswerRecomputed).toBe("전혀 다른 값");
  });

  it("변형 방식·난이도 조정을 그대로 변형기에 넘긴다", async () => {
    const origin = MOCK_PROBLEMS[0]!;
    mockTransformProblem.mockResolvedValueOnce([passing()]);

    await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: origin.id,
        count: 1,
        mode: "conditions",
        difficultyShift: "up",
      }),
    );

    expect(mockTransformProblem).toHaveBeenCalledWith(
      expect.objectContaining({ mode: "conditions", difficultyShift: "up" }),
    );
  });

  it("없는 originProblemId는 NOT_FOUND(404)를 반환한다", async () => {
    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: NOT_FOUND_ID,
      }),
    );
    expect(res.status).toBe(404);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "NOT_FOUND",
    );
  });

  it("타 사용자 원본은 FORBIDDEN(403)을 반환한다", async () => {
    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: MOCK_PROBLEM_OTHER_USER.id,
      }),
    );
    expect(res.status).toBe(403);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "FORBIDDEN",
    );
  });

  it("변형 실패 응답에 내부 오류 메시지를 노출하지 않는다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockTransformProblem.mockRejectedValueOnce(
      new AiGenerationError("upstream request id secret-123"),
    );

    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: MOCK_PROBLEMS[0]!.id,
        count: 1,
      }),
    );

    expect(res.status).toBe(502);
    const body = errorResponseSchema.parse(await res.json());
    expect(JSON.stringify(body)).not.toContain("secret-123");
    log.mockRestore();
  });

  it("설정 누락(AiConfigError)은 503과 **무엇이 없는지** 알려 주는 사유를 돌려준다", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    mockTransformProblem.mockRejectedValueOnce(
      new AiConfigError("DEEPSEEK_API_KEY가 설정되어 있지 않습니다."),
    );

    const res = await transformRoute(
      jsonRequest("http://localhost/api/problems/transform", {
        originProblemId: MOCK_PROBLEMS[0]!.id,
        count: 1,
      }),
    );

    // AiConfigError 는 AiGenerationError 의 하위 타입이라, 라우트의 검사 순서가 뒤집히면
    // 여기서 502/일반 문구가 나온다 — 2026-08-19 에 실제로 원인을 가렸던 자리다.
    expect(res.status).toBe(503);
    const body = errorResponseSchema.parse(await res.json());
    expect(body.error.message).toContain("DEEPSEEK_API_KEY");
    log.mockRestore();
  });
});

describe("POST /api/problems/transform/adopt — 채택분만 넣는다", () => {
  it("201과 함께 transformed/pending 으로 저장하고, 분류는 원본에서 물려받는다", async () => {
    const origin = MOCK_PROBLEMS[0]!;

    const res = await adoptRoute(
      jsonRequest("http://localhost/api/problems/transform/adopt", {
        originProblemId: origin.id,
        items: [{ content: "채택된 변형", answer: "2", solution: null }],
      }),
    );

    expect(res.status).toBe(201);
    const body = problemTransformAdoptResponseSchema.parse(await res.json());
    const saved = body.data[0]!;
    expect(saved.source).toBe("transformed");
    expect(saved.originProblemId).toBe(origin.id);
    expect(saved.reviewStatus).toBe("pending");
    expect(saved.unitId).toBe(origin.unitId);
    expect(saved.problemType).toBe(origin.problemType);
    expect(saved.difficulty).toBe(origin.difficulty);
  });

  it("난이도 조정을 서버가 원본에 적용해 저장한다 (클라이언트 값을 믿지 않는다)", async () => {
    const origin = MOCK_PROBLEMS[0]!;

    const res = await adoptRoute(
      jsonRequest("http://localhost/api/problems/transform/adopt", {
        originProblemId: origin.id,
        difficultyShift: "up",
        items: [{ content: "한 단계 올린 변형", answer: "3", solution: null }],
      }),
    );

    const body = problemTransformAdoptResponseSchema.parse(await res.json());
    expect(body.data[0]!.difficulty).toBe(
      shiftDifficulty(origin.difficulty, "up"),
    );
  });

  it("클라이언트가 source/originProblemId 를 보내도 계약이 거부한다 (D-51 판별자 보호)", async () => {
    const origin = MOCK_PROBLEMS[0]!;

    const res = await adoptRoute(
      jsonRequest("http://localhost/api/problems/transform/adopt", {
        originProblemId: origin.id,
        items: [
          {
            content: "위조 시도",
            answer: "2",
            solution: null,
            source: "manual",
          },
        ],
      }),
    );

    // strictObject — 모르는 키가 오면 400. originProblemId 가 NULL 인지 아닌지가
    // RPM 교재본과 AI 변형본을 가르는 유일한 값이라(D-51) 클라이언트가 정할 수 없다.
    expect(res.status).toBe(400);
    expect(errorResponseSchema.parse(await res.json()).error.code).toBe(
      "VALIDATION_ERROR",
    );
  });

  it("타 사용자 원본으로는 채택할 수 없다 (403)", async () => {
    const res = await adoptRoute(
      jsonRequest("http://localhost/api/problems/transform/adopt", {
        originProblemId: MOCK_PROBLEM_OTHER_USER.id,
        items: [{ content: "남의 원본", answer: "2", solution: null }],
      }),
    );
    expect(res.status).toBe(403);
  });

  it("빈 채택 목록은 400 이다", async () => {
    const res = await adoptRoute(
      jsonRequest("http://localhost/api/problems/transform/adopt", {
        originProblemId: MOCK_PROBLEMS[0]!.id,
        items: [],
      }),
    );
    expect(res.status).toBe(400);
  });

  it("DB 오류 시 일부만 남기지 않는다", async () => {
    const origin = MOCK_PROBLEMS[0]!;
    const before = await prismaTestDouble.problem.count({
      where: { userId: USER_TEACHER_ID },
    });

    const createManySpy = vi
      .spyOn(prismaTestDouble.problem, "createManyAndReturn")
      .mockRejectedValueOnce(new Error("묶음 저장 실패"));

    try {
      await expect(
        adoptRoute(
          jsonRequest("http://localhost/api/problems/transform/adopt", {
            originProblemId: origin.id,
            items: [
              { content: "첫 번째", answer: "2", solution: null },
              { content: "두 번째", answer: "3", solution: null },
            ],
          }),
        ),
      ).rejects.toThrow("묶음 저장 실패");

      expect(createManySpy).toHaveBeenCalledTimes(1);
      expect(createManySpy.mock.calls[0]![0]!.data).toHaveLength(2);
      expect(
        await prismaTestDouble.problem.count({
          where: { userId: USER_TEACHER_ID },
        }),
      ).toBe(before);
    } finally {
      createManySpy.mockRestore();
    }
  });
});
