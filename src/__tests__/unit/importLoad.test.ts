import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import {
  loadClassifiedAtomically,
  selectMissingLoadRows,
} from "../../../scripts/import/load-classified";
import type { ImportLoadRow } from "@/lib/import/toLoadRows";
import type { ImportDraft } from "@/lib/import/types";

const USER_ID = "10000000-0000-4000-8000-000000000001";
const UNIT_ID = "20000000-0000-4000-8000-000000000001";

function loadRow(content: string): ImportLoadRow {
  return {
    userId: USER_ID,
    unitId: UNIT_ID,
    source: "manual",
    difficulty: "easy",
    problemType: "계산",
    content,
    answer: "1",
    solution: null,
    reviewStatus: "approved",
    directUseAllowed: true,
    pool: "shared",
    externalId: null,
    sourceFile: null,
    school: null,
    subject: null,
    examId: null,
    questionNumber: null,
    score: null,
  };
}

function existingRow(row: ImportLoadRow): Omit<ImportLoadRow, "userId"> {
  return {
    unitId: row.unitId,
    source: row.source,
    difficulty: row.difficulty,
    problemType: row.problemType,
    content: row.content,
    answer: row.answer,
    solution: row.solution,
    reviewStatus: row.reviewStatus,
    directUseAllowed: row.directUseAllowed,
    externalId: row.externalId,
    sourceFile: row.sourceFile,
    school: row.school,
    subject: row.subject,
    examId: row.examId,
    questionNumber: row.questionNumber,
    score: row.score,
    pool: row.pool,
  };
}

function classifiedDraft(index: number): ImportDraft & { unitId: string } {
  return {
    externalId: `draft-${index}`,
    unitId: UNIT_ID,
    unitHint: "유리수와 소수",
    source: "manual",
    difficulty: "easy",
    problemType: "계산",
    content: `본문 ${index}`,
    answer: "1",
    solution: null,
    hasFigure: false,
    directUseAllowed: true,
  };
}

describe("[T3.0] classified 적재 복구", () => {
  it("부분 적재된 다중집합에서 이미 있는 발생분만 빼고 누락분을 반환한다", () => {
    const duplicate = loadRow("중복 본문");
    const missing = loadRow("누락 본문");
    const desired = [duplicate, duplicate, missing];

    expect(selectMissingLoadRows(desired, [existingRow(duplicate)])).toEqual([
      duplicate,
      missing,
    ]);
  });

  it("두 번째 배치가 실패하면 첫 번째 배치도 커밋하지 않는다", async () => {
    let committed: Array<Omit<ImportLoadRow, "userId">> = [];
    let createManyCalls = 0;

    const prisma = {
      async $transaction(callback: (tx: unknown) => Promise<unknown>) {
        const staged = [...committed];
        const tx = {
          $queryRaw: vi.fn(async () => []),
          user: {
            upsert: vi.fn(async () => ({ id: USER_ID })),
          },
          unit: {
            findMany: vi.fn(async () => []),
          },
          problem: {
            findMany: vi.fn(async () => staged),
            createMany: vi.fn(async ({ data }: { data: ImportLoadRow[] }) => {
              createManyCalls += 1;
              for (const row of data) {
                staged.push(existingRow(row));
              }
              if (createManyCalls === 2) {
                throw new Error("두 번째 배치 실패");
              }
              return { count: data.length };
            }),
          },
        };

        const result = await callback(tx);
        committed = staged;
        return result;
      },
    } as unknown as PrismaClient;

    await expect(
      loadClassifiedAtomically(
        prisma,
        Array.from({ length: 201 }, (_, index) => classifiedDraft(index)),
      ),
    ).rejects.toThrow("두 번째 배치 실패");

    expect(createManyCalls).toBe(2);
    expect(committed).toEqual([]);
  });
});
