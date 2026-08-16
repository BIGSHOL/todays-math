/**
 * 기출 문항의 **단원 학년 오배정 정정**. 쓰는 컬럼은 `unitId` 하나다.
 *
 * ## 왜 필요한가
 *
 * 중2·중3 시험지 문항이 고등 공통수학2 단원에 붙어 있다. 그대로 두면 중3 진도로 출제할 때
 * 그 문항이 안 나오고, 고1 진도에서는 중학 문항이 튀어나온다. **조용히 틀리는 종류다** —
 * 원장님이 수업에서 발견하시게 된다.
 *
 * ## 무엇을 근거로 고치나 — **네 겹이 모두 맞을 때만**
 *
 * 1. `Problem.school` → 학교급 (`normalizeSchoolName` + `schoolLevelFromKey`, eywa SSOT)
 * 2. 원본 파일명 대괄호 `[학교][학년][과목?][학기-회차]`
 * 3. 원본 경로 폴더 (`…\중3\`, `…\확통\`)
 * 4. **추출 산출물의 `meta.grade`** — 위 셋과 다른 파이프라인(`final_meta.py`)이 판정한 값
 *
 * 1~3 중 **둘 이상**이 같은 방향이고(`audit-unit-grade.ts`), 거기에 4번까지 일치하는 행만
 * 손댄다. 하나라도 어긋나면 건너뛴다 — **어느 쪽이 맞는지 모르는 행은 고치지 않는다.**
 *
 * ## 어디로 옮기나 — 지어내지 않는다
 *
 * 옮길 소단원은 **원본이 적어 준 `topic` 을 올바른 학년 안에서 다시 매핑**해 정한다
 * (`mapUnitHint(topic, units, meta.grade)`). 원본에 `topic` 이 없거나 매핑이 실패하면
 * **그 행은 손대지 않는다.** 학년만 맞추자고 아무 소단원에나 넣지 않는다.
 *
 * 중단원급 힌트("일차함수와 그래프")가 소단원 하나로 좁혀지는 것은 2026-08-15 원장님
 * 확정 정책이다 — 오차가 **중단원 밖으로 나가지 않는다**(10-handoff §3).
 *
 * ## 안전
 *
 * 드라이런이 기본. `--apply` + `ALLOW_SHARED_IMPORT=1` 둘 다 있어야 쓰고, 게이트는
 * 네트워크 접근 **앞**에 있다. 적용 직전 `unitId` 원래 값을 파일로 남긴다.
 *
 *   npx tsx scripts/qa/fix-unit-grade.ts                       드라이런
 *   npx tsx scripts/qa/fix-unit-grade.ts --plan out.json       계획만 파일로
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/fix-unit-grade.ts --apply
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { mapUnitHint } from "../../src/lib/import/mapUnit";
import type { UnitLike } from "../../src/lib/import/types";
import { normalizeSchoolName } from "../../src/lib/schools/normalizeSchoolName";
import { schoolLevelFromKey } from "../../src/lib/schools/schoolLevel";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeJson } from "../import/writeJson";
import { HIGH_SUBJECT, parseFileName, parsePath } from "./audit-unit-grade";

const ARTIFACT_DIR = "scripts/qa/reports/index-batch";
const REVERT_PATH = "scripts/qa/unit-grade-revert.json";

interface Artifact {
  meta: { exam_id: number; grade: string };
  questions: Array<{ number: number; topic?: string }>;
}

export interface Move {
  problemId: string;
  externalId: string | null;
  school: string | null;
  fromGrade: string;
  fromSection: string;
  fromUnitId: string;
  toGrade: string;
  toSection: string;
  toUnitId: string;
  topic: string;
  signals: string[];
}

/** 왜 손대지 않았는지 — 숫자로 남겨야 다음 사람이 이어 판단한다. */
export interface Skips {
  noArtifact: number;
  metaDisagrees: number;
  noTopic: number;
  remapFailed: number;
  alreadyCorrect: number;
}

