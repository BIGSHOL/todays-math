/**
 * 트랙 F 2차 · **중복 방지 전량 대조.** 적재 전 필수(코디네이터 조건 2).
 *
 *   npx tsx scripts/qa/load2-dedupe-check.ts
 *
 * 읽기 전용이다. `Problem` 전량을 훑어 2차 후보와 대조하고, 빼야 할 것을
 * `scripts/qa/reports/load2-exclusions.json` 으로 떨군다(드라이런이 읽는다).
 *
 * ## 열쇠 다섯
 *
 *  1. **`externalId`** — 재이관 멱등 키(원장 §2.2).
 *  2. **본문 해시** — 공백 정규화 후 sha1(원장 §2.1). ⚠️ 매우 약하다(아래 §B).
 *  3. **훼손 내성 열쇠 + 같은 학교** — **2차의 실제 판정 열쇠다**(아래 §B).
 *  4. **원본 파일명** — 같은 시험지가 다른 `examId` 로 들어왔는지.
 *  5. **편 단위 한글서명 겹침률** — 1차의 판정 열쇠였다. **2차에서는 보고용이다**(아래 §A).
 *
 * ## §A 편 단위 겹침률은 2차에서 판정에 못 쓴다 (2026-08-17 실측)
 *
 * 1차 규칙(`겹침률 >= 0.3`)을 2차 후보 행에 그대로 걸었더니 **79편 159행**이 중복으로
 * 잡혔고 **전부 거짓**이었다. 2차 후보는 한 편에서 **1~3행**만 나오므로(G 가 힌트 없는
 * 문항만 골랐다) 우연히 겹치는 문구 하나면 겹침률이 50~100% 가 된다.
 *
 * 분모를 편 전체(실체 문항 전량)로 되돌리니 3편만 남았는데, **그것도 중복이 아니었다.**
 * 원본 경로를 봤더니 전부 이 꼴이다:
 *
 * | 후보 | DB 편 |
 * |---|---|
 * | `[신명고][1][수하][23-2-기말][천재이]` | `[신명고][1][공수2][25-2-기말**대비**][지학사]` |
 * | `[경상여고][1][수하][23-2-중간][교학사]` | `[경상여고][1][공수2][25-2-기말**대비**][미래엔]` |
 *
 * **같은 시험지가 아니라, 그 학교의 2025년 «대비» 시험지가 자기네 2023년 기출을 가져다
 * 쓴 것이다.** 편이 겹치는 게 아니라 **문항이 겹친다.** 그래서 2차의 판정은 편이 아니라
 * **행** 단위여야 한다. 편 단위 수치는 보고에만 남긴다.
 *
 * ## §B 유사도 문턱으로는 못 가른다 — **훼손이 중복을 덜 닮아 보이게 한다**
 *
 * 전문 유사도로 재니 진짜 중복이 **0.827** 까지 내려왔다. 내려오는 이유가 문제다 —
 * **기존 DB 행의 LaTeX 가 깨져 있어서**다(옛 PDF 텍스트 레이어).
 * 예: DB `$y=2$\sqrt{$x+1$}+a` ↔ 후보 `$y=2\sqrt{x}+1+a$`. 같은 문항인데 서식만 깨졌다.
 * 즉 **훼손이 심할수록 중복이 문턱을 빠져나간다** — CLAUDE.md 2026-08-16 의 그 함정이다.
 *
 * 그래서 훼손되는 부분(LaTeX 명령·중괄호·공백·라틴 변수명)을 **버리고** 훼손되지 않는
 * 부분(**한글 + 숫자**)만 남겨 열쇠를 만든다. 숫자를 남기므로 템플릿 형제(한글은 같고
 * 숫자만 다름)는 갈라진다.
 *
 * **그리고 같은 학교일 것을 함께 요구한다.** 26짝을 전량 눈으로 확인한 결과:
 *
 * | | 짝 | 눈으로 본 결과 |
 * |---|---|---|
 * | 같은 학교 | 19 | **19 전부 진짜 중복** (거짓 0) |
 * | 다른 학교 | 8 | **5가 거짓** — 라틴 변수를 버려서 `점(a,ab)` 와 `점A(a,b)` 가 붙었다 |
 *
 * 학교가 같다는 것은 본문과 **독립인 근거**다. 1차의 진짜 중복 4편도 전부 학교가 같았다.
 * 다른 학교 짝은 자동으로 빼지 않고 **코디네이터에게 수와 목록으로 보고**한다.
 */
