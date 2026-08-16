/**
 * 트랙 F · F-2 — **중복 방지 전량 대조.** 적재 전 필수(브리프 §5).
 *
 *   npx tsx scripts/qa/load-dedupe-check.ts
 *
 * 읽기 전용이다. `Problem` 전량을 훑어 후보와 대조하고, 빼야 할 것을
 * `scripts/qa/reports/load-exclusions.json` 으로 떨군다(F-3 드라이런이 읽는다).
 * 코디네이터가 표본 6편으로 중복 0 을 봤으나 그건 표본이라 **전량으로 다시** 한다.
 *
 * ## 열쇠를 넷 쓴다 — 하나만 쓰면 조용히 통과하는 구멍이 있다
 *
 *  1. **`externalId`** (원장 §2.2, 최우선) — 재이관 멱등 키. UNIQUE 라 놓치면 배치가 죽는다.
 *  2. **본문 해시** (원장 §2.1) — 공백 정규화 후 sha1 앞 16자.
 *     ⚠️ **약한 열쇠다.** 기존 행 본문은 PDF 텍스트 레이어에서, 후보는 HWP 에서 나와
 *     같은 문항이라도 글자가 다르다. 0 이 나와도 "중복 없음" 의 근거가 못 된다.
 *  3. **한글 서명**(트랙 D `sigKo`) — 수식을 걷어낸 한글 지문. 추출 경로가 달라도 살아남는다.
 *  4. **원본 파일명** — 같은 시험지가 다른 `examId` 로 들어왔는지 본다.
 *
 * ## 3번은 **행이 아니라 편으로** 판정한다 (2026-08-16 실측으로 굳힌 규칙)
 *
 * 한글 서명이 걸린 행은 236건이었지만, 행 단위로 보면 진짜 중복과 문구 우연 일치가
 * 섞여 갈라지지 않는다 — 학교가 서로 다른 `삼각형 ABC에서 … 외접원의 반지름의 길이는?`
 * 류가 숫자만 다른 채 같은 서명을 갖기 때문이다. **편 단위 겹침률로 보면 갈라진다.**
 *
 * | 겹침률 | 편 | 실체 |
 * |---|---|---|
 * | 50~64% | **4** | 같은 시험지가 다른 `examId` 로 이미 DB 에 있다 |
 * | 20~50% | 0 | (비어 있다 — 경계가 넓게 벌어진다) |
 * | ≤11% | 125 | 학교가 다른 문구 우연 일치. 버리면 멀쩡한 문항을 잃는다 |
 *
 * 걸린 4편은 원본 경로까지 확인했다 — `기출작업\이전차수\NNN차\[학교][1][수하][24-2-중간]`
 * 과 `HWP 2 PDF\...\[학교][1][공수2][...]` 로, 학교·학년·회차·출판사가 같고 과목 표기만
 * `수하`↔`공수2`(HIGH_SUBJECT 별칭)로 다른 **같은 시험지**다.
 * `externalId` 만 봤으면 4편을 통째로 중복 삽입했다.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { writeFile } from "node:fs/promises";

import type { UnitLike } from "../../src/lib/import/types";
import { isDirectScript } from "../import/isDirectScript";
import { buildCandidates, TRACK_D } from "./load-candidates";

const OUT = "scripts/qa/reports/load-dedupe-check.json";
export const EXCLUSIONS = "scripts/qa/reports/load-exclusions.json";
const DB_PAGE = 4_000;

/** 한글 서명이 이보다 짧으면 대조에 쓰지 않는다 — 짧은 지문끼리 우연히 겹친다. */
const MIN_SIG_KO = 20;
/**
 * 편 통째 중복으로 볼 겹침률. 실측 분포가 `≤11%` 와 `50%+` 로 갈라져 사이가 비어 있다.
 * 가운데를 잡았다 — 어느 쪽으로 조금 움직여도 판정이 안 바뀐다.
 */
const PAPER_DUP_RATIO = 0.3;

const normalize = (s: string): string => (s ?? "").replace(/\s+/g, " ").trim();
const hash16 = (s: string): string =>
  createHash("sha1").update(s, "utf8").digest("hex").slice(0, 16);

