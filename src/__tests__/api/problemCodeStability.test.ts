/**
 * 🔴 RED → 🟢 GREEN — D-53 문항 코드는 **저장이지 파생이 아니다**.
 *
 * 브리프가 콕 집어 요구한 가드다:
 *
 * > 문항의 `unitId` 를 바꿔도 코드가 안 바뀌는 테스트. 그게 없으면 나중에 누가
 * > 「코드를 단원과 맞춰 주는」 선의의 수리를 넣는다.
 *
 * 왜 이게 실제 위험인가 — 이 은행은 조용한 데이터가 아니다. 소단원 재배정이
 * **149건**, 학년 오배정 정정이 **125건** 실제로 있었고 RPM 1,425건이 대기 중이다
 * (id-find-review ④-1). 코드를 `unitId` 에서 매번 계산하면 원장님이 종이나 대화에
 * 적어 둔 코드가 **소리 없이 다른 문항을 가리킨다.**
 *
 * 여기서는 **앱 경계**(직렬화·수정 라우트)가 코드를 다시 만들지 않는지를 본다.
 * DB 쪽(UPDATE 를 트리거가 막는가)은 `scripts/qa/verify-problem-code-wiring.ts` 가
 * 실제 Postgres 에서 확인한다 — 이 테스트는 DB 에 붙지 않는다.
 *
 * 대응 계약: src/contracts/problemCode.contract.ts
 */
import { NextRequest } from "next/server";
import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/session", () => ({
  getSessionUser: vi.fn(async () => ({
    id: "10000000-0000-4000-8000-000000000001",
    email: "teacher@todaysmath.test",
    name: "테스트 강사",
  })),
}));

import { GET as getProblem } from "@/app/api/problems/[id]/route";
import { PATCH as patchProblem } from "@/app/api/problems/[id]/route";
import { POST as createProblem } from "@/app/api/problems/route";
import { problemResponseSchema } from "@/contracts/problem.contract";
import {
  GRADE_CODE_SEGMENT,
  problemCodeSchema,
} from "@/contracts/problemCode.contract";
import {
  MOCK_PROBLEM_WITH_FRACTION,
  MOCK_PROBLEMS,
  MOCK_UNITS,
} from "@/mocks/data";

