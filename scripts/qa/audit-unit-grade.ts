/**
 * 기출 문항의 **단원 학년 오배정**을 원본 메타로 찾아낸다. 읽기 전용.
 *
 * ## 왜 독립 검증이 필요한가
 *
 * 트랙 G 가 오배정 목록을 낸다. 그걸 그대로 믿고 `unitId` 를 옮기면 **G 가 틀렸을 때
 * 멀쩡한 행이 틀어진다.** 그래서 이 도구는 G 를 보지 않고 **원본 메타만으로** 같은 판정을
 * 다시 만든다. 두 판정이 겹치는 것만 고치면, 한쪽이 틀려도 사고가 나지 않는다.
 *
 * ## 쓰는 신호 — 서로 독립이어야 한다
 *
 * 1. **학교명** `Problem.school` → 학교급(중/고). `normalizeSchoolName` + `schoolLevelFromKey`
 *    (eywa 손검증 SSOT 이식본)를 그대로 쓴다.
 * 2. **원본 파일명** `Problem.sourceFile` 의 대괄호 `[학교][학년][과목?][학기-회차][출판사]`.
 *    학교명·학년·(고등은) 과목이 한 번에 들어 있다.
 * 3. **경로 폴더** `…\중3\`, `…\확통\` — 파일명과 별개로 한 번 더 적혀 있다.
 *
 * 1번은 학교 이름에서, 2·3번은 파일 위치에서 온다. **파일명이 통째로 잘못 붙은 경우가
 * 아니면 셋이 동시에 틀리기 어렵다.** 그래서 이 도구는 **둘 이상이 일치할 때만** 판정한다.
 *
 * ## 기대 학년
 *
 * - 중학교: 대괄호 학년 숫자 그대로 → `중1`·`중2`·`중3`
 * - 고등학교: **학년 숫자가 아니라 과목**이 단원 학년을 정한다(`[계성고][2][확통]` → 확률과 통계).
 *   `수1`→대수 · `수2`→미적분1 · `미적분`→미적분2 는 과거 명칭 대응이다(10-handoff §4.2 확정).
 *
 *   npx tsx scripts/qa/audit-unit-grade.ts
 *   npx tsx scripts/qa/audit-unit-grade.ts --json out.json
 */
import { PrismaClient } from "@prisma/client";

import { normalizeSchoolName } from "../../src/lib/schools/normalizeSchoolName";
import { schoolLevelFromKey } from "../../src/lib/schools/schoolLevel";
import { isDirectScript } from "../import/isDirectScript";
import { writeJson } from "../import/writeJson";

/** 시험지 과목 표기 → 우리 트리 학년 라벨. 10-handoff §4.2 에서 확정된 대응. */
export const HIGH_SUBJECT: Record<string, string> = {
  수상: "공통수학1",
  공수1: "공통수학1",
  공통수학1: "공통수학1",
  수하: "공통수학2",
  공수2: "공통수학2",
  공통수학2: "공통수학2",
  수1: "대수",
  대수: "대수",
  수2: "미적분1",
  미적분1: "미적분1",
  미적분: "미적분2",
  미적분2: "미적분2",
  확통: "확률과 통계",
  "확률과 통계": "확률과 통계",
  기하: "기하",
  기벡: "기하",
};

/** 우리 트리의 고등 학년 라벨 — 라벨만 보고 학교급을 되짚을 때 쓴다. */
const HIGH_LABELS = new Set(Object.values(HIGH_SUBJECT));

export function levelOfLabel(label: string): "초" | "중" | "고" | null {
  if (HIGH_LABELS.has(label)) return "고";
  if (/^중[1-3]$/.test(label)) return "중";
  if (/^초[1-6]$/.test(label)) return "초";
  return null;
}

export interface FileMeta {
  school: string | null;
  gradeNumber: number | null;
  subject: string | null;
}

/**
 * `[성광중][3][24-1-기말][천재] (완료).PDF` → `{school:"성광중", gradeNumber:3}`
 * `[계성고][2][확통][24-2-기말][천재]` → `{school:"계성고", gradeNumber:2, subject:"확통"}`
 * 대괄호가 없거나 모양이 다르면 **지어내지 않고 null** 을 돌려준다.
 */
export function parseFileName(sourceFile: string | null): FileMeta {
  const empty: FileMeta = { school: null, gradeNumber: null, subject: null };
  if (!sourceFile) return empty;
  const name = sourceFile.split(/[\\/]/).pop() ?? "";
  const brackets = [...name.matchAll(/\[([^\]]+)\]/g)].map((m) => m[1].trim());
  if (brackets.length < 2) return empty;
  const school = brackets[0] || null;
  const gradeNumber = /^[1-3]$/.test(brackets[1]) ? Number(brackets[1]) : null;
  // 세 번째 칸이 학기 표기(`24-1-중간`)면 과목이 아니다.
  const third = brackets[2] ?? "";
  const subject = third && !/^\d{2}-\d-/.test(third) ? third : null;
  return { school, gradeNumber, subject };
}

/** 경로 폴더에서 학년/과목을 한 번 더 읽는다 — 파일명과 독립된 신호다. */
export function parsePath(sourceFile: string | null): {
  grade: string | null;
  subject: string | null;
} {
  if (!sourceFile) return { grade: null, subject: null };
  const parts = sourceFile.split(/[\\/]/);
  let grade: string | null = null;
  let subject: string | null = null;
  for (const part of parts) {
    if (/^(중|고)[1-3]$/.test(part)) grade = part;
    else if (HIGH_SUBJECT[part]) subject = part;
  }
  return { grade, subject };
}

