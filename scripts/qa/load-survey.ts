/**
 * 트랙 F · F-1 — **편 단위 결손 재현**. 원장 §1.1 · §1.3 표를 다시 만든다.
 *
 * 새로 세는 게 아니라 **재현**이다. 어긋나면 숫자를 고치지 말고 왜 다른지 본다
 * (`docs/planning/tracks/track-f-newload.md` §5).
 *
 *   npx tsx scripts/qa/load-survey.ts
 *
 * 읽기 전용이다 — DB 에는 `unit` 과 `problem.examId` 만 SELECT 한다. 쓰지 않는다.
 *
 * 원본은 **다시 뽑지 않는다**. 트랙 D 가 3,302편 전량을 추출해 둔 것을 그대로 쓴다
 * (재추출 약 10.5시간). 경로는 `TRACK_D_REPORTS` 로 바꿀 수 있다.
 *
 * 화면에는 집계만 찍고 상세는 `scripts/qa/reports/load-survey.json` 으로 나간다
 * (원장 §4 토큰 절약).
 */
import { readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { mapUnitHint } from "../../src/lib/import/mapUnit";
import type { UnitLike } from "../../src/lib/import/types";
import { isDirectScript } from "../import/isDirectScript";

/** 트랙 D 산출물. 이 저장소 밖이라 경로를 상수로 박아 두고 없으면 바로 멈춘다. */
const TRACK_D =
  process.env.TRACK_D_REPORTS ??
  "C:/Users/user/orca/workspaces/testautocreator/잔여-D-HWP/scripts/qa/reports";
/** `buildHwpContent` 는 트랙 D 소유 파일이다. 베끼지 않고 그쪽 원본을 그대로 부른다 —
 *  실체 판정이 갈라지면 재현이 재현이 아니게 된다. */
const TRACK_D_RULES = path.join(TRACK_D, "../hwpJudgeRules.ts");

const OUT = "scripts/qa/reports/load-survey.json";

/**
 * 실체 있는 문항으로 볼 최소 길이. 이보다 짧으면 추출 인공물(미주 순번 등)로 본다.
 *
 * ⚠️ **재는 대상은 `stem` 원문 하나뿐이다.** 트랙 D `audit-missing-questions.ts` 는
 * 같은 40자를 `buildHwpContent`(지문+보기)에 재는데, 그러면 원장 §1.1 표가 4~9% 크게
 * 나온다(적재됨 25,111 vs 23,118). 원장 표를 만든 쪽은 지문만 쟀다 — 2026-08-16 재현으로
 * 세 버킷이 한 건도 안 틀리고 맞았다. 표를 다시 맞추려면 이 정의를 바꾸지 말 것.
 */
const MIN_REAL = 40;

/** 원장 정의 — 지문 원문 길이. 워터마크도 안 턴다(턴 값과는 6건 차이). */
function isReal(q: HwpQuestion): boolean {
  return (q.stem ?? "").trim().length >= MIN_REAL;
}

/** 2023 이전 기출 제외 규칙 (브리프 §6-4). */
const YEAR_FLOOR = 2023;

export interface Pair {
  examId: number | string;
  pdf: string | null;
  hwp: string | null;
  school: string | null;
  level: string | null;
  grade: number | null;
  subject: string | null;
  year: number | null;
  semester: number | null;
  round: string | null;
}

export interface HwpQuestion {
  number: number;
  answer: string | null;
  solution: string | null;
  topic: string | null;
  difficulty: string | null;
  score: number | null;
  label: string | null;
  type: string | null;
  stem: string | null;
  choices: string[] | null;
}

/**
 * 시험지 메타 → 우리 교육과정 트리의 `Unit.grade` 라벨.
 * `scripts/qa/final_meta.py` 의 `unit_grade` 를 그대로 옮긴 것이다 — 파이썬 추출기와
 * 같은 규칙이어야 편수가 맞는다. 규칙을 바꾸지 말 것(브리프 §6-1).
 */
export const HIGH_SUBJECT: Record<string, string> = {
  수상: "공통수학1",
  공수1: "공통수학1",
  고등수학상: "공통수학1",
  상1: "공통수학1",
  수하: "공통수학2",
  공수2: "공통수학2",
  수1: "대수",
  "심화 수1": "대수",
  수2: "미적분1",
  문과수2: "미적분1",
  미적분: "미적분2",
  미적분1: "미적분2",
  확통: "확률과 통계",
  기하: "기하",
  기벡: "기하",
};

export function unitGrade(
  level: string | null,
  grade: number | null,
  subject: string | null,
): string | null {
  const s = (subject ?? "").trim();
  if (level === "중") {
    const m = /^중([123])/.exec(s);
    if (m) return `중${m[1]}`;
    return grade === 1 || grade === 2 || grade === 3 ? `중${grade}` : null;
  }
  return HIGH_SUBJECT[s] ?? null;
}

/** 완료본 정답은 `"정답 ②"` · `"[정답] 3"` 꼴이다. 접두어를 뗀다(final_meta.clean_answer). */
const ANSWER_PREFIX = /^\s*[[(]?\s*정\s*답\s*[\])]?\s*[:：.]?\s*/;
export function cleanAnswer(raw: string | null | undefined): string {
  return String(raw ?? "")
    .replace(ANSWER_PREFIX, "")
    .trim();
}

type Bucket = "적재됨" | "미적재·PDF있음" | "미적재·PDF없음" | "미적재·2022년";

interface BucketStat {
  편: number;
  실체: number;
  소단원있음: number;
  매핑성공: number;
  매핑성공_정답있음: number;
  전체문항: number;
  빈껍데기: number;
  /** 트랙 D 정의(지문+보기 40자)로 셌을 때의 실체. 정의 차이를 눈에 보이게 남긴다. */
  실체_트랙D정의: number;
  학년미해석편: number;
}

function emptyStat(): BucketStat {
  return {
    편: 0,
    실체: 0,
    소단원있음: 0,
    매핑성공: 0,
    매핑성공_정답있음: 0,
    전체문항: 0,
    빈껍데기: 0,
    실체_트랙D정의: 0,
    학년미해석편: 0,
  };
}

export async function runLoadSurvey(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });

    // 이미 DB 에 들어온 편. `externalId` 가 아니라 `examId` 로 본다 — 편 단위 질문이다.
    const rows = await prisma.problem.findMany({
      where: { source: "past_exam", examId: { not: null } },
      select: { examId: true },
      distinct: ["examId"],
    });
    const inDb = new Set(rows.map((r) => String(r.examId)));

    const { buildHwpContent } = (await import(
      pathToFileURL(TRACK_D_RULES).href
    )) as { buildHwpContent: (q: HwpQuestion) => string };

    const pairsRaw = JSON.parse(
      await readFile(path.join(TRACK_D, "final-pairs.json"), "utf8"),
    ) as { policy: string; pairs: Pair[] };
    const pairs = pairsRaw.pairs;

    const latexDir = path.join(TRACK_D, "hwp-latex");
    const extracted = new Set(
      (await readdir(latexDir))
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, "")),
    );

    const stats = new Map<Bucket, BucketStat>();
    const noExtract: string[] = [];
    /** 학년 힌트가 안 잡히는 조합. 브리프 §5 가 세라고 한 것. */
    const gradeMiss = new Map<string, { 편: number; 실체: number }>();
    /** final-pairs 메타 ↔ hwp-latex 메타 불일치. 조용히 넘기면 안 된다. */
    const metaMismatch: Array<{ examId: string; field: string }> = [];
    const perExam: Array<{
      examId: string;
      bucket: Bucket;
      year: number | null;
      실체: number;
      소단원: number;
      매핑: number;
      정답: number;
    }> = [];

    for (const pair of pairs) {
      const examId = String(pair.examId);
      if (!extracted.has(examId)) {
        noExtract.push(examId);
        continue;
      }

      const bucket: Bucket = inDb.has(examId)
        ? "적재됨"
        : (pair.year ?? 0) < YEAR_FLOOR
          ? "미적재·2022년"
          : pair.pdf
            ? "미적재·PDF있음"
            : "미적재·PDF없음";

      const stat = stats.get(bucket) ?? emptyStat();
      stats.set(bucket, stat);
      stat.편 += 1;

      const paper = JSON.parse(
        await readFile(path.join(latexDir, `${examId}.json`), "utf8"),
      ) as { questions?: HwpQuestion[]; meta?: Record<string, unknown> };

      for (const field of ["level", "grade", "subject", "year"] as const) {
        const mine = pair[field];
        const theirs = paper.meta?.[field];
        if (theirs !== undefined && String(mine) !== String(theirs)) {
          metaMismatch.push({ examId, field });
        }
      }

      const gradeHint = unitGrade(pair.level, pair.grade, pair.subject);
      if (!gradeHint) {
        stat.학년미해석편 += 1;
        const key = `${pair.level ?? "null"}${pair.grade ?? ""}/${pair.subject ?? "null"}`;
        const seen = gradeMiss.get(key) ?? { 편: 0, 실체: 0 };
        seen.편 += 1;
        gradeMiss.set(key, seen);
      }

      let real = 0;
      let hasTopic = 0;
      let mapped = 0;
      let mappedWithAnswer = 0;

      for (const q of paper.questions ?? []) {
        stat.전체문항 += 1;
        if (buildHwpContent(q).trim().length >= MIN_REAL) {
          stat.실체_트랙D정의 += 1;
        }
        if (!isReal(q)) {
          stat.빈껍데기 += 1;
          continue;
        }
        real += 1;
        const topic = (q.topic ?? "").trim();
        if (!topic) continue;
        hasTopic += 1;
        const result = mapUnitHint(topic, units, gradeHint ?? undefined);
        if (result.status !== "mapped") continue;
        mapped += 1;
        if (cleanAnswer(q.answer)) mappedWithAnswer += 1;
      }

      if (!gradeHint) {
        const key = `${pair.level ?? "null"}${pair.grade ?? ""}/${pair.subject ?? "null"}`;
        gradeMiss.get(key)!.실체 += real;
      }

      stat.실체 += real;
      stat.소단원있음 += hasTopic;
      stat.매핑성공 += mapped;
      stat.매핑성공_정답있음 += mappedWithAnswer;
      perExam.push({
        examId,
        bucket,
        year: pair.year,
        실체: real,
        소단원: hasTopic,
        매핑: mapped,
        정답: mappedWithAnswer,
      });
    }

    const order: Bucket[] = [
      "적재됨",
      "미적재·PDF있음",
      "미적재·PDF없음",
      "미적재·2022년",
    ];
    const table = order.map((b) => ({ 구분: b, ...(stats.get(b) ?? emptyStat()) }));

    await writeFile(
      OUT,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          트랙D경로: TRACK_D,
          완료본편: pairs.length,
          추출없는편: noExtract,
          표: table,
          학년미해석조합: [...gradeMiss.entries()]
            .map(([k, v]) => ({ 조합: k, ...v }))
            .sort((a, b) => b.편 - a.편),
          메타불일치: metaMismatch.slice(0, 200),
          메타불일치_총: metaMismatch.length,
          perExam,
        },
        null,
        1,
      ),
      "utf8",
    );

    console.log("── F-1 편 단위 결손 재현 ──");
    console.log(
      `완료본 ${pairs.length}편 · 추출물 없는 편 ${noExtract.length} · 대상 ${pairs.length - noExtract.length}`,
    );
    console.log(
      "구분".padEnd(16) +
        "편".padStart(6) +
        "실체".padStart(8) +
        "소단원".padStart(8) +
        "매핑".padStart(8) +
        "정답".padStart(8) +
        "소단원%".padStart(9),
    );
    for (const row of table) {
      const pct = row.실체 ? ((row.소단원있음 * 100) / row.실체).toFixed(1) : "—";
      console.log(
        row.구분.padEnd(14) +
          String(row.편).padStart(6) +
          String(row.실체).padStart(8) +
          String(row.소단원있음).padStart(8) +
          String(row.매핑성공).padStart(8) +
          String(row.매핑성공_정답있음).padStart(8) +
          pct.padStart(9),
      );
    }

    const load = table.filter((r) => r.구분.startsWith("미적재·PDF"));
    const sum = (key: keyof BucketStat) =>
      load.reduce((acc, r) => acc + (r[key] as number), 0);
    console.log(
      `\n적재 대상(2023+) — 편 ${sum("편")} · 실체 ${sum("실체")}` +
        ` · 소단원 ${sum("소단원있음")} · 매핑 ${sum("매핑성공")}` +
        ` · 그중 정답 ${sum("매핑성공_정답있음")}`,
    );

    console.log("\n학년 힌트 미해석 조합:");
    for (const [key, value] of [...gradeMiss.entries()].sort(
      (a, b) => b[1].편 - a[1].편,
    )) {
      console.log(`  ${key.padEnd(14)} 편 ${value.편} · 실체 ${value.실체}`);
    }
    if (metaMismatch.length > 0) {
      console.log(`\n⚠️ final-pairs ↔ hwp-latex 메타 불일치 ${metaMismatch.length}건`);
    }
    console.log(`\n상세 → ${OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runLoadSurvey().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