function jsonRequest(url: string, method: string, body?: unknown) {
  return new NextRequest(url, {
    method,
    headers:
      body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function withId(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("[D-53] 문항 코드는 저장이지 파생이 아니다", () => {
  it("단원을 다른 대단원으로 옮겨도 코드가 그대로다", async () => {
    const problem = MOCK_PROBLEM_WITH_FRACTION;
    const before = await getProblem(
      jsonRequest(`http://localhost/api/problems/${problem.id}`, "GET"),
      withId(problem.id),
    );
    const beforeBody = problemResponseSchema.parse(await before.json());
    const codeBefore = beforeBody.data.problemCode;

    // 「1. 수와 식」(unit 0) 에서 「2. 부등식」(unit 8) 로 — 대단원이 바뀐다.
    const fromUnit = MOCK_UNITS.find((u) => u.id === problem.unitId)!;
    const toUnit = MOCK_UNITS.find((u) => u.chapter !== fromUnit.chapter)!;
    expect(toUnit.problemCodePrefix).not.toBe(fromUnit.problemCodePrefix);

    const res = await patchProblem(
      jsonRequest(`http://localhost/api/problems/${problem.id}`, "PATCH", {
        unitId: toUnit.id,
      }),
      withId(problem.id),
    );
    expect(res.status).toBe(200);
    const body = problemResponseSchema.parse(await res.json());

    expect(body.data.unitId).toBe(toUnit.id);
    // ⚠️ 여기가 핵심 — 단원은 옮겨졌는데 코드는 **그대로**여야 한다.
    expect(body.data.problemCode).toBe(codeBefore);
    // 그리고 코드의 뜻 부분은 이제 «현재 단원»과 다르다. 그게 정상이다
    // (스냅샷이니까). 그래서 D-53 은 화면이 현재 단원을 같이 보이라고 정했다.
    expect(body.data.problemCode.startsWith(toUnit.problemCodePrefix)).toBe(
      false,
    );
  });

  it("옮긴 뒤 다시 조회해도 같은 코드가 나온다 (읽을 때 다시 만들지 않는다)", async () => {
    const problem = MOCK_PROBLEMS[1]!;
    const target = MOCK_UNITS.find((u) => u.id !== problem.unitId)!;

    const patched = await patchProblem(
      jsonRequest(`http://localhost/api/problems/${problem.id}`, "PATCH", {
        unitId: target.id,
      }),
      withId(problem.id),
    );
    const patchedBody = problemResponseSchema.parse(await patched.json());

    const again = await getProblem(
      jsonRequest(`http://localhost/api/problems/${problem.id}`, "GET"),
      withId(problem.id),
    );
    const againBody = problemResponseSchema.parse(await again.json());

    expect(againBody.data.problemCode).toBe(patchedBody.data.problemCode);
    expect(againBody.data.problemCode).toBe(problem.problemCode);
  });

  it("본문만 고쳐도 코드가 그대로다", async () => {
    const problem = MOCK_PROBLEMS[2]!;
    const res = await patchProblem(
      jsonRequest(`http://localhost/api/problems/${problem.id}`, "PATCH", {
        content: "본문을 고쳤다.",
      }),
      withId(problem.id),
    );
    const body = problemResponseSchema.parse(await res.json());
    expect(body.data.problemCode).toBe(problem.problemCode);
  });
});

describe("[D-53] 새 문항은 코드를 «받아서» 나온다 — 요청이 정하지 않는다", () => {
  it("등록 응답에 형식을 지키는 코드가 실린다", async () => {
    const unit = MOCK_UNITS[3]!;
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: unit.id,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "새 문항.",
        answer: "1",
      }),
    );
    expect(res.status).toBe(201);
    const body = problemResponseSchema.parse(await res.json());
    expect(problemCodeSchema.safeParse(body.data.problemCode).success).toBe(
      true,
    );
    expect(body.data.problemCode.startsWith(`${unit.problemCodePrefix}-`)).toBe(
      true,
    );
  });

  it("등록 요청은 코드를 실을 수 없다 (계약이 strictObject 로 막는다)", async () => {
    const unit = MOCK_UNITS[3]!;
    const res = await createProblem(
      jsonRequest("http://localhost/api/problems", "POST", {
        unitId: unit.id,
        source: "manual",
        difficulty: "easy",
        problemType: "계산",
        content: "코드를 직접 정하려는 요청.",
        answer: "1",
        problemCode: "J20101-K7M2",
      }),
    );
    expect(res.status).toBe(400);
  });

  it("두 문항이 같은 코드를 받지 않는다", async () => {
    const unit = MOCK_UNITS[4]!;
    const codes = new Set<string>();
    for (let i = 0; i < 5; i += 1) {
      const res = await createProblem(
        jsonRequest("http://localhost/api/problems", "POST", {
          unitId: unit.id,
          source: "manual",
          difficulty: "easy",
          problemType: "계산",
          content: `연속 등록 ${i}.`,
          answer: "1",
        }),
      );
      const body = problemResponseSchema.parse(await res.json());
      codes.add(body.data.problemCode);
    }
    expect(codes.size).toBe(5);
  });
});

describe("[D-53] 코드에는 학교가 안 담긴다", () => {
  it("코드가 담는 것은 학교급·학년/과목·대단원·소단원뿐이다", () => {
    // 지면에 찍혔을 때 «다른 학교 기출»임이 드러나면 안 된다(D-53).
    // 형식 자체가 학교·연도·원본 문항번호를 담을 자리를 주지 않는다.
    const code = MOCK_PROBLEM_WITH_FRACTION.problemCode;
    const segment = Object.values(GRADE_CODE_SEGMENT).find((s) =>
      code.startsWith(s),
    );
    expect(segment).toBeDefined();
    expect(code).toHaveLength(segment!.length + 4 + 1 + 4);
  });
});
