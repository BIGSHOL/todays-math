// 배선 감사기 자체를 잠근다.
//
// 「새 기출이 Exam 없이 들어오는 경로가 없다」는 이 감사기가 **호출 지점을 다 보고 있을 때만**
// 참이다. 2026-08-19 에 실제로 샜다 — prettier 가 `.problem` 과 `.create(` 사이를 줄바꿈으로
// 접자 감사기가 그 지점을 못 보고 10 → 9 로 줄었다. 오류도 안 나고 표에서 한 줄이 사라졌다.
import { describe, expect, it } from "vitest";

import {
  auditCodePaths,
  classifyFile,
} from "../../../scripts/qa/audit-exam-wiring";

describe("classifyFile — 호출 지점 발견", () => {
  it("⭐ 포매터가 `.problem` 과 `.create(` 사이를 접어도 찾는다", () => {
    const src = [
      "async function seed() {",
      "  // exam-wiring: 테스트 — 픽스처다",
      "  await (prisma as never)",
      "    .problem",
      "    .create({ data: {} });",
      "}",
    ].join("\n");
    const sites = classifyFile("x.ts", src);
    expect(sites).toHaveLength(1);
    expect(sites[0]?.verdict).toBe("테스트");
  });

  it("한 줄짜리 호출도 그대로 찾는다", () => {
    const src = [
      "// exam-wiring: 기출아님 — AI 생성물만 넣는다",
      "await db.problem.createManyAndReturn({ data: [] });",
    ].join("\n");
    expect(classifyFile("x.ts", src)).toHaveLength(1);
  });

  it("표시가 없으면 판단불가 — 조용히 통과시키지 않는다", () => {
    const sites = classifyFile(
      "x.ts",
      "await db.problem.create({ data: {} });",
    );
    expect(sites[0]?.verdict).toBe("판단불가");
  });

  it("⭐ 「배선됨」이라 적어 놓고 syncExamMetadata 를 안 부르면 거짓말로 잡는다", () => {
    const src = [
      "// exam-wiring: 기출·배선됨 — 부른다고 적어만 뒀다",
      "await tx.problem.createMany({ data: [] });",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.verdict).toBe("기출·배선없음");
  });

  it("부르면 「배선됨」으로 인정한다", () => {
    const src = [
      "import { syncExamMetadata } from './syncExamMetadata';",
      "// exam-wiring: 기출·배선됨 — 적재 직후 세운다",
      "await tx.problem.createMany({ data: [] });",
      "await syncExamMetadata(tx, ids);",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.verdict).toBe("기출·배선됨");
  });

  it("줄 번호를 호출이 시작한 줄로 낸다", () => {
    const src = [
      "a",
      "b",
      "// exam-wiring: 테스트 — x",
      "db.problem.create({});",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.line).toBe(4);
  });
});

describe("auditCodePaths — 저장소 전수", () => {
  it("⭐ 기출을 넣는 경로 중 배선 없는 곳이 하나도 없다", () => {
    const sites = auditCodePaths();
    const bad = sites.filter(
      (s) => s.verdict === "기출·배선없음" || s.verdict === "판단불가",
    );
    expect(bad.map((s) => `${s.file}:${s.line} ${s.verdict}`)).toEqual([]);
  });

  it("호출 지점을 하나도 못 찾으면 그건 감사기가 눈이 먼 것이다", () => {
    expect(auditCodePaths().length).toBeGreaterThanOrEqual(9);
  });
});