/** 경로 표기 차이를 턴 파일명. */
export function fileKey(p: string | null | undefined): string {
  if (!p) return "";
  const base = p.replace(/\\/g, "/").split("/").pop() ?? "";
  return base
    .replace(/\.(pdf|hwp|hwpx)$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

export interface PaperOverlap {
  examId: string;
  school: string | null;
  year: number | null;
  후보행: number;
  DB편: string;
  DB학교: string | null;
  DB편행수: number;
  겹친행: number;
  겹침률: number;
}

export async function runDedupeCheck(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const examRows = await prisma.problem.findMany({
      where: { source: "past_exam", examId: { not: null } },
      select: { examId: true },
      distinct: ["examId"],
    });
    const inDb = new Set(examRows.map((r) => String(r.examId)));

    const built = await buildCandidates(units, inDb);
    const candidates = built.candidates;

    const { sigKo } = (await import(
      pathToFileURL(path.join(TRACK_D, "../hwpJudgeRules.ts")).href
    )) as { sigKo: (s: string | null | undefined) => string };

    // ── DB 전량. 본문이 커서 페이지로 나눠 읽고 해시만 남긴다. ──────────────
    const dbExternal = new Map<string, string>();
    const dbContent = new Map<string, { externalId: string | null; examId: string | null }>();
    const dbSigToExams = new Map<string, Set<string>>();
    const dbSigOne = new Map<string, { externalId: string | null; examId: string | null }>();
    const dbFiles = new Map<string, { externalId: string | null; examId: string | null }>();
    const dbPaper = new Map<string, { school: string | null; rows: number }>();
    let scanned = 0;

    for (let skip = 0; ; skip += DB_PAGE) {
      const page = await prisma.problem.findMany({
        skip,
        take: DB_PAGE,
        orderBy: { id: "asc" },
        select: {
          externalId: true,
          examId: true,
          content: true,
          sourceFile: true,
          school: true,
        },
      });
      if (page.length === 0) break;
      for (const row of page) {
        scanned += 1;
        const ref = { externalId: row.externalId, examId: row.examId };
        if (row.externalId) dbExternal.set(row.externalId, row.externalId);
        dbContent.set(hash16(normalize(row.content)), ref);
        if (row.examId) {
          const p = dbPaper.get(row.examId) ?? { school: row.school, rows: 0 };
          p.rows += 1;
          dbPaper.set(row.examId, p);
        }
        const ko = sigKo(row.content);
        if (ko.length >= MIN_SIG_KO) {
          const k = hash16(ko);
          dbSigOne.set(k, ref);
          if (row.examId) {
            if (!dbSigToExams.has(k)) dbSigToExams.set(k, new Set());
            dbSigToExams.get(k)!.add(row.examId);
          }
        }
        const fk = fileKey(row.sourceFile);
        if (fk) dbFiles.set(fk, ref);
      }
      if (page.length < DB_PAGE) break;
    }

    // ── 후보 대조 ───────────────────────────────────────────────────────────
    let hitExternal = 0;
    const hitContent: string[] = [];
    let hitSigRows = 0;
    let shortSigKo = 0;
    const selfExternal = new Map<string, number>();
    const selfContent = new Map<string, number>();
    const selfSig = new Map<string, string[]>();
    const perPaper = new Map<
      string,
      { rows: number; hits: Map<string, number>; school: string | null; year: number | null }
    >();

    for (const c of candidates) {
      selfExternal.set(c.externalId, (selfExternal.get(c.externalId) ?? 0) + 1);
      if (dbExternal.has(c.externalId)) hitExternal += 1;

      const ch = hash16(normalize(c.content));
      selfContent.set(ch, (selfContent.get(ch) ?? 0) + 1);
      if (dbContent.has(ch)) hitContent.push(c.externalId);

      const paper =
        perPaper.get(c.examId) ??
        { rows: 0, hits: new Map<string, number>(), school: c.school, year: c.year };
      paper.rows += 1;
      perPaper.set(c.examId, paper);

      const ko = sigKo(c.content);
      if (ko.length < MIN_SIG_KO) {
        shortSigKo += 1;
        continue;
      }
      const kh = hash16(ko);
      selfSig.set(kh, [...(selfSig.get(kh) ?? []), c.externalId]);
      if (dbSigOne.has(kh)) hitSigRows += 1;
      for (const e of dbSigToExams.get(kh) ?? []) {
        paper.hits.set(e, (paper.hits.get(e) ?? 0) + 1);
      }
    }

    // 편 단위 겹침 — 행 단위로는 진짜 중복과 문구 우연 일치가 안 갈라진다.
    const overlaps: PaperOverlap[] = [];
    for (const [examId, p] of perPaper) {
      const top = [...p.hits.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top) continue;
      const [dbExam, n] = top;
      overlaps.push({
        examId,
        school: p.school,
        year: p.year,
        후보행: p.rows,
        DB편: dbExam,
        DB학교: dbPaper.get(dbExam)?.school ?? null,
        DB편행수: dbPaper.get(dbExam)?.rows ?? 0,
        겹친행: n,
        겹침률: Number((n / p.rows).toFixed(3)),
      });
    }
    overlaps.sort((a, b) => b.겹침률 - a.겹침률);
    const dupPapers = overlaps.filter((o) => o.겹침률 >= PAPER_DUP_RATIO);
    const coincidence = overlaps.filter((o) => o.겹침률 < PAPER_DUP_RATIO);

    // 파일 단위
    const fileHits = built.papers.flatMap((paper) =>
      [paper.hwp, paper.pdf]
        .map(fileKey)
        .filter((fk) => fk && dbFiles.has(fk))
        .map((fk) => ({ examId: String(paper.examId), file: fk })),
    );

    const dupExternal = [...selfExternal.values()].filter((n) => n > 1).length;
    const dupContentSelf = [...selfContent.values()].filter((n) => n > 1).length;
    const dupSigSelf = [...selfSig.values()].filter((ids) => ids.length > 1);

    const excludedRows = dupPapers.reduce((a, d) => a + d.후보행, 0);

    await writeFile(
      EXCLUSIONS,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          사유: "편 단위 중복 — 같은 시험지가 다른 examId 로 이미 DB 에 있다",
          기준: `한글서명 겹침률 >= ${PAPER_DUP_RATIO}`,
          중복편: dupPapers,
          제외행수: excludedRows,
          결함편: built.결함편,
          결함행수: built.counted.결함제외,
          결함사유: built.counted.결함,
        },
        null,
        1,
      ),
      "utf8",
    );

    await writeFile(
      OUT,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          DB훑은행: scanned,
          후보편: built.papers.length,
          후보행: candidates.length,
          집계: built.counted,
          DB열쇠수: {
            externalId: dbExternal.size,
            본문해시: dbContent.size,
            한글서명: dbSigOne.size,
            원본파일: dbFiles.size,
          },
          DB겹침: {
            externalId: hitExternal,
            본문해시: hitContent.length,
            한글서명_행: hitSigRows,
            원본파일: fileHits.length,
          },
          편단위: {
            겹치는편: overlaps.length,
            중복편: dupPapers,
            우연일치편: coincidence.length,
            우연일치_겹친행: coincidence.reduce((a, o) => a + o.겹친행, 0),
          },
          자기중복: {
            externalId: dupExternal,
            본문해시: dupContentSelf,
            한글서명_묶음: dupSigSelf.length,
            한글서명_표본: dupSigSelf.slice(0, 20),
          },
          한글서명_짧아_제외: shortSigKo,
          본문해시_겹친_externalId: hitContent,
        },
        null,
        1,
      ),
      "utf8",
    );

    console.log("── F-2 중복 방지 전량 대조 ──");
    console.log(`DB ${scanned}행 · 후보 ${built.papers.length}편 ${candidates.length}행`);
    console.log(
      `DB 열쇠 — externalId ${dbExternal.size} · 본문해시 ${dbContent.size}` +
        ` · 한글서명 ${dbSigOne.size} · 원본파일 ${dbFiles.size}`,
    );
    console.log("\nDB 와 겹친 후보:");
    console.log(`  externalId   ${hitExternal}`);
    console.log(`  본문해시     ${hitContent.length}`);
    console.log(`  한글서명(행) ${hitSigRows}  ← 행으로는 진짜/우연이 안 갈라진다`);
    console.log(`  원본파일     ${fileHits.length}`);
    console.log("\n편 단위 겹침 (한글서명 겹침률):");
    for (const o of dupPapers) {
      console.log(
        `  ⛔ ${o.examId} ${o.school ?? "?"} ${o.year} 후보 ${o.후보행}행` +
          ` → DB편 ${o.DB편}(${o.DB학교 ?? "?"}, ${o.DB편행수}행)` +
          ` 겹침 ${o.겹친행} (${(o.겹침률 * 100).toFixed(0)}%)`,
      );
    }
    console.log(
      `  우연 일치 ${coincidence.length}편 · 겹친 행 ${coincidence.reduce((a, o) => a + o.겹친행, 0)}` +
        ` (최대 ${((coincidence[0]?.겹침률 ?? 0) * 100).toFixed(0)}%) — 그대로 둔다`,
    );
    console.log("\n후보 집합 안의 자기 중복:");
    console.log(
      `  externalId ${dupExternal} · 본문해시 ${dupContentSelf} · 한글서명 묶음 ${dupSigSelf.length}` +
        `  (서명이 짧아 대조 제외 ${shortSigKo}행)`,
    );
    console.log(
      `\n제외 대상 — 편 중복 ${dupPapers.length}편 ${excludedRows}행` +
        ` · 본문 결함 ${Object.keys(built.결함편).length}편 ${built.counted.결함제외}행` +
        ` ${JSON.stringify(built.counted.결함)}`,
    );
    console.log(`적재 후보 잔량 ${candidates.length - excludedRows}행`);
    console.log(`\n상세 → ${OUT}\n제외 목록 → ${EXCLUSIONS}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runDedupeCheck().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
