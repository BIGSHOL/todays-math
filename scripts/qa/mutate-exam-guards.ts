/**
 * **가드를 하나씩 망가뜨려 빨개지는지 본다.**
 *
 *   npx tsx scripts/qa/mutate-exam-guards.ts
 *
 * 「가드는 망가뜨려 봐야 가드인 줄 안다」(CLAUDE.md 2026-08-18). 적대적 리뷰 ④ §H 에서
 * 상수 29개 중 **9개가 초록**이었다 — 그건 가드가 아니라 장식이었다는 뜻이다.
 *
 * 여기서는 규칙 한 줄씩 뒤집어 놓고 그 규칙을 지키기로 한 테스트를 돌린다.
 * **초록으로 남는 변이가 있으면 그 규칙은 아무도 안 지키고 있는 것이다.**
 *
 * ## 1차 결과 (2026-08-19) — 30개 중 5개가 살아남았고, 셋은 **지웠다**
 *
 * | 살아남은 변이 | 실측 | 처리 |
 * |---|---|---|
 * | 기간 토큰이 둘이어도 첫 것을 쓴다 | 실코퍼스에 그런 파일이 0건이라 픽스처가 없었다 | **픽스처 추가**(규칙은 맞다) |
 * | 폴더 투표에서 합의 항목까지 본다 | 두 변이가 실코퍼스에서 **2편** 갈렸다 | **엄격한 쪽 채택 + 픽스처** |
 * | 겹친 대괄호 `[[` 를 못 읽게 한다 | 홑괄호 정규식도 **같은 결과**(실측 3편 전부 동일) | 죽은 코드 — **삭제** |
 * | 자연키 길이 상한을 없앤다 | 스키마 상한(50+50)에서 키는 **114자** — 자를 일이 없다 | 죽은 코드 — **삭제** |
 * | 60문항 상한을 없앤다 | 계약이 이미 막고 사유 문구에 「60」도 있다 | 중복 — **삭제** |
 *
 * ⚠️ 원본을 반드시 되돌린다. 다중 세션 워크트리에서는 커밋하지 않은 수정이 남의 커밋에
 *    실려 나간다(CLAUDE.md 2026-08-18) — 그래서 `finally` 에서 무조건 복구하고,
 *    끝나고 **변이한 파일들이** 원본과 같은지 직접 확인한다.
 */
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";

import { isDirectScript } from "../import/isDirectScript";

const IDENTITY = "src/lib/import/examIdentity.ts";
const BUILD = "src/lib/import/buildExamPaper.ts";
const LOADER = "scripts/predictor/load-exams.ts";

const TESTS = [
  "src/__tests__/unit/examIdentity.test.ts",
  "src/__tests__/unit/buildExamPaper.test.ts",
  "src/__tests__/unit/syncExamMetadata.test.ts",
  "src/__tests__/unit/examLoad.test.ts",
];

interface Mutation {
  name: string;
  file: string;
  from: string;
  to: string;
}

const NL = "\n";

