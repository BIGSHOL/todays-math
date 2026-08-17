/**
 * 트랙 F 2차 · **적재 드라이런.** 넣을 행을 실제 적재 형태(`ImportLoadRow`)까지
 * 만들어 보고, 분포만 낸다. **DB 에 쓰지 않는다.**
 *
 *   npx tsx scripts/qa/load2-dedupe-check.ts   # 먼저 — 제외 목록을 만든다
 *   npx tsx scripts/qa/load2-dry-run.ts
 *
 * 산출물
 *   scripts/qa/reports/load2-dry-run.json        분포 상세
 *   scripts/qa/reports/load2-rows.json           적재할 행 전량 (적재기가 그대로 읽는다)
 *   scripts/qa/reports/load2-external-ids.json   넣을 externalId + 입력 지문 (**적재 전 커밋**)
 *   scripts/qa/reports/load2-figure-handoff.json 그림 있는 편 목록 → **트랙 A 인계** (조건 4)
 *
 * 적재는 승인 후다. 이 스크립트에는 `--apply` 가 아예 없다 — 실수로 쓰는 경로를 안 만든다.
 */
import { readFile, writeFile } from "node:fs/promises";

import { toLoadRows } from "../../src/lib/import/toLoadRows";
import type { ImportDraft, UnitLike } from "../../src/lib/import/types";
import type { Difficulty } from "../../src/contracts/common.contract";
import type { ProblemType } from "../../src/contracts/problem.contract";
import { isDirectScript } from "../import/isDirectScript";
import { MISSING_ANSWER, corpusFingerprint } from "./load-candidates";
import { buildCandidates2, PREDICTIONS, type Candidate2 } from "./load2-candidates";
import { EXCLUSIONS2 } from "./load2-dedupe-check";

const OUT = "scripts/qa/reports/load2-dry-run.json";
const ROWS = "scripts/qa/reports/load2-rows.json";
const FIGURE_HANDOFF = "scripts/qa/reports/load2-figure-handoff.json";

/**
 * 넣을 `externalId` 전량. **적재 전에 커밋한다** (코디네이터 조건 1).
 * INSERT 는 백업이 아니라 **이 목록이 되돌리는 수단이다.**
 */
export const EXTERNAL_IDS2 = "scripts/qa/reports/load2-external-ids.json";

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

