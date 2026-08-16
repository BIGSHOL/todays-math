/**
 * 트랙 F · F-3 — **적재 드라이런.** 넣을 행을 실제 적재 형태(`ImportLoadRow`)까지
 * 만들어 보고, 분포만 낸다. **DB 에 쓰지 않는다.**
 *
 *   npx tsx scripts/qa/load-dedupe-check.ts   # 먼저 — 제외 목록을 만든다
 *   npx tsx scripts/qa/load-dry-run.ts
 *
 * 산출물
 *   scripts/qa/reports/load-dry-run.json       분포 상세
 *   scripts/qa/reports/load-rows.json          적재할 행 전량 (F-4 가 그대로 읽는다)
 *   scripts/qa/reports/load-figure-handoff.json 그림 있는 편 목록 → **트랙 A 인계**
 *
 * 적재는 F-4 이고 **코디네이터 승인 후**에만 한다(브리프 §7). 이 스크립트에는
 * `--apply` 가 아예 없다 — 실수로 쓰는 경로를 만들지 않는다.
 */
import { readFile, writeFile } from "node:fs/promises";

import { toLoadRows } from "../../src/lib/import/toLoadRows";
import type { ImportDraft, UnitLike } from "../../src/lib/import/types";
import type { Difficulty } from "../../src/contracts/common.contract";
import type { ProblemType } from "../../src/contracts/problem.contract";
import { isDirectScript } from "../import/isDirectScript";
import {
  buildCandidates,
  corpusFingerprint,
  MISSING_ANSWER,
  type Candidate,
} from "./load-candidates";
import { EXCLUSIONS } from "./load-dedupe-check";

const OUT = "scripts/qa/reports/load-dry-run.json";
const ROWS = "scripts/qa/reports/load-rows.json";
const FIGURE_HANDOFF = "scripts/qa/reports/load-figure-handoff.json";
/**
 * 넣을 `externalId` 전량. **적재 전에 커밋한다** (2026-08-16 승인 조건 1).
 *
 * INSERT 는 백업이 아니라 **이 목록이 되돌리는 수단이다** — 목록이 없으면 무엇을
 * 지워야 할지 모른다. F-4 는 이 파일과 재생성한 행 집합이 정확히 같은지 먼저 확인하고,
 * 다르면 아무것도 넣지 않고 멈춘다.
 */
export const EXTERNAL_IDS = "scripts/qa/reports/load-external-ids.json";

/** 적재 계정. `loadClassifiedAtomically` 와 같은 값이어야 멱등 대조가 맞는다. */
const IMPORT_USER_EMAIL = "import@todays-math.local";

function tally<T>(items: T[], key: (item: T) => string | null): Record<string, number> {
  const out: Record<string, number> = {};
  for (const item of items) {
    const k = key(item);
    if (k === null) continue;
    out[k] = (out[k] ?? 0) + 1;
  }
  return out;
}