const MUTATIONS: Mutation[] = [
  // ── 파일명 파싱 ────────────────────────────────────────────────────────────
  {
    name: "기간 토큰이 둘이어도 그냥 첫 것을 쓴다",
    file: IDENTITY,
    from: "if (periodIndexes.length !== 1) return null;",
    to: "if (periodIndexes.length === 0) return null;",
  },
  {
    name: "두 자리 연도를 2000 년대로 올리지 않는다",
    file: IDENTITY,
    from: "return n < 100 ? 2000 + n : n;",
    to: "return n;",
  },
  {
    name: "과목/교과서를 기간 앞뒤 자리로 안 가르고 늘 과목으로 본다",
    file: IDENTITY,
    from:
      "    if (restBefore.length === 1) subjectRaw = rest[0]!;" +
      NL +
      "    else publisher = rest[0]!;",
    to: "    subjectRaw = rest[0]!;",
  },
  // ── 문서 제목 ─────────────────────────────────────────────────────────────
  {
    name: "제목줄이 두 자리 연도(=머리말)도 받게 한다",
    file: IDENTITY,
    from: "  /^(\\d{4})\\s*년\\s*([12])\\s*학기\\s*(중간|기말)\\s*고사\\s*(대비)?\\s*$/;",
    to: "  /(\\d{2,4})\\s*년\\s*([12])\\s*학기\\s*(중간|기말)\\s*고사\\s*(대비)?/;",
  },
  {
    name: "훼손 제목을 「제목 없음」과 같게 본다",
    file: IDENTITY,
    from: "        if (d) degraded = { degraded: true, year: Number(d[1]), line };",
    to: "        void d;",
  },
  // ── 폴더(제3의 표) ────────────────────────────────────────────────────────
  {
    name: "폴더에서 얕은 쪽이 이기게 한다",
    file: IDENTITY,
    from:
      "    const sem = FOLDER_SEMESTER.exec(seg);" +
      NL +
      "    if (sem) out.semester = Number(sem[1]) as 1 | 2;",
    to:
      "    const sem = FOLDER_SEMESTER.exec(seg);" +
      NL +
      "    if (sem && out.semester === null) out.semester = Number(sem[1]) as 1 | 2;",
  },
  {
    name: "폴더 투표에서 «다투는 항목»만 보게 한다 (합의 항목의 반박을 무시)",
    file: IDENTITY,
    from: "  const spoken = PERIOD_FIELDS.filter((f) => folder[f] !== null);",
    to: "  const spoken = PERIOD_FIELDS.filter((f) => folder[f] !== null && a[f] !== b[f]);",
  },
  {
    name: "폴더가 갈라 주지 못해도 문서 제목을 쓴다",
    file: IDENTITY,
    from:
      "      const vote = folderVote(fromHeader, fromFile, folder);" +
      NL +
      "      if (vote === null) {",
    to:
      '      const vote = folderVote(fromHeader, fromFile, folder) ?? "a";' +
      NL +
      "      if (vote === null) {",
  },
  {
    name: "폴더가 파일명 편이어도 문서 제목을 쓴다",
    file: IDENTITY,
    from: '      if (vote === "a") {',
    to: '      if (vote === "a" || vote === "b") {',
  },
  // ── 대비 ─────────────────────────────────────────────────────────────────
  {
    name: "대비 시험지를 제외하지 않는다",
    file: IDENTITY,
    from: "  if (prep) {" + NL + "    return {" + NL + '      status: "제외",',
    to:
      "  if (false as boolean) {" +
      NL +
      "    return {" +
      NL +
      '      status: "제외",',
  },
  {
    name: "시점이 진 제목의 「대비」도 믿는다",
    file: IDENTITY,
    from:
      "        if (header.prep) {" +
      NL +
      "          return {" +
      NL +
      '            status: "미분류",',
    to:
      "        if (false as boolean) {" +
      NL +
      "          return {" +
      NL +
      '            status: "미분류",',
  },
  {
    name: "문서를 못 봤는데 파일명 「대비」를 그냥 쓴다",
    file: IDENTITY,
    from:
      "    if (file.prepLabelled) {" +
      NL +
      "      return {" +
      NL +
      '        status: "미분류",' +
      NL +
      "        reason:" +
      NL +
      '          "파일명에 「대비」가 있는데 원본 문서 제목을 못 읽었다 — 시점을 확정할 수 없다",',
    to:
      "    if (false as boolean) {" +
      NL +
      "      return {" +
      NL +
      '        status: "미분류",' +
      NL +
      "        reason:" +
      NL +
      '          "파일명에 「대비」가 있는데 원본 문서 제목을 못 읽었다 — 시점을 확정할 수 없다",',
  },
  {
    name: "문서를 못 봤을 때 폴더와의 충돌을 무시한다",
    file: IDENTITY,
    from: "    if (clash.length > 0) {",
    to: "    if (clash.length > 99) {",
  },
  {
    name: "훼손 제목의 연도가 파일명과 달라도 그냥 쓴다",
    file: IDENTITY,
    from:
      "      degradedHeader.year !== null &&" +
      NL +
      "      degradedHeader.year !== file.year",
    to: "      degradedHeader.year !== null &&" + NL + "      false",
  },
  // ── 과목·학교급 ───────────────────────────────────────────────────────────
  {
    name: "단원이 없어도 과목을 파일명에서 가져온다",
    file: IDENTITY,
    from: "  if (entries.length === 0) return null;",
    to: '  if (entries.length === 0) return { subject: "중1", level: "중", ratio: 1 };',
  },
  {
    name: "학교명 접미사와 단원 라벨이 어긋나도 통과시킨다",
    file: IDENTITY,
    from: "  if (suffixLevel !== subject.level) {",
    to: "  if (false as boolean) {",
  },
  // ── 자연키 ────────────────────────────────────────────────────────────────
  {
    name: "자연키에서 학년을 뺀다 (861건을 만든 바로 그 실수)",
    file: IDENTITY,
    from: "    `${input.level}${input.grade}`,",
    to: "    `${input.level}`,",
  },
  {
    name: "자연키에서 회차를 뺀다",
    file: IDENTITY,
    from: "    `${input.year}-${input.semester}-${input.round}`,",
    to: "    `${input.year}-${input.semester}`,",
  },
  {
    name: "자연키에서 학교명을 뺀다",
    file: IDENTITY,
    from: "    input.school," + NL + "    `${input.level}${input.grade}`,",
    to: "    `${input.level}${input.grade}`,",
  },
  {
    name: "자연키에서 과목을 뺀다",
    file: IDENTITY,
    from: "    input.subject," + NL + "    `${input.year}",
    to: "    `${input.year}",
  },
  // ── 편 짓기 ───────────────────────────────────────────────────────────────
  {
    name: "번호가 겹쳐도 편을 짓는다",
    file: BUILD,
    from: "    if (numbers.has(s.number)) {",
    to: "    if (false as boolean) {",
  },
  {
    name: "계약 검증을 건너뛴다 (60문항 상한이 여기 걸려 있다)",
    file: BUILD,
    from:
      "  const parsed = examPaperSchema.safeParse(paper);" +
      NL +
      "  if (!parsed.success) {",
    to:
      "  const parsed = examPaperSchema.safeParse(paper);" +
      NL +
      "  if (false as boolean) {",
  },
  {
    name: "저장 못 하는 제어문자를 안 지운다",
    file: BUILD,
    from: '  const cleaned = raw.replace(UNSTORABLE, "").trim();',
    to: "  const cleaned = raw;",
  },
  {
    name: "정답 센티널을 그대로 싣는다",
    file: BUILD,
    from: "  if (!t || t === MISSING_ANSWER) return null;",
    to: "  if (!t) return null;",
  },
  {
    name: "총점을 100 으로 맞춘다",
    file: BUILD,
    from: "    totalScore: Number(questions.reduce((s, q) => s + q.score, 0).toFixed(4)),",
    to: "    totalScore: 100,",
  },
  {
    name: "유형이 없는 문항도 객관식으로 싣는다",
    file: BUILD,
    from:
      "    if (!qtype) {" +
      NL +
      "      dropped.noQtype += 1;" +
      NL +
      "      continue;" +
      NL +
      "    }",
    to:
      '    const qtype2 = qtype ?? "객관식";' +
      NL +
      "    if (!qtype2) {" +
      NL +
      "      dropped.noQtype += 1;" +
      NL +
      "      continue;" +
      NL +
      "    }",
  },
  {
    name: "배점을 못 정한 문항도 0점으로 싣는다",
    file: BUILD,
    from:
      "    if (filled.score === null) {" +
      NL +
      "      dropped.noScore += 1;" +
      NL +
      "      continue;" +
      NL +
      "    }",
    to:
      "    if (false as boolean) {" +
      NL +
      "      dropped.noScore += 1;" +
      NL +
      "      continue;" +
      NL +
      "    }",
  },
  {
    name: "자연키 충돌에서 같은 편(hwp/PDF 짝)까지 충돌로 본다",
    file: BUILD,
    from: "    set.add(r.examId);",
    to: "    set.add(`${r.examId}#${set.size}`);",
  },
  {
    name: "자연키 충돌을 아예 안 본다",
    file: BUILD,
    from: "    if (ids.size < 2) continue;",
    to: "    if (ids.size < 99) continue;",
  },
  {
    name: "난이도 표기를 모르면 「중」으로 지어낸다",
    file: BUILD,
    from: "  return DIFFICULTY[raw.trim()] ?? null;",
    to: '  return DIFFICULTY[raw.trim()] ?? "중";',
  },
  // ── 적재기 ────────────────────────────────────────────────────────────────
  {
    name: "problemId 를 다시 못박아 null 로 넣는다",
    file: LOADER,
    from: "    problemId: q.problemId,",
    to: "    problemId: null,",
  },
  {
    name: "unitId 를 다시 못박아 null 로 넣는다",
    file: LOADER,
    from: "    unitId: q.unitId,",
    to: "    unitId: null,",
  },
];