export async function runDryRun2(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const unitById = new Map(units.map((u) => [u.id, u]));

    // DB 에 이미 있는 externalId 전량 — 멱등 대조의 기준이다.
    const loadedIds = new Set<string>();
    for (let skip = 0; ; skip += 4_000) {
      const page = await prisma.problem.findMany({
        skip,
        take: 4_000,
        orderBy: { id: "asc" },
        select: { externalId: true },
      });
      if (page.length === 0) break;
      for (const r of page) if (r.externalId) loadedIds.add(r.externalId);
      if (page.length < 4_000) break;
    }

    const corpus = await corpusFingerprint();

    // 중복 대조가 만든 제외 목록. 없으면 멈춘다 — 대조 없이 적재 계획을 세우지 않는다.
    let excludeRows: Set<string>;
    let exclusionMeta: Record<string, unknown>;
    try {
      const ex = JSON.parse(await readFile(EXCLUSIONS2, "utf8")) as {
        제외행: string[];
        제외근거: Record<string, unknown>;
        보고만_빼지않음: Record<string, unknown>;
      };
      excludeRows = new Set(ex.제외행);
      exclusionMeta = { 제외근거: ex.제외근거, 보고만_빼지않음: ex.보고만_빼지않음 };
    } catch {
      throw new Error(
        `${EXCLUSIONS2} 가 없습니다. 먼저 npx tsx scripts/qa/load2-dedupe-check.ts 를 돌리세요.`,
      );
    }

    const built = await buildCandidates2(units, loadedIds);
    const kept = built.candidates.filter((c) => !excludeRows.has(c.externalId));

    // 보기가 전부 그림이라 본문에 보기가 비어 있는 객관식 — 그림 없이는 못 푼다.
    // 1차 승인 조건 3 과 같게 `pending` 으로 넣는다. `findEligibleProblems` 가
    // approved 만 보므로 트랙 A 가 그림을 붙이고 승격하기 전에는 출제되지 않는다(D-22).
    const holdRows = kept.filter(
      (c) => c.questionType === "객관식" && /\n\d+\.\s*(?=\n|$)/.test(c.content),
    );
    const holdIds = new Set(holdRows.map((c) => c.externalId));

    const drafts: Array<ImportDraft & { unitId: string }> = kept.map((c) => ({
      externalId: c.externalId,
      source: "past_exam",
      directUseAllowed: true,
      difficulty: c.difficulty as Difficulty,
      problemType: c.problemType as ProblemType,
      content: c.content,
      answer: c.answer,
      solution: c.solution,
      // 시험지가 소단원명을 안 적어 준 문항이라 힌트가 없다. 그래서 2차가 있는 것이다.
      unitHint: "",
      hasFigure: c.figureCount > 0,
      gradeHint: c.gradeHint ?? undefined,
      sourceFile: c.sourceFile,
      school: c.school,
      subject: c.subject,
      examId: c.examId,
      questionNumber: c.questionNumber,
      score: c.score,
      // 그림은 트랙 A 소유다. 비운 채로 넣고 목록만 넘긴다(조건 4).
      figureUrls: [],
      figureSource: null,
      unitId: c.unitId,
    }));

    const user = await prisma.user.findUnique({
      where: { email: IMPORT_USER_EMAIL },
      select: { id: true },
    });
    const { rows, skipped } = toLoadRows(drafts, user?.id ?? "(적재계정없음)");

    const byExternalId = new Map(kept.map((c) => [c.externalId, c]));
    const finalRows = rows.map((row) => ({
      ...row,
      questionType: byExternalId.get(row.externalId ?? "")?.questionType ?? null,
      reviewStatus: holdIds.has(row.externalId ?? "")
        ? ("pending" as const)
        : ("approved" as const),
    }));

    // ── 분포 ────────────────────────────────────────────────────────────────
    const byExam = new Map<string, Candidate2[]>();
    for (const c of kept) byExam.set(c.examId, [...(byExam.get(c.examId) ?? []), c]);

    const gradeDist = tally(kept, (c) => unitById.get(c.unitId)?.grade ?? "(단원없음)");
    const unitDist = tally(kept, (c) => {
      const u = unitById.get(c.unitId);
      return u ? `${u.grade} / ${u.chapter} / ${u.section}` : "(단원없음)";
    });
    const withAnswer = kept.filter((c) => c.answer !== MISSING_ANSWER).length;
    const figureRows = kept.filter((c) => c.figureCount > 0);
    const figureExams = [...new Set(figureRows.map((c) => c.examId))].sort();

    const conf = kept.map((c) => c.confidence).sort((a, b) => a - b);
    const pct = (p: number): number =>
      conf.length === 0 ? 0 : Number(conf[Math.floor((conf.length - 1) * p)].toFixed(4));

    // 이 적재로 0 에서 살아나는 단원 — 은행 구멍이 실제로 몇 개 메워지나.
    const eligibleBefore = await prisma.problem.groupBy({
      by: ["unitId"],
      where: {
        pool: "shared",
        reviewStatus: "approved",
        directUseAllowed: true,
        answer: { not: MISSING_ANSWER },
      },
      _count: { _all: true },
    });
    const beforeByUnit = new Map(eligibleBefore.map((r) => [r.unitId, r._count._all]));
    const newlyFilled = [...new Set(kept.map((c) => c.unitId))].filter(
      (u) => (beforeByUnit.get(u) ?? 0) === 0,
    );

    const report = {
      생성시각: new Date().toISOString(),
      입력: {
        판정파일: PREDICTIONS,
        판정행: built.판정행,
        입력corpus: corpus,
      },
      적재계정: user ? "있음" : "없음(적재 시 생성됨)",
      단계별: {
        판정: built.판정행,
        제외: built.제외,
        후보: built.candidates.length,
        중복제외: built.candidates.length - kept.length,
        toLoadRows_제외: skipped.length,
        적재행: rows.length,
        행있는편: byExam.size,
      },
      ...exclusionMeta,
      학년어긋남_넣지않음: {
        행: built.학년어긋남.length,
        상세: built.학년어긋남,
      },
      결함: built.결함,
      toLoadRows_제외상세: skipped,
      정답: {
        보유: withAnswer,
        없음: kept.length - withAnswer,
        보유율: Number(((withAnswer * 100) / Math.max(1, kept.length)).toFixed(1)),
      },
      G확신: {
        최소: conf[0] ?? 0,
        "25%": pct(0.25),
        중앙값: pct(0.5),
        "75%": pct(0.75),
        최대: conf[conf.length - 1] ?? 0,
      },
      학년분포: gradeDist,
      단원수: Object.keys(unitDist).length,
      "0에서살아나는단원": {
        수: newlyFilled.length,
        목록: newlyFilled.map((u) => {
          const x = unitById.get(u);
          return x ? `${x.grade} / ${x.chapter} / ${x.section}` : u;
        }),
      },
      단원분포_상위20: topN(unitDist, 20),
      출제형식: tally(kept, (c) => c.questionType ?? "(없음)"),
      문항유형: tally(kept, (c) => c.problemType),
      난이도: tally(kept, (c) => c.difficulty),
      연도: tally(kept, (c) => String(c.year ?? "?")),
      학기회차: tally(kept, (c) => `${c.semester ?? "?"}-${c.round ?? "?"}`),
      학교수: new Set(kept.map((c) => c.school)).size,
      학교분포_상위15: topN(tally(kept, (c) => c.school ?? "?"), 15),
      본문길이: {
        평균: Math.round(
          kept.reduce((a, c) => a + c.content.length, 0) / Math.max(1, kept.length),
        ),
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
      D37_비완료본원본: rows.filter(
        (r) => !/[(（]\s*완\s*료\s*[)）]/.test(r.sourceFile ?? ""),
      ).length,
      멱등성: "externalId UNIQUE. 이미 있는 externalId 는 건너뛴다 — 두 번 돌려도 신규 0.",
    };

    await writeFile(OUT, JSON.stringify(report, null, 1), "utf8");
    await writeFile(ROWS, JSON.stringify(finalRows), "utf8");
    await writeFile(
      EXTERNAL_IDS2,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          차수: "2차 (트랙 G 소단원 판정분 · A안)",
          총: finalRows.length,
          입력corpus: corpus,
          판정파일: PREDICTIONS,
          판정행: built.판정행,
          되돌리기:
            "이 목록이 유일한 되돌리기 수단이다(조건 1). " +
            "되돌리려면 problem 에서 external_id 가 이 목록에 있는 행을 지운다. " +
            "source='past_exam' 이고 2차가 넣은 행만 해당한다.",
          소단원출처:
            "트랙 G 판정(A안, 학년별 문턱으로 실측 소단원 정확도 90% 이상). " +
            "시험지가 소단원명을 적어 주지 않은 문항이라 DB 에는 «추정으로 붙였다» 는 표시가 " +
            "남지 않는다 — 이 파일이 그 기록이다(track-g-decision.md).",
          출제보류_pending: holdRows.map((c) => c.externalId),
          출제보류_사유:
            "보기가 전부 그림이라 본문 보기가 비어 있다. 트랙 A 가 figureUrls 를 붙이고 " +
            "사람이 approved 로 승격하기 전에는 자동 출제에 안 잡힌다(D-22).",
          externalIds: finalRows.map((r) => r.externalId),
          // 되돌릴 때 «어느 단원으로 왜 붙였나» 를 알아야 덮어쓸 수 있다.
          판정: kept.map((c) => ({
            externalId: c.externalId,
            unitId: c.unitId,
            confidence: c.confidence,
            학년: c.gradeHint,
          })),
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
          차수: "2차 (트랙 G 판정분)",
          설명:
            "트랙 F 2차가 figureUrls 를 비운 채로 넣을 행이다(조건 4). " +
            "트랙 D hwpx-figures.json(편→문항→장수) 기준. " +
            "본문 [그림] 자리표시로는 못 센다 — HWP 추출본에는 그 표기가 0건이다.",
          편수: figureExams.length,
          행수: figureRows.length,
          장수: figureRows.reduce((a, c) => a + c.figureCount, 0),
          출제보류_우선: holdRows.map((c) => ({
            externalId: c.externalId,
            examId: c.examId,
            questionNumber: c.questionNumber,
            school: c.school,
            그림장수: c.figureCount,
            사유: "보기가 전부 그림 — 본문 보기가 비어 있다",
          })),
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

    console.log("── 2차 적재 드라이런 (쓰지 않음) ──");
    console.log(
      `입력 corpus ${corpus.fingerprint} (트랙 D ${corpus.files}편 ${Math.round(corpus.bytes / 1e6)}MB)`,
    );
    console.log(
      `판정 ${built.판정행}행 → 후보 ${built.candidates.length}` +
        ` → 중복 -${built.candidates.length - kept.length}` +
        ` → toLoadRows 제외 -${skipped.length}` +
        ` → **적재 ${rows.length}행 / ${byExam.size}편**`,
    );
    console.log("\n후보를 만들며 떨어진 행:");
    for (const [reason, n] of Object.entries(built.제외).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason.padEnd(24)} ${String(n).padStart(5)}`);
    }
    console.log(
      `\n정답 보유 ${withAnswer} (${report.정답.보유율}%) · 없음 ${kept.length - withAnswer}` +
        "  ← 정답 없는 것도 그대로 넣는다. 자동 출제에서만 빠진다.",
    );
    console.log(
      `G 확신 — 중앙값 ${report.G확신.중앙값} · 25% ${report.G확신["25%"]} · 최소 ${report.G확신.최소}`,
    );
    console.log(`\n학년 분포 (${Object.keys(gradeDist).length}개):`);
    for (const [g, n] of topN(gradeDist, 20)) {
      console.log(`  ${g.padEnd(10)} ${String(n).padStart(5)}`);
    }
    console.log(`\n소단원 ${Object.keys(unitDist).length}개에 걸침 (전체 ${units.length}개 중)`);
    console.log(`  그중 지금 출제 자격 0 인 단원을 살리는 것: ${newlyFilled.length}개`);
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
          " → reviewStatus=pending 으로 넣는다. 그림을 붙이고 승격해야 출제된다.",
      );
    }
    console.log(`학년 어긋나 안 넣는 행 ${built.학년어긋남.length}`);
    console.log(`D-37 위반(비완료본 원본) ${report.D37_비완료본원본}`);
    console.log(`\n상세 → ${OUT}\n행 → ${ROWS}\n목록 → ${EXTERNAL_IDS2}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runDryRun2().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