import { createHash } from "node:crypto";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, writeFile } from "node:fs/promises";

import type { UnitLike } from "../../src/lib/import/types";
import type { HwpQuestion } from "./load-survey";
import { isDirectScript } from "../import/isDirectScript";
import { TRACK_D, sanitizeContent } from "./load-candidates";
import { buildCandidates2 } from "./load2-candidates";

const OUT = "scripts/qa/reports/load2-dedupe-check.json";
export const EXCLUSIONS2 = "scripts/qa/reports/load2-exclusions.json";
/** 1차가 전량 대조로 판정한 편 중복. 바닥으로 깐다. */
const EXCLUSIONS1 = "scripts/qa/handoff/load-exclusions.json";
const DB_PAGE = 4_000;

const MIN_SIG_KO = 20;
/** 편 단위 겹침률 — **보고용 기준선**이다(§A). 판정에 쓰지 않는다. */
const PAPER_OVERLAP_NOTE = 0.3;

const normalize = (s: string): string => (s ?? "").replace(/\s+/g, " ").trim();
const hash16 = (s: string): string =>
  createHash("sha1").update(s, "utf8").digest("hex").slice(0, 16);

/**
 * `[서술형 3]`·`[3점]` 같은 배점 머리표. 문제의 일부가 아니다(트랙 D 실측).
 *
 * ⚠️ **줄바꿈을 허용해야 한다.** 옛 PDF 추출본은 `[서술형\n\n$4$\n\n]` 처럼 머리표 안에
 * 빈 줄을 넣는다. `[^\]\n]` 로 막으면 그 판이 안 벗겨져 같은 문항이 다른 열쇠가 된다
 * (실측: 1549-19 ↔ 3391-21, `[서술형3]` ↔ `[서술형 4]` 인 같은 문항).
 */
const SCORE_HEADER = /^\s*\[[^\]]{0,20}\]\s*/;

/**
 * **훼손 내성 중복 열쇠** — 한글과 숫자만 남긴다(§B).
 * 너무 짧으면(24자 미만) 우연 충돌이 나므로 대조에 쓰지 않는다.
 */
export function dupKey(content: string): string {
  const core = (content ?? "").replace(SCORE_HEADER, "").replace(/[^가-힣0-9]/g, "");
  return core.length < 24 ? "" : createHash("sha1").update(core).digest("hex").slice(0, 16);
}

export function fileKey(p: string | null | undefined): string {
  if (!p) return "";
  const base = p.replace(/\\/g, "/").split("/").pop() ?? "";
  return base
    .replace(/\.(pdf|hwp|hwpx)$/i, "")
    .replace(/\s+/g, "")
    .toLowerCase();
}

interface DbRef {
  externalId: string | null;
  examId: string | null;
  school: string | null;
}

