import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { problemFingerprint } from "@/lib/import/problemFingerprint";
import type { ImportDraft } from "@/lib/import/types";
import {
  TESTCHANGER_CONTRACT_VERSION,
  TestchangerEngineRequestSchema,
} from "@/lib/testchanger/contracts";
import { buildMathCorpusInventory } from "@/lib/testchanger/mathCorpusInventory";
import { buildMathRenderQa } from "@/lib/testchanger/mathRenderQa";

const temporaryDirectories: string[] = [];

afterEach(async () => {
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) => rm(directory, { recursive: true, force: true })),
  );
});

describe("시험지변환기 포팅 계약", () => {
  it("fingerprint는 DB UUID와 무관하고 의미 필드 변화에는 민감하다", () => {
    const draft = {
      externalId: "sample-1",
      source: "past_exam",
      directUseAllowed: true,
      difficulty: "mid",
      problemType: "계산",
      content: "$x+1$",
      answer: "2",
      solution: null,
      unitHint: "다항식",
      hasFigure: false,
      unitId: "unit-a",
    } satisfies ImportDraft & { unitId: string };
    const equivalent = { ...draft, externalId: "other", unitId: "unit-b" };
    const changed = { ...draft, answer: "3" };
    expect(problemFingerprint(draft)).toBe(problemFingerprint(equivalent));
    expect(problemFingerprint(changed)).not.toBe(problemFingerprint(draft));
  });

  it("figure 계약은 기본값을 채우고 알 수 없는 필드를 거부한다", () => {
    const parsed = TestchangerEngineRequestSchema.parse({
      contractVersion: TESTCHANGER_CONTRACT_VERSION,
      operation: "figure.render",
      width: 320,
      height: 240,
      elements: [{ kind: "line", start: [0, 0], end: [10, 10] }],
    });
    expect(parsed).toMatchObject({
      operation: "figure.render",
      elements: [{ kind: "line", width: 2 }],
    });
    expect(() =>
      TestchangerEngineRequestSchema.parse({
        contractVersion: TESTCHANGER_CONTRACT_VERSION,
        operation: "health",
        unexpected: true,
      }),
    ).toThrow();
  });

  it("Windows 경로의 \\[는 제외하고 실제 명령/Unicode만 전수 렌더한다", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "todays-math-qa-"));
    temporaryDirectories.push(directory);
    await writeFile(
      path.join(directory, "sample.json"),
      JSON.stringify({
        sourcePath: "N:\\개인\\[장성고]\\시험.pdf",
        equation: "$\\frac{1}{2} \\leq x$",
        loose: "A^{\\bigstar}=B",
        unicode: "x≤2",
      }),
      "utf8",
    );
    const inventory = await buildMathCorpusInventory(directory);
    expect(inventory.latexCommands.map(({ token }) => token)).toEqual([
      "\\bigstar",
      "\\frac",
      "\\leq",
    ]);
    expect(inventory.unicodeSymbols.map(({ token }) => token)).toContain("≤");
    const qa = buildMathRenderQa(inventory);
    expect(qa.missingLatexCommands).toEqual([]);
    expect(qa.missingUnicodeSymbols).toEqual([]);
  });
});
