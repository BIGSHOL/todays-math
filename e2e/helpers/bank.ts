import type { APIRequestContext } from "@playwright/test";

const TYPES = ["계산", "개념", "활용", "서술형"] as const;
const DIFFICULTIES = ["easy", "mid", "hard"] as const;

export async function seedApprovedProblemsViaApi(
  request: APIRequestContext,
  unitId: string,
  counts: { easy: number; mid: number; hard: number } = {
    easy: 5,
    mid: 6,
    hard: 3,
  },
) {
  let n = 0;
  for (const difficulty of DIFFICULTIES) {
    for (let i = 0; i < counts[difficulty]; i += 1) {
      n += 1;
      const created = await request.post("/api/problems", {
        data: {
          unitId,
          source: "manual",
          difficulty,
          problemType: TYPES[n % TYPES.length],
          content: `${difficulty} 신규 ${n}: $x+${n}$ 의 값을 구하시오.`,
          answer: String(n),
          solution: `풀이 ${n}`,
        },
      });
      if (!created.ok()) {
        throw new Error(
          `문제 등록 실패 (${created.status()}): ${await created.text()}`,
        );
      }
      const body = (await created.json()) as { data: { id: string } };
      const approved = await request.patch(
        `/api/problems/${body.data.id}/review-status`,
        { data: { reviewStatus: "approved" } },
      );
      if (!approved.ok()) {
        throw new Error(
          `문제 승인 실패 (${approved.status()}): ${await approved.text()}`,
        );
      }
    }
  }
}

export async function approvePendingProblems(request: APIRequestContext) {
  const res = await request.get(
    "/api/problems?reviewStatus=pending&page=1&pageSize=100",
  );
  if (!res.ok()) {
    throw new Error(`pending 조회 실패 (${res.status()}): ${await res.text()}`);
  }
  const body = (await res.json()) as { data: Array<{ id: string }> };
  for (const problem of body.data) {
    const approved = await request.patch(
      `/api/problems/${problem.id}/review-status`,
      { data: { reviewStatus: "approved" } },
    );
    if (!approved.ok()) {
      throw new Error(
        `문제 승인 실패 (${approved.status()}): ${await approved.text()}`,
      );
    }
  }
}

export async function currentClassAndUnit(request: APIRequestContext) {
  const classesRes = await request.get("/api/classes?page=1&pageSize=100");
  if (!classesRes.ok()) {
    throw new Error(
      `반 목록 실패 (${classesRes.status()}): ${await classesRes.text()}`,
    );
  }
  const classesBody = (await classesRes.json()) as {
    data: Array<{ id: string; name: string }>;
  };
  const cls = classesBody.data[0];
  if (!cls) throw new Error("가입 후 반이 없습니다.");

  const progressRes = await request.get(`/api/progress?classId=${cls.id}`);
  if (!progressRes.ok()) {
    throw new Error(
      `진도 조회 실패 (${progressRes.status()}): ${await progressRes.text()}`,
    );
  }
  const progressBody = (await progressRes.json()) as {
    data: { unitId: string };
  };
  return {
    classId: cls.id,
    className: cls.name,
    unitId: progressBody.data.unitId,
  };
}