async function loadArtifacts(): Promise<Map<string, Artifact>> {
  const byExam = new Map<string, Artifact>();
  let files: string[];
  try {
    files = await readdir(ARTIFACT_DIR);
  } catch {
    return byExam;
  }
  for (const file of files) {
    if (!file.endsWith(".json")) continue;
    const data = JSON.parse(
      await readFile(path.join(ARTIFACT_DIR, file), "utf8"),
    ) as Artifact;
    byExam.set(String(data.meta.exam_id), data);
  }
  return byExam;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  if (apply) {
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const artifacts = await loadArtifacts();
  if (artifacts.size === 0) {
    console.log(
      `SKIP — 추출 산출물이 없습니다 (${ARTIFACT_DIR}).\n` +
        "재생성: PYTHONIOENCODING=utf-8 python scripts/qa/export-index-batch.py --limit 358\n" +
        "산출물 없이는 옮길 소단원을 정할 수 없습니다 — 학년만 보고 아무 데나 넣지 않습니다.",
    );
    process.exitCode = 2;
    return;
  }

  const prisma = new PrismaClient();
  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const rows = await prisma.problem.findMany({
      where: { source: "past_exam" },
      select: {
        id: true,
        externalId: true,
        school: true,
        sourceFile: true,
        examId: true,
        questionNumber: true,
        unitId: true,
        unit: { select: { grade: true, section: true } },
      },
    });

    const moves: Move[] = [];
    const skips: Skips = {
      noArtifact: 0,
      metaDisagrees: 0,
      noTopic: 0,
      remapFailed: 0,
      alreadyCorrect: 0,
    };
    let decidable = 0;

    for (const row of rows) {
      // ── 신호 1~3 (audit-unit-grade 와 같은 규칙) ──────────────────────────
      const file = parseFileName(row.sourceFile);
      const dir = parsePath(row.sourceFile);
      const levelFromSchool = row.school
        ? schoolLevelFromKey(normalizeSchoolName(row.school))
        : null;
      const levelFromFile = file.school
        ? schoolLevelFromKey(normalizeSchoolName(file.school))
        : null;
      const levelFromPath = dir.grade ? (dir.grade[0] as "중" | "고") : null;
      const levels = new Set(
        [levelFromSchool, levelFromFile, levelFromPath].filter(Boolean),
      );
      if (levels.size !== 1) continue;
      const level = [...levels][0];

      let expected: string | null = null;
      if (level === "중") {
        const n = file.gradeNumber ?? (dir.grade ? Number(dir.grade[1]) : null);
        expected = n ? `중${n}` : null;
      } else if (level === "고") {
        const subject = file.subject ?? dir.subject;
        expected = subject ? (HIGH_SUBJECT[subject] ?? null) : null;
      }
      if (!expected) continue;

      const signals: string[] = [];
      if (levelFromSchool) signals.push(`학교명(${row.school})`);
      if (file.gradeNumber !== null) signals.push(`파일명 학년([${file.gradeNumber}])`);
      if (file.subject) signals.push(`파일명 과목([${file.subject}])`);
      if (dir.grade) signals.push(`경로(${dir.grade})`);
      if (dir.subject) signals.push(`경로 과목(${dir.subject})`);
      if (signals.length < 2) continue;
      decidable += 1;

      if (row.unit.grade === expected) {
        skips.alreadyCorrect += 1;
        continue;
      }

      // ── 신호 4 — 추출 산출물이 같은 말을 하는가 ──────────────────────────
      const artifact = row.examId ? artifacts.get(row.examId) : undefined;
      if (!artifact) {
        skips.noArtifact += 1;
        continue;
      }
      if (artifact.meta.grade !== expected) {
        // 다른 파이프라인이 다른 말을 한다 — 어느 쪽이 맞는지 모르므로 손대지 않는다.
        skips.metaDisagrees += 1;
        continue;
      }

      // ── 어디로 — 원본 topic 을 올바른 학년 안에서 다시 매핑 ───────────────
      const topic =
        artifact.questions.find((q) => q.number === row.questionNumber)?.topic ?? "";
      if (!topic) {
        skips.noTopic += 1;
        continue;
      }
      const mapped = mapUnitHint(topic, units, expected);
      if (mapped.status !== "mapped") {
        skips.remapFailed += 1;
        continue;
      }
      if (mapped.unitId === row.unitId) {
        skips.alreadyCorrect += 1;
        continue;
      }
      const target = unitById.get(mapped.unitId);
      if (!target || target.grade !== expected) {
        // 매핑이 기대 학년 밖으로 나가면 쓰지 않는다.
        skips.remapFailed += 1;
        continue;
      }

      moves.push({
        problemId: row.id,
        externalId: row.externalId,
        school: row.school,
        fromGrade: row.unit.grade,
        fromSection: row.unit.section,
        fromUnitId: row.unitId,
        toGrade: target.grade,
        toSection: target.section,
        toUnitId: target.id,
        topic,
        signals,
      });
    }

    console.log("── 기출 단원 학년 오배정 정정 ──");
    console.log(
      `past_exam ${rows.length}행 · 신호로 판정 가능 ${decidable} · **옮길 대상 ${moves.length}**`,
    );
    console.log(
      `건너뜀 — 산출물 없음 ${skips.noArtifact} · 산출물이 다른 말 ${skips.metaDisagrees}` +
        ` · 원본 topic 없음 ${skips.noTopic} · 재매핑 실패 ${skips.remapFailed}`,
    );

    const pairs = new Map<string, number>();
    for (const move of moves) {
      const key = `${move.fromGrade}/${move.fromSection} → ${move.toGrade}/${move.toSection}`;
      pairs.set(key, (pairs.get(key) ?? 0) + 1);
    }
    console.log("\n[이동 내역]");
    for (const [key, count] of [...pairs.entries()].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${count}행  ${key}`);
    }
    const schools = new Set(moves.map((m) => m.school));
    console.log(`\n걸린 학교 ${schools.size}곳 — ${[...schools].slice(0, 12).join(" ")}`);

    const planIndex = process.argv.indexOf("--plan");
    if (planIndex >= 0) {
      const out = process.argv[planIndex + 1] ?? "scripts/qa/unit-grade-plan.json";
      await writeJson(out, {
        note:
          "기출 단원 학년 오배정 정정 계획. 학교명·파일명·경로 중 둘 이상 + 추출 산출물 " +
          "meta.grade 가 모두 일치하고, 원본 topic 으로 올바른 학년 안에서 재매핑이 " +
          "성공한 행만 담았다. 되돌릴 때는 fromUnitId 로 되돌리면 된다.",
        count: moves.length,
        moves,
      });
      console.log(`\n계획 기록 — ${out}`);
    }

    if (!apply) {
      console.log(`\n드라이런 — 변경 없음. 승인 후 --apply (대상 ${moves.length})`);
      return;
    }

    await writeJson(REVERT_PATH, {
      note:
        "단원 학년 정정으로 바꾼 unitId 의 **원래 값**. 되돌리려면 problemId 에 " +
        "fromUnitId 를 다시 넣으면 된다. unitId 외의 컬럼은 건드리지 않았다.",
      count: moves.length,
      rows: moves.map((move) => ({
        problemId: move.problemId,
        externalId: move.externalId,
        from: { unitId: move.fromUnitId, grade: move.fromGrade, section: move.fromSection },
        to: { unitId: move.toUnitId, grade: move.toGrade, section: move.toSection },
      })),
    });

    let updated = 0;
    for (const move of moves) {
      await prisma.problem.update({
        where: { id: move.problemId },
        data: { unitId: move.toUnitId },
      });
      updated += 1;
    }
    console.log(`\n정정 완료 — ${updated}행 · 되돌리기 목록 ${REVERT_PATH}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
