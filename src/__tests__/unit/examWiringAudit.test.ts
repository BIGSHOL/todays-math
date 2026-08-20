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

  it("⭐ 「되돌리기」라 적어 놓고 exam_question 링크를 안 되돌리면 거짓말로 잡는다", () => {
    // 그 컬럼에는 FK 가 없다 — 끊겨도 오류가 안 난다. 그래서 표시만 믿으면 안 된다.
    const src = [
      "// exam-wiring: 되돌리기 — 되돌린다고 적어만 뒀다",
      "await prisma.problem.create({ data: {} });",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.verdict).toBe("되돌리기·링크없음");
  });

  it("링크를 실제로 되돌리면 「되돌리기」로 인정한다", () => {
    const src = [
      "// exam-wiring: 되돌리기 — 원장 그대로 되살린다",
      "await prisma.problem.create({ data: {} });",
      "await prisma.examQuestion.updateMany({ where: {}, data: {} });",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.verdict).toBe("되돌리기");
  });

  it("「되돌리기」는 syncExamMetadata 를 요구하지 않는다 — 편을 다시 지으면 안 된다", () => {
    const src = [
      "// exam-wiring: 되돌리기 — 편은 지운 적이 없다",
      "await prisma.problem.create({ data: {} });",
      "await prisma.examQuestion.update({ where: {}, data: {} });",
    ].join("\n");
    expect(classifyFile("x.ts", src)[0]?.verdict).not.toBe("기출·배선없음");
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
      (s) =>
        s.verdict === "기출·배선없음" ||
        s.verdict === "되돌리기·링크없음" ||
        s.verdict === "판단불가",
    );
    expect(bad.map((s) => `${s.file}:${s.line} ${s.verdict}`)).toEqual([]);
  });

  it("호출 지점을 하나도 못 찾으면 그건 감사기가 눈이 먼 것이다", () => {
    expect(auditCodePaths().length).toBeGreaterThanOrEqual(9);
  });
});

/**
 * 🔴 → 🟢 줄끝이 판정을 바꾸면 안 된다 (2026-08-19).
 *
 * `classifyFile` 이 줄 시작 오프셋을 **`split` 한 줄들의 길이로** 더하고 있었다.
 * `split(/\r?\n/)` 은 `\r` 까지 지우므로 **CRLF 파일에서는 줄마다 1바이트씩 밀린다.**
 * 270줄쯤 내려가면 8줄이 어긋나 `MARKER_LOOKBACK`(8) 밖으로 나가고,
 * **표시를 제대로 붙여 둔 호출이 「판단불가」로 뒤집혔다.**
 *
 * Windows 체크아웃은 CRLF 라 이 결함은 늘 켜져 있었고, 워크트리마다 줄끝이 달라
 * **「어떤 워크트리에서는 초록, 어떤 데서는 빨강」**이 됐다 — 가장 나쁜 종류의 결함이다.
 */
describe("classifyFile — 줄끝이 판정을 바꾸지 않는다", () => {
  /** 표시가 `MARKER_LOOKBACK` 안에 있는 호출 하나를, 앞에 긴 머리를 붙여 만든다. */
  const build = (eol: string): string =>
    [
      ...Array.from({ length: 300 }, (_, i) => `// 머리 ${i}`),
      "// exam-wiring: 기출아님 — 자작만 넣는다",
      "await db.problem.create({ data: {} });",
    ].join(eol);

  it("LF 와 CRLF 가 같은 판정을 낸다", () => {
    const lf = classifyFile("a.ts", build("\n"));
    const crlf = classifyFile("a.ts", build("\r\n"));
    expect(lf).toHaveLength(1);
    expect(crlf).toHaveLength(1);
    expect(crlf[0]!.verdict).toBe("기출아님");
    expect(crlf[0]!.verdict).toBe(lf[0]!.verdict);
  });

  it("CRLF 에서도 줄 번호가 맞는다 — 밀리면 표시를 못 찾는다", () => {
    const crlf = classifyFile("a.ts", build("\r\n"));
    // 머리 300줄 + 표시 1줄 = 302번째 줄이 호출이다.
    expect(crlf[0]!.line).toBe(302);
  });
});