function runTests(): boolean {
  try {
    execFileSync("npx.cmd", ["vitest", "run", ...TESTS, "--silent"], {
      encoding: "utf-8",
      stdio: "pipe",
    });
    return true; // 초록
  } catch {
    return false; // 빨강
  }
}

export interface MutationResult {
  name: string;
  file: string;
  survived: boolean;
}

export async function runMutations(): Promise<MutationResult[]> {
  const originals = new Map<string, string>();
  for (const f of new Set(MUTATIONS.map((m) => m.file))) {
    originals.set(f, readFileSync(f, "utf-8"));
  }

  const results: MutationResult[] = [];
  try {
    for (const [i, m] of MUTATIONS.entries()) {
      const original = originals.get(m.file)!;
      // ⚠️ 이 저장소는 Windows 라 작업 트리가 CRLF 다. 변이 문자열의 줄바꿈을 파일에
      //    맞추지 않으면 여러 줄 변이가 **조용히 «대상 없음»** 이 된다.
      const eol = original.includes("\r\n") ? "\r\n" : NL;
      const from = m.from.split(NL).join(eol);
      const to = m.to.split(NL).join(eol);
      if (!original.includes(from)) {
        throw new Error(
          `변이 대상 문자열을 못 찾았다 — ${m.name}${NL}  파일 ${m.file}${NL}  찾은 것 ${JSON.stringify(from.slice(0, 90))}`,
        );
      }
      writeFileSync(m.file, original.replace(from, to), "utf-8");
      const green = runTests();
      writeFileSync(m.file, original, "utf-8");
      results.push({ name: m.name, file: m.file, survived: green });
      console.log(
        `  ${(i + 1).toString().padStart(2)}/${MUTATIONS.length} ` +
          `${green ? "🟩 살아남음(가드 아님)" : "🟥 빨개짐"}  ${m.name}`,
      );
    }
  } finally {
    // 무조건 되돌린다. 다중 세션에서 남은 수정은 남의 커밋에 실린다.
    for (const [f, s] of originals) writeFileSync(f, s, "utf-8");
    // 되돌렸는지 **내가 변이한 파일만** 대조한다(다른 세션의 수정과 섞지 않는다).
    for (const [f, s] of originals) {
      if (readFileSync(f, "utf-8") !== s) {
        throw new Error(`복구 실패 — ${f}`);
      }
    }
  }
  return results;
}

if (isDirectScript(import.meta.url)) {
  console.log(
    `[mutate] 변이 ${MUTATIONS.length}개 — 테스트 ${TESTS.length}파일`,
  );
  runMutations()
    .then((results) => {
      const survived = results.filter((r) => r.survived);
      console.log("");
      console.log(
        `  빨개진 변이 ${results.length - survived.length}/${results.length}` +
          ` · 살아남은 변이 ${survived.length}`,
      );
      for (const s of survived) console.log(`    🟩 ${s.name} (${s.file})`);
      console.log("  변이한 파일 전부 원본과 일치 확인 ✓");
      if (survived.length > 0) process.exitCode = 1;
    })
    .catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
}