export interface Finding {
  problemId: string;
  externalId: string | null;
  school: string | null;
  sourceFile: string | null;
  currentGrade: string;
  expectedGrade: string;
  /** 판정을 뒷받침한 독립 신호 이름들. 둘 미만이면 애초에 제안하지 않는다. */
  signals: string[];
  kind: "level" | "grade";
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { source: "past_exam" },
      select: {
        id: true,
        externalId: true,
        school: true,
        sourceFile: true,
        examId: true,
        unit: { select: { grade: true } },
      },
    });

    const findings: Finding[] = [];
    let noSignal = 0;
    let agreed = 0;
    let conflicting = 0;

    for (const row of rows) {
      const file = parseFileName(row.sourceFile);
      const path = parsePath(row.sourceFile);
      const schoolKey = row.school ? normalizeSchoolName(row.school) : "";
      const levelFromSchool = schoolKey ? schoolLevelFromKey(schoolKey) : null;
      const levelFromFileSchool = file.school
        ? schoolLevelFromKey(normalizeSchoolName(file.school))
        : null;
      const levelFromPath = path.grade ? (path.grade[0] as "중" | "고") : null;

      // 기대 학년을 만든다 — 중등은 학년 숫자, 고등은 과목.
      const level = levelFromSchool ?? levelFromFileSchool ?? levelFromPath;
      let expected: string | null = null;
      if (level === "중") {
        const n = file.gradeNumber ?? (path.grade ? Number(path.grade[1]) : null);
        expected = n ? `중${n}` : null;
      } else if (level === "고") {
        const subject = file.subject ?? path.subject;
        expected = subject ? (HIGH_SUBJECT[subject] ?? null) : null;
      }
      if (!expected) {
        noSignal += 1;
        continue;
      }

      // 독립 신호를 센다. **둘 이상**이 같은 방향이라야 제안한다.
      const signals: string[] = [];
      if (levelFromSchool) signals.push(`학교명(${row.school}→${levelFromSchool})`);
      if (levelFromFileSchool && file.school !== row.school) {
        signals.push(`파일명 학교(${file.school})`);
      }
      if (file.gradeNumber !== null) signals.push(`파일명 학년([${file.gradeNumber}])`);
      if (file.subject) signals.push(`파일명 과목([${file.subject}])`);
      if (path.grade) signals.push(`경로 폴더(${path.grade})`);
      if (path.subject) signals.push(`경로 과목(${path.subject})`);

      // 신호끼리 어긋나면 고치지 않는다 — 어느 쪽이 맞는지 모른다.
      const levels = new Set(
        [levelFromSchool, levelFromFileSchool, levelFromPath].filter(Boolean),
      );
      if (levels.size > 1) {
        conflicting += 1;
        continue;
      }
      if (signals.length < 2) {
        noSignal += 1;
        continue;
      }
      agreed += 1;
      if (row.unit.grade === expected) continue;

      findings.push({
        problemId: row.id,
        externalId: row.externalId,
        school: row.school,
        sourceFile: row.sourceFile,
        currentGrade: row.unit.grade,
        expectedGrade: expected,
        signals,
        kind:
          levelOfLabel(row.unit.grade) !== levelOfLabel(expected) ? "level" : "grade",
      });
    }

    console.log("── 기출 단원 학년 오배정 감사 (원본 메타 독립 판정) ──");
    console.log(
      `past_exam ${rows.length}행 — 신호 2개 이상으로 판정 가능 ${agreed}` +
        ` · 신호 부족 ${noSignal} · 신호 충돌 ${conflicting}`,
    );
    const level = findings.filter((f) => f.kind === "level");
    const grade = findings.filter((f) => f.kind === "grade");
    console.log(
      `\n어긋남 ${findings.length}행 — **학교급이 다름 ${level.length}**` +
        ` · 같은 급 안에서 학년/과목이 다름 ${grade.length}`,
    );

    const papers = new Set(findings.map((f) => f.sourceFile));
    console.log(`걸린 시험지 ${papers.size}편`);

    const pairs = new Map<string, number>();
    for (const f of findings) {
      const key = `${f.currentGrade} → ${f.expectedGrade}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    console.log("\n[어긋남 상위]");
    for (const [key, count] of [...pairs.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 12)) {
      console.log(`  ${key} — ${count}행`);
    }

    console.log("\n[학교급이 다른 건의 표본 5]");
    for (const f of level.slice(0, 5)) {
      console.log(
        `  ${f.problemId.slice(0, 8)} ${f.school} · 지금 ${f.currentGrade} → ${f.expectedGrade}` +
          `\n    근거: ${f.signals.join(" · ")}`,
      );
    }

    const jsonPath = process.argv.includes("--json")
      ? (process.argv[process.argv.indexOf("--json") + 1] ??
        "scripts/qa/reports/unit-grade-audit.json")
      : null;
    if (jsonPath) {
      await writeJson(jsonPath, {
        note:
          "원본 메타(학교명·파일명·경로)만으로 판정한 단원 학년 오배정. 트랙 G 의 목록과 " +
          "대조해 **겹치는 것만** 고치기 위한 독립 판정이다.",
        checked: rows.length,
        decidable: agreed,
        findings,
      });
      console.log(`\n기록 — ${jsonPath}`);
    }
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
