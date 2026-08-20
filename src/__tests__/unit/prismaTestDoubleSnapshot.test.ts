/**
 * 가짜 Prisma 의 **트랜잭션 되돌리기가 모든 표를 덮는가.**
 *
 * 🔴 왜 있나: `problem_report` 를 더블에 넣으면서 `snapshotRows()` 에 **적는 걸 잊었다**
 *    (2026-08-20). 그러면 실패한 트랜잭션이 남긴 신고 행이 그대로 살아 있는데
 *    **오류가 안 난다** — 「원자성을 지킨다」를 보는 테스트가 조용히 거짓이 된다.
 *    같은 자리에 `predictionRunRows`·`actualExamScoreRows` 도 빠져 있었다.
 *
 * 두 가지로 본다. 하나만으로는 못 막는다:
 *  ⑴ **구조** — 선언된 `*Rows` 가 전부 스냅샷·복원에 적혀 있나(새 표를 잊으면 여기서 걸린다).
 *  ⑵ **행동** — 실제로 트랜잭션을 실패시켜 행이 사라지는가(적어만 두고 안 쓰면 여기서 걸린다).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { problemId } from "@/mocks/data";
import {
  prismaTestDouble,
  resetPrismaTestDouble,
} from "@/mocks/prismaTestDouble";

const SOURCE = readFileSync(
  path.join(process.cwd(), "src", "mocks", "prismaTestDouble.ts"),
  "utf-8",
);

function declaredArrays(): string[] {
  return [...SOURCE.matchAll(/^let ([A-Za-z]+Rows):/gm)].map((m) => m[1]);
}

function listedIn(fnName: string): string[] {
  const start = SOURCE.indexOf(`function ${fnName}(`);
  expect(start, `${fnName} 를 못 찾았다`).toBeGreaterThan(-1);
  const end = SOURCE.indexOf("\n}", start);
  const body = SOURCE.slice(start, end);
  return [...new Set([...body.matchAll(/([A-Za-z]+Rows)/g)].map((m) => m[1]))];
}

describe("가짜 Prisma — 트랜잭션 되돌리기가 모든 표를 덮는가", () => {
  it("🔴 선언된 행 배열이 전부 snapshotRows 에 있다", () => {
    const declared = declaredArrays();
    expect(declared.length).toBeGreaterThan(10); // 분모를 못 박는다
    const listed = new Set(listedIn("snapshotRows"));
    const missing = declared.filter((n) => !listed.has(n));
    expect(missing, `스냅샷에 빠진 표: ${missing.join(", ")}`).toEqual([]);
  });

  it("🔴 선언된 행 배열이 전부 restoreRows 에 있다", () => {
    const declared = declaredArrays();
    const listed = new Set(listedIn("restoreRows"));
    const missing = declared.filter((n) => !listed.has(n));
    expect(missing, `복원에 빠진 표: ${missing.join(", ")}`).toEqual([]);
  });
});

describe("가짜 Prisma — 실패한 트랜잭션은 아무것도 안 남긴다", () => {
  beforeEach(() => {
    resetPrismaTestDouble();
  });

  it("🔴 신고·검수 기록이 되돌아간다", async () => {
    const id = problemId(1);
    await expect(
      prismaTestDouble.$transaction(async (tx) => {
        await tx.problemReport.create({
          data: { problemId: id, reporterId: null, reason: "figure" },
        });
        await tx.problemReviewLog.create({
          data: { problemId: id, reviewerId: null, verdict: "pass" },
        });
        throw new Error("일부러 실패");
      }),
    ).rejects.toThrow("일부러 실패");

    expect(await prismaTestDouble.problemReport.count({})).toBe(0);
    expect(await prismaTestDouble.problemReviewLog.count({})).toBe(0);
  });
});