export async function runDedupeCheck2(): Promise<void> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();

  try {
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });

    const { sigKo, buildHwpContent } = (await import(
      pathToFileURL(path.join(TRACK_D, "../hwpJudgeRules.ts")).href
    )) as {
      sigKo: (s: string | null | undefined) => string;
      buildHwpContent: (q: HwpQuestion) => string;
    };

    // ── DB 전량. 본문이 커서 페이지로 나눠 읽고 해시만 남긴다. ──────────────
    const dbExternal = new Set<string>();
    const dbContent = new Map<string, DbRef>();
    const dbDupKey = new Map<string, DbRef[]>();
    const dbSigToExams = new Map<string, Set<string>>();
    const dbSigOne = new Map<string, DbRef>();
    const dbFiles = new Map<string, DbRef>();
    const dbPaper = new Map<string, { school: string | null; rows: number }>();
    let scanned = 0;
    let dbKeyShort = 0;

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
        const ref: DbRef = {
          externalId: row.externalId,
          examId: row.examId,
          school: row.school,
        };
        if (row.externalId) dbExternal.add(row.externalId);
        dbContent.set(hash16(normalize(row.content)), ref);

        const dk = dupKey(row.content);
        if (dk) {
          if (!dbDupKey.has(dk)) dbDupKey.set(dk, []);
          dbDupKey.get(dk)!.push(ref);
        } else {
          dbKeyShort += 1;
        }

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

    // 후보는 **제외 없이** 만든다 — 무엇이 왜 걸리는지 여기서 세야 하기 때문이다.
    const built = await buildCandidates2(units, dbExternal);
    const candidates = built.candidates;

    // ── 행 단위 대조 ────────────────────────────────────────────────────────
    let hitExternal = 0;
    const hitContent: string[] = [];
    let hitSigRows = 0;
    let shortSigKo = 0;
    let candKeyShort = 0;
    const selfExternal = new Map<string, number>();
    const selfContent = new Map<string, number>();
    const selfDupKey = new Map<string, string[]>();
    const candidateRows = new Map<string, number>();

    /** 열쇠가 같고 **학교도 같은** 짝 — 이것만 뺀다(§B). */
    const dupSameSchool: Array<Record<string, unknown>> = [];
    /** 열쇠는 같은데 학교가 다른 짝 — 빼지 않고 보고한다(8짝 중 5가 거짓이었다). */
    const dupOtherSchool: Array<Record<string, unknown>> = [];

    for (const c of candidates) {
      selfExternal.set(c.externalId, (selfExternal.get(c.externalId) ?? 0) + 1);
      if (dbExternal.has(c.externalId)) hitExternal += 1;

      const ch = hash16(normalize(c.content));
      selfContent.set(ch, (selfContent.get(ch) ?? 0) + 1);
      if (dbContent.has(ch)) hitContent.push(c.externalId);

      candidateRows.set(c.examId, (candidateRows.get(c.examId) ?? 0) + 1);

      const dk = dupKey(c.content);
      if (!dk) {
        candKeyShort += 1;
      } else {
        selfDupKey.set(dk, [...(selfDupKey.get(dk) ?? []), c.externalId]);
        for (const m of dbDupKey.get(dk) ?? []) {
          if (String(m.examId) === c.examId) continue;
          const pair = {
            externalId: c.externalId,
            examId: c.examId,
            school: c.school,
            DB: m.externalId,
            DB편: m.examId,
            DB학교: m.school,
            본문: c.content.slice(0, 120),
          };
          if ((c.school ?? "?") === (m.school ?? "??")) dupSameSchool.push(pair);
          else dupOtherSchool.push(pair);
        }
      }

      const ko = sigKo(c.content);
      if (ko.length < MIN_SIG_KO) {
        shortSigKo += 1;
        continue;
      }
      if (dbSigOne.has(hash16(ko))) hitSigRows += 1;
    }

    // ── 편 단위 겹침 — **보고용**. 분모는 그 편의 실체 문항 전량이다(§A). ──────
    const perPaper = new Map<
      string,
      { rows: number; hits: Map<string, number>; school: string | null; year: number | null }
    >();
    for (const [examId, pair] of built.papers) {
      const paper = {
        rows: 0,
        hits: new Map<string, number>(),
        school: pair.school,
        year: pair.year,
      };
      let questions: HwpQuestion[] = [];
      try {
        questions = ((
          JSON.parse(
            await readFile(path.join(TRACK_D, "hwp-latex", `${examId}.json`), "utf8"),
          ) as { questions?: HwpQuestion[] }
        ).questions ?? []) as HwpQuestion[];
      } catch {
        questions = [];
      }
      for (const q of questions) {
        if ((q.stem ?? "").trim().length < 40) continue;
        paper.rows += 1;
        const ko = sigKo(sanitizeContent(buildHwpContent(q)));
        if (ko.length < MIN_SIG_KO) continue;
        for (const e of dbSigToExams.get(hash16(ko)) ?? []) {
          // ⚠️ 자기 편은 뺀다. 1차가 이미 적재한 편의 형제 문항이 후보라 자기와 겹친다.
          if (e === examId) continue;
          paper.hits.set(e, (paper.hits.get(e) ?? 0) + 1);
        }
      }
      perPaper.set(examId, paper);
    }

    const overlaps = [];
    for (const [examId, p] of perPaper) {
      const top = [...p.hits.entries()].sort((a, b) => b[1] - a[1])[0];
      if (!top || p.rows === 0) continue;
      const [dbExam, n] = top;
      overlaps.push({
        examId,
        school: p.school,
        year: p.year,
        편실체행: p.rows,
        후보행: candidateRows.get(examId) ?? 0,
        DB편: dbExam,
        DB학교: dbPaper.get(dbExam)?.school ?? null,
        DB편행수: dbPaper.get(dbExam)?.rows ?? 0,
        겹친행: n,
        겹침률: Number((n / p.rows).toFixed(3)),
        학교같음: (p.school ?? "?") === (dbPaper.get(dbExam)?.school ?? "??"),
      });
    }
    overlaps.sort((a, b) => b.겹침률 - a.겹침률);

    // 파일 단위 — 자기 편은 뺀다(1차 적재분이 자기 원본 파일명을 갖고 있다).
    const fileHits: Array<{ examId: string; file: string; DB편: string | null }> = [];
    for (const [examId, pair] of built.papers) {
      for (const p of [pair.hwp, pair.pdf]) {
        const fk = fileKey(p);
        const hit = fk ? dbFiles.get(fk) : undefined;
        if (hit && String(hit.examId) !== examId) {
          fileHits.push({ examId, file: fk, DB편: hit.examId });
        }
      }
    }

    // ── 1차가 판정한 편 중복을 바닥으로 깐다 ────────────────────────────────
    let priorPapers: string[] = [];
    try {
      const ex1 = JSON.parse(await readFile(EXCLUSIONS1, "utf8")) as {
        중복편: Array<{ examId: string }>;
      };
      priorPapers = ex1.중복편.map((d) => String(d.examId));
    } catch {
      throw new Error(
        `${EXCLUSIONS1} 를 못 읽었습니다. 1차가 전량 대조로 찾은 편 중복 4편을 바닥으로 깔아야 합니다.`,
      );
    }
    const priorRows = candidates
      .filter((c) => priorPapers.includes(c.examId))
      .map((c) => c.externalId);

    // 뺄 행 = 본문 해시가 정확히 같은 것 + 훼손내성열쇠·학교가 같은 것 + 1차 중복편 소속.
    const excludeRows = new Set<string>([
      ...hitContent,
      ...dupSameSchool.map((d) => d.externalId as string),
      ...priorRows,
    ]);

    const selfDupGroups = [...selfDupKey.values()].filter((v) => v.length > 1);

    await writeFile(
      EXCLUSIONS2,
      JSON.stringify(
        {
          생성시각: new Date().toISOString(),
          판정: "2차는 **행 단위**로 뺀다. 편 단위 겹침률은 보고용이다(§A).",
          제외행: [...excludeRows].sort(),
          제외행수: excludeRows.size,
          제외근거: {
            본문해시일치: hitContent,
            훼손내성열쇠_같은학교: dupSameSchool,
            "1차중복편소속": priorRows,
          },
          보고만_빼지않음: {
            훼손내성열쇠_다른학교: dupOtherSchool,
            사유:
              "27짝을 눈으로 본 결과 다른 학교 8짝 중 5가 거짓이었다(진짜는 3). 코디네이터 판단 사항.",
            후보끼리_같은열쇠_묶음: selfDupGroups,
            후보끼리_같은열쇠_행수: selfDupGroups.reduce((a, v) => a + v.length, 0),
          },
          제외편_1차물려받음: priorPapers,
          결함편: built.결함편,
          결함행수: built.제외.본문결함 ?? 0,
          결함사유: built.결함,
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
          판정행: built.판정행,
          후보편: built.papers.size,
          후보행: candidates.length,
          제외단계별: built.제외,
          DB열쇠수: {
            externalId: dbExternal.size,
            본문해시: dbContent.size,
            훼손내성열쇠: dbDupKey.size,
            한글서명: dbSigOne.size,
            원본파일: dbFiles.size,
            훼손내성열쇠_짧아제외: dbKeyShort,
          },
          DB겹침: {
            externalId: hitExternal,
            본문해시: hitContent.length,
            훼손내성열쇠_같은학교: dupSameSchool.length,
            훼손내성열쇠_다른학교: dupOtherSchool.length,
            한글서명_행: hitSigRows,
            원본파일: fileHits.length,
          },
          편단위_보고용: {
            겹치는편: overlaps.length,
            기준선넘는편: overlaps.filter((o) => o.겹침률 >= PAPER_OVERLAP_NOTE),
            최대겹침률: overlaps[0]?.겹침률 ?? 0,
            주석:
              "판정에 쓰지 않는다. 걸리는 편은 «학교의 2025 대비 시험지가 자기 2023 기출을 " +
              "가져다 쓴» 짝이고 같은 시험지가 아니다(§A).",
          },
          자기중복: {
            externalId: [...selfExternal.values()].filter((n) => n > 1).length,
            본문해시: [...selfContent.values()].filter((n) => n > 1).length,
            훼손내성열쇠_묶음: selfDupGroups.length,
            훼손내성열쇠_행: selfDupGroups.reduce((a, v) => a + v.length, 0),
          },
          한글서명_짧아_제외: shortSigKo,
          훼손내성열쇠_짧아_제외: candKeyShort,
          원본파일_겹침: fileHits,
        },
        null,
        1,
      ),
      "utf8",
    );

    console.log("── 2차 중복 방지 전량 대조 ──");
    console.log(
      `DB ${scanned}행 · 판정 ${built.판정행}행 → 후보 ${candidates.length}행 / ${built.papers.size}편`,
    );
    console.log("\n후보를 만들며 떨어진 행:");
    for (const [reason, n] of Object.entries(built.제외).sort((a, b) => b[1] - a[1])) {
      console.log(`  ${reason.padEnd(24)} ${String(n).padStart(5)}`);
    }
    console.log("\nDB 와 겹친 후보 (행 단위):");
    console.log(`  externalId              ${hitExternal}`);
    console.log(`  본문해시(정확)          ${hitContent.length}`);
    console.log(
      `  훼손내성열쇠 + 같은학교 ${dupSameSchool.length}   ← 뺀다 (전량 눈으로 확인, 거짓 0)`,
    );
    console.log(
      `  훼손내성열쇠 + 다른학교 ${dupOtherSchool.length}   ← 안 뺀다 (8짝 중 5가 거짓이었다)`,
    );
    console.log(`  한글서명(행)            ${hitSigRows}   ← 약한 열쇠, 판정에 안 쓴다`);
    console.log(`  원본파일                ${fileHits.length}`);
    console.log(
      `\n편 단위 겹침(보고용) — 기준선 ${PAPER_OVERLAP_NOTE} 넘는 편 ` +
        `${overlaps.filter((o) => o.겹침률 >= PAPER_OVERLAP_NOTE).length}` +
        ` · 최대 ${((overlaps[0]?.겹침률 ?? 0) * 100).toFixed(0)}%`,
    );
    console.log(
      `1차에서 물려받은 편 중복 ${priorPapers.length}편 — 2차 후보 해당 행 ${priorRows.length}`,
    );
    console.log(
      `\n후보끼리 같은 열쇠 ${selfDupGroups.length}묶음 ` +
        `${selfDupGroups.reduce((a, v) => a + v.length, 0)}행` +
        " — 학교가 다른 반복 출제다. 1차 선례대로 그대로 둔다(보고만).",
    );
    console.log(
      `\n뺄 행 ${excludeRows.size} · 적재 후보 잔량 ${candidates.length - excludeRows.size}`,
    );
    console.log(`\n상세 → ${OUT}\n제외 목록 → ${EXCLUSIONS2}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  runDedupeCheck2().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