function topN(record: Record<string, number>, n: number): Array<[string, number]> {
  return Object.entries(record)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

export async function runDryRun(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const unitById = new Map(units.map((u) => [u.id, u]));

    const examRows = await prisma.problem.findMany({
      where: { source: "past_exam", examId: { not: null } },
      select: { examId: true },
      distinct: ["examId"],
    });
    const inDb = new Set(examRows.map((r) => String(r.examId)));

    const corpus = await corpusFingerprint();
    const built = await buildCandidates(units, inDb);

    // F-2 가 만든 편 단위 중복 목록. 없으면 멈춘다 — 대조 없이 적재 계획을 세우지 않는다.
    let excluded: Set<string>;
    try {
      const ex = JSON.parse(await readFile(EXCLUSIONS, "utf8")) as {
        중복편: Array<{ examId: string }>;
      };
      excluded = new Set(ex.중복편.map((d) => d.examId));
    } catch {
      throw new Error(
        `${EXCLUSIONS} 가 없습니다. 먼저 npx tsx scripts/qa/load-dedupe-check.ts 를 돌리세요.`,
      );
    }

    const kept = built.candidates.filter((c) => !excluded.has(c.examId));

    // 보기가 전부 그림이라 본문에 보기가 비어 있는 객관식 — 그림 없이는 못 푼다.
    //
    // 승인 조건 3(2026-08-16): **넣되 트랙 A 가 그림을 붙이기 전에는 출제되면 안 된다.**
    // `findEligibleProblems` 가 `reviewStatus='approved'` 만 보므로 `pending` 으로 넣는다 —
    // D-22 가 설계해 둔 경로 그대로다(사람이 검수해 승격). 나머지는 종전대로 approved.
    //
    // ⚠️ `reviewStatus` 는 등록부상 트랙 C 컬럼이지만, 여기는 **신규 행 INSERT** 라
    //    기존 행을 건드리지 않는다. C 의 UPDATE 와 충돌하지 않는다.
    const holdRows = kept.filter(
      (c) => c.questionType === "객관식" && /\n\d+\.\s*(?=\n|$)/.test(c.content),
    );
    const holdIds = new Set(holdRows.map((c) => c.externalId));

    // ── 실제 적재 형태까지 만들어 본다. 여기서 걸러지는 게 있으면 지금 알아야 한다. ──
    const drafts: Array<ImportDraft & { unitId: string }> = kept.map((c) => ({
      externalId: c.externalId,
      source: "past_exam",
      directUseAllowed: true,
      difficulty: c.difficulty as Difficulty,
      problemType: c.problemType as ProblemType,
      content: c.content,
      answer: c.answer,
      solution: c.solution,
      unitHint: c.unitHint,
      hasFigure: c.figureCount > 0,
      gradeHint: c.gradeHint ?? undefined,
      sourceFile: c.sourceFile,
      school: c.school,
      subject: c.subject,
      examId: c.examId,
      questionNumber: c.questionNumber,
      score: c.score,
      // 그림은 트랙 A 소유다. 비운 채로 넣고 examId 만 넘긴다(브리프 §6-2).
      figureUrls: [],
      figureSource: null,
      unitId: c.unitId,
    }));

    const user = await prisma.user.findUnique({
      where: { email: IMPORT_USER_EMAIL },
      select: { id: true },
    });
    const { rows, skipped } = toLoadRows(drafts, user?.id ?? "(적재계정없음)");

    // `questionType` 은 `toLoadRows` 가 아직 안 나르는 컬럼이라 따로 붙인다.
    // `reviewStatus` 도 여기서 정한다 — `toLoadRows` 는 전부 approved 로 박는다.
    const byExternalId = new Map(kept.map((c) => [c.externalId, c]));
    const finalRows = rows.map((row) => ({
      ...row,
      questionType: byExternalId.get(row.externalId ?? "")?.questionType ?? null,
      reviewStatus: holdIds.has(row.externalId ?? "")
        ? ("pending" as const)
        : ("approved" as const),
    }));

    // ── 분포 ────────────────────────────────────────────────────────────────
    const byExam = new Map<string, Candidate[]>();
    for (const c of kept) byExam.set(c.examId, [...(byExam.get(c.examId) ?? []), c]);

    const gradeDist = tally(kept, (c) => unitById.get(c.unitId)?.grade ?? "(단원없음)");
    const unitDist = tally(kept, (c) => {
      const u = unitById.get(c.unitId);
      return u ? `${u.grade} / ${u.chapter} / ${u.section}` : "(단원없음)";
    });
    const withAnswer = kept.filter((c) => c.answer !== MISSING_ANSWER).length;
    const figureRows = kept.filter((c) => c.figureCount > 0);
    const figureExams = [...new Set(figureRows.map((c) => c.examId))].sort();

    const report = {
      생성시각: new Date().toISOString(),
      적재계정: user ? "있음" : "없음(적재 시 생성됨)",
      입력corpus: corpus,
      후보: {
        완료본편: 2950,
        대상편: built.papers.length,
        후보행_결함제외후: built.candidates.length,
        편중복제외: built.candidates.length - kept.length,
        적재행: rows.length,
        행있는편: byExam.size,
      },
      단계별: {
        ...built.counted,
        편중복제외편: [...excluded],
      },
      toLoadRows_제외: skipped,
      정답: {
        보유: withAnswer,
        없음: kept.length - withAnswer,
        보유율: Number(((withAnswer * 100) / Math.max(1, kept.length)).toFixed(1)),
      },
      학년분포: gradeDist,
      단원수: Object.keys(unitDist).length,
      단원분포_상위20: topN(unitDist, 20),
      단원분포_하위: topN(unitDist, Object.keys(unitDist).length).slice(-10),
      출제형식: tally(kept, (c) => c.questionType ?? "(없음)"),
      문항유형: tally(kept, (c) => c.problemType),
      난이도: tally(kept, (c) => c.difficulty),
      연도: tally(kept, (c) => String(c.year ?? "?")),
      학기회차: tally(kept, (c) => `${c.semester ?? "?"}-${c.round ?? "?"}`),
      학교수: new Set(kept.map((c) => c.school)).size,
      학교분포_상위15: topN(tally(kept, (c) => c.school ?? "?"), 15),
      본문길이: {
        평균: Math.round(kept.reduce((a, c) => a + c.content.length, 0) / Math.max(1, kept.length)),
        최대: Math.max(0, ...kept.map((c) => c.content.length)),
        "60자미만": kept.filter((c) => c.content.length < 60).length,
        "10000자초과": kept.filter((c) => c.content.length > 10_000).length,
      },
      그림: {
        그림있는행: figureRows.length,
        그림장수합: figureRows.reduce((a, c) => a + c.figureCount, 0),
        그림있는편: figureExams.length,
        보기가전부그림_pending: holdRows.length,
        보기가전부그림_목록: holdRows.map((c) => c.externalId),
      },
      D37_비완료본원본: rows.filter((r) => !/[(（]\s*완\s*료\s*[)）]/.test(r.sourceFile ?? "")).length,
      멱등성: "externalId UNIQUE. 이미 있는 externalId 는 건너뛴다 — 두 번 돌려도 신규 0.",
    };

    await writeFile(OUT, JSON.stringify(report, null, 1), "utf8");
    await writeFile(ROWS, JSON.stringify(finalRows), "utf8");
    await writeFile(
      EXTERNAL_IDS,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          총: finalRows.length,
          // 이 목록이 어떤 입력에서 나왔는지 박아 둔다. 적재기가 대조해 다르면 멈춘다.
          입력corpus: corpus,
          되돌리기:
            "이 목록이 유일한 되돌리기 수단이다(승인 조건 1). " +
            "되돌리려면 problem 에서 external_id 가 이 목록에 있는 행을 지운다. " +
            "source='past_exam' 이고 이 트랙이 넣은 행만 해당한다.",
          출제보류_pending: holdRows.map((c) => c.externalId),
          출제보류_사유:
            "보기가 전부 그림이라 본문 보기가 비어 있다. 트랙 A 가 figureUrls 를 붙이고 " +
            "사람이 approved 로 승격하기 전에는 자동 출제에 안 잡힌다(D-22).",
          externalIds: finalRows.map((r) => r.externalId),
        },
        null,
        1,
      ),
      "utf8",
    );
    await writeFile(
      FIGURE_HANDOFF,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          받는곳: "트랙 A (figureUrls · figureSource 소유)",
          설명:
            "트랙 F 가 figureUrls 를 비운 채로 넣을 행이다. 트랙 D hwpx-figures.json(편→문항→장수) 기준. " +
            "본문 [그림] 자리표시로는 못 센다 — HWP 추출본에는 그 표기가 0건이다.",
          편수: figureExams.length,
          행수: figureRows.length,
          장수: figureRows.reduce((a, c) => a + c.figureCount, 0),
          /**
           * 승인 조건 3 — 이 행들은 `reviewStatus='pending'` 으로 들어간다.
           * 보기가 전부 그림이라 본문 보기가 비어 있어 **그림 없이는 못 푼다.**
           * 트랙 A 가 그림을 붙인 뒤 사람이 approved 로 승격해야 출제된다.
           * **여기부터 먼저 봐 달라.**
           */
          출제보류_우선: holdRows.map((c) => ({
            externalId: c.externalId,
            examId: c.examId,
            questionNumber: c.questionNumber,
            school: c.school,
            그림장수: c.figureCount,
            사유: "보기가 전부 그림 — 본문 보기가 비어 있다",
          })),
          // 편 → { 문항번호: 그림 장수 }. 행마다 풀어 쓰면 300KB 라 원장 §4-4 를 어긴다.
          편별: Object.fromEntries(
            figureExams.map((examId) => [
              examId,
              Object.fromEntries(
                figureRows
                  .filter((c) => c.examId === examId)
                  .map((c) => [c.questionNumber, c.figureCount]),
              ),
            ]),
          ),
          학교: Object.fromEntries(
            figureExams.map((examId) => [
              examId,
              figureRows.find((c) => c.examId === examId)?.school ?? null,
            ]),
          ),
        },
        null,
        1,
      ),
      "utf8",
    );

    console.log("── F-3 적재 드라이런 (쓰지 않음) ──");
    console.log(
      `입력 corpus ${corpus.fingerprint} (트랙 D ${corpus.files}편 ${Math.round(corpus.bytes / 1e6)}MB)`,
    );
    console.log(
      `대상 ${built.papers.length}편 → 후보 ${built.candidates.length}행` +
        ` → 편중복 -${built.candidates.length - kept.length}` +
        ` → toLoadRows 제외 -${skipped.length}` +
        ` → **적재 ${rows.length}행 / ${byExam.size}편**`,
    );
    console.log(
      `\n정답 보유 ${withAnswer} (${report.정답.보유율}%) · 없음 ${kept.length - withAnswer}` +
        "  ← 정답 없는 것도 그대로 넣는다(브리프 §6-3). 자동 출제에서만 빠진다.",
    );
    console.log(`\n학년 분포 (${Object.keys(gradeDist).length}개):`);
    for (const [g, n] of topN(gradeDist, 20)) {
      console.log(`  ${g.padEnd(10)} ${String(n).padStart(5)}`);
    }
    console.log(`\n소단원 ${Object.keys(unitDist).length}개에 걸침 (전체 ${units.length}개 중)`);
    console.log("  상위:");
    for (const [u, n] of topN(unitDist, 5)) console.log(`    ${String(n).padStart(4)}  ${u}`);
    console.log(`\n출제형식 ${JSON.stringify(report.출제형식)}`);
    console.log(`난이도   ${JSON.stringify(report.난이도)}`);
    console.log(`연도     ${JSON.stringify(report.연도)}`);
    console.log(`학기회차 ${JSON.stringify(report.학기회차)}`);
    console.log(`학교 ${report.학교수}곳`);
    console.log(
      `\n본문 평균 ${report.본문길이.평균}자 · 최대 ${report.본문길이.최대}` +
        ` · 10,000자 초과 ${report.본문길이["10000자초과"]} · 60자 미만 ${report.본문길이["60자미만"]}`,
    );
    console.log(
      `그림 있는 행 ${figureRows.length} / ${figureExams.length}편` +
        ` · 장수 합 ${figureRows.reduce((a, c) => a + c.figureCount, 0)} → ${FIGURE_HANDOFF} (트랙 A 인계)`,
    );
    if (holdRows.length > 0) {
      console.log(
        `  ⚠️ 보기가 전부 그림이라 본문 보기가 빈 객관식 ${holdRows.length}행` +
          " → reviewStatus=pending 으로 넣는다(승인 조건 3). 그림을 붙이고 승격해야 출제된다.",
      );
    }
    console.log(`D-37 위반(비완료본 원본) ${report.D37_비완료본원본}`);
    if (skipped.length > 0) {
      console.log(`\ntoLoadRows 제외 ${skipped.length}: ${JSON.stringify(skipped.slice(0, 5))}`);
    }
    console.log(`\n상세 → ${OUT}\n행 전량 → ${ROWS}`);
    console.log("\n여기서 멈춘다. 적재(F-4)는 코디네이터 승인 후.");
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runDryRun().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
