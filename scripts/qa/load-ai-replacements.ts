/**
 * AI 대체 문항을 **검사에 통과한 것만** 문제은행에 넣는다 (`reviewStatus = pending`).
 *
 *   npx tsx scripts/qa/load-ai-replacements.ts <배치파일>                 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-ai-replacements.ts <배치파일> --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-ai-replacements.ts --revert <원장파일>
 *
 * 원장님 확정(2026-08-19): 「AI로 새로 내자」 — 그리고 생성은 **이 세션에서 직접** 한다
 * (내부 요금제, 비용 0). 그래서 이 스크립트는 **AI 를 부르지 않는다.** 사람이(=세션이)
 * 만들어 둔 배치 파일을 읽어 **검사하고 넣는 일만** 한다.
 *
 * ## 🔴 새 문항은 **269건을 잡아낸 바로 그 판정기**를 통과해야 한다
 *
 * 뺀 이유가 「학생이 정답을 고를 수 없다」였다. 새로 만든 것이 같은 결함을 가지면
 * 아무것도 고친 게 아니다. 그래서 `judgeAnswerChoice`(=`report-unusable-problems.ts`
 * 가 쓰는 그 함수)를 **그대로 불러서** 치명 판정이면 **안 넣는다.**
 * 판정 규칙을 여기에 옮겨 적지 않는다 — 두 벌이 되면 한쪽만 고쳐도 아무도 모른다.
 *
 * ## 그리고 지면에서 **실제로 그려지는지**까지 본다
 *
 * LaTeX 로 멀쩡해도 화면에서 붉게 나가는 것이 있다(CLAUDE.md 2026-08-14·08-19).
 * 그래서 제품 렌더러(`renderMathHtml`)를 **그대로 불러** `.math-raw`·`katex-error`·
 * `#cc0000` 이 나오면 막는다. 「렌더가 실패하지 않음」과 「표기가 옳음」은 다르지만,
 * 적어도 실패하는 것은 여기서 걸린다.
 *
 * ## D-22 — 자동 승격 금지
 *
 * 생성물은 **`pending`** 으로만 들어간다. 출제 풀(`findEligibleProblems`)은
 * `approved` 만 보므로, 원장님이 검수 화면에서 승격하기 전에는 시험지에 안 나간다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { judgeAnswerChoice, isFatal, type Verdict } from "./answerChoiceRules";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";

const prisma = new PrismaClient();

/** 이관 계정 — 공용 풀(D-31) 47,144행이 이 계정 소유다. 새 적재도 같은 자리에 둔다. */
const IMPORT_USER = "abd81fd6-47bf-4012-92c2-0b0da3fea42a";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");
const FILE = process.argv.slice(2).find((a) => !a.startsWith("--"));

if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
  process.exit(1);
}

export interface Draft {
  /** 어느 자리를 채우는가 — `plan-ai-replacements.ts` 의 묶음에서 온다. */
  unitId: string;
  difficulty: "easy" | "mid" | "hard";
  questionType: "객관식" | "단답형" | "서술형";
  problemType: string;
  /** 보기는 본문 안에 `①`~`⑤` 줄머리로 넣는다(`parseProblemContent` 규약). */
  content: string;
  answer: string;
  solution: string;
  /** 사람이 눈으로 볼 때 쓰는 메모. DB 에는 안 들어간다. */
  메모?: string;
}

export interface Reject {
  index: number;
  reason: string;
  detail?: string;
}

/** 렌더가 실패하는가 — 제품 렌더러를 **그대로** 부른다. */
export function renderFails(text: string): string | null {
  if (!text.trim()) return null;
  const html = renderMathHtml(text);
  if (html.includes("katex-error")) return "katex-error";
  if (html.includes("math-raw")) return "math-raw 폴백";
  if (html.includes("#cc0000")) return "붉은 글씨(알 수 없는 명령)";
  // `$` 밖의 백슬래시는 렌더러가 글자 그대로 이스케이프한다 — 지면에 날것이 나간다.
  if (/(^|[^$\\])\\[a-zA-Z]+/.test(text.replace(/\$[^$]*\$/g, "")))
    return "수식 밖에 명령이 남았다";
  return null;
}

/** 한 건을 넣을지 말지. **DB 없이 시험한다.** */
export function checkDraft(d: Draft, index: number): Reject | null {
  const miss = (
    [
      "unitId",
      "difficulty",
      "questionType",
      "problemType",
      "content",
      "answer",
      "solution",
    ] as const
  ).filter((k) => !String(d[k] ?? "").trim());
  if (miss.length) return { index, reason: `빈 칸: ${miss.join(", ")}` };

  // ① 지면·정답 판정 — **269건을 잡아낸 그 함수**를 그대로 쓴다.
  // 새로 만드는 문항에는 그림이 없다 — 있으면 그림 파이프라인을 따로 타야 한다.
  const j = judgeAnswerChoice({
    content: d.content,
    answer: d.answer,
    figureUrls: [],
  });
  if (isFatal(j.verdict as Verdict))
    return {
      index,
      reason: `학생이 정답을 고를 수 없다 (${j.verdict})`,
      detail: j.cause,
    };

  // ② 객관식이면 보기가 **정확히 다섯 칸**이어야 한다.
  //    출제 가능 객관식 33,794건 중 99.10% 가 다섯 칸이다 — 문턱이 아니라 분포에서 나온 값.
  if (d.questionType === "객관식") {
    const n = (d.content.match(/\n\s*[①②③④⑤⑥⑦⑧⑨⑩]/g) ?? []).length;
    if (n !== 5)
      return {
        index,
        reason: `객관식인데 보기가 ${n}칸이다 (다섯이어야 한다)`,
      };
    if (!/^\s*[①②③④⑤]\s*$/u.test(d.answer.trim()))
      return {
        index,
        reason: `객관식인데 정답이 «${d.answer}» 다 (원문자 하나여야 한다)`,
      };
  } else if (/\n\s*[①②③④⑤]/.test(d.content)) {
    return { index, reason: `${d.questionType} 인데 본문에 보기 마커가 있다` };
  }

  // ③ 지면에서 실제로 그려지는가.
  for (const [k, v] of [
    ["본문", d.content],
    ["정답", d.answer],
    ["해설", d.solution],
  ] as const) {
    const bad = renderFails(v);
    if (bad) return { index, reason: `${k} 이 지면에서 깨진다 — ${bad}` };
  }
  return null;
}

/* ── 실행 ────────────────────────────────────────────────────────────── */

async function revert(): Promise<void> {
  if (!FILE || !existsSync(FILE)) throw new Error(`원장이 없다: ${FILE}`);
  const l = JSON.parse(readFileSync(FILE, "utf8")) as { 넣은id: string[] };
  // 되돌리기는 **우리가 넣은 것이 아직 pending 일 때만** — 원장님이 승격했으면 안 지운다.
  const { count } = await prisma.problem.deleteMany({
    where: {
      id: { in: l.넣은id },
      reviewStatus: "pending",
      source: "ai_generated",
    },
  });
  console.log(
    `지웠다 ${count}건 / 원장 ${l.넣은id.length}건` +
      (count !== l.넣은id.length
        ? ` · 나머지는 승격됐거나 이미 없다 — 건드리지 않았다`
        : ""),
  );
}

async function main(): Promise<void> {
  if (REVERT) {
    await revert();
    await prisma.$disconnect();
    return;
  }
  if (!FILE) throw new Error("배치 파일을 넘겨라.");
  const drafts = JSON.parse(readFileSync(FILE, "utf8")) as Draft[];
  console.log(`  배치 ${FILE} · ${drafts.length}건`);

  const rejects: Reject[] = [];
  const ok: Draft[] = [];
  drafts.forEach((d, i) => {
    const r = checkDraft(d, i);
    if (r) rejects.push(r);
    else ok.push(d);
  });

  // 단원이 실재하는지 — 없는 단원에 넣으면 출제에서 영영 안 잡힌다.
  const unitIds = [...new Set(ok.map((d) => d.unitId))];
  const found = new Set(
    (
      await prisma.unit.findMany({
        where: { id: { in: unitIds } },
        select: { id: true },
      })
    ).map((u) => u.id),
  );
  const badUnit = ok.filter((d) => !found.has(d.unitId));
  for (const d of badUnit)
    rejects.push({
      index: drafts.indexOf(d),
      reason: `없는 단원이다 (${d.unitId})`,
    });
  const pass = ok.filter((d) => found.has(d.unitId));

  console.log(`  통과 ${pass.length}건 · 막힘 ${rejects.length}건`);
  for (const r of rejects)
    console.log(
      `   ✕ #${r.index}  ${r.reason}${r.detail ? ` (${r.detail})` : ""}`,
    );
  if (pass.length + rejects.length !== drafts.length)
    throw new Error("범위가 샜다 — 통과 + 막힘 이 배치 수와 안 맞는다.");

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-ai-replacements.ts ${FILE} --apply`,
    );
    await prisma.$disconnect();
    return;
  }

  const inserted: string[] = [];
  for (const d of pass) {
    // exam-wiring: 기출아님 — AI 생성물(source=ai_generated)만 넣는다. 원본 시험지가 없다.
    const row = await prisma.problem.create({
      data: {
        userId: IMPORT_USER,
        unitId: d.unitId,
        source: "ai_generated",
        difficulty: d.difficulty,
        problemType: d.problemType,
        questionType: d.questionType,
        content: d.content,
        answer: d.answer,
        solution: d.solution,
        // D-22: 사람이 승격하기 전에는 출제 풀에 안 들어간다.
        reviewStatus: "pending",
        pool: "shared",
        directUseAllowed: true,
      },
      select: { id: true },
    });
    inserted.push(row.id);
  }
  const ledger = `${FILE.replace(/\.json$/, "")}-ledger.json`;
  writeFileSync(
    ledger,
    JSON.stringify(
      {
        적용: "AI 대체 문항 적재 (pending) — 원장님 확정 2026-08-19 「AI로 새로 내자」",
        기준시각: new Date().toISOString(),
        배치: FILE,
        되돌리기: `ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-ai-replacements.ts --revert ${ledger}`,
        넣은id: inserted,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`\n  넣었다 ${inserted.length}건 (pending) · 원장 → ${ledger}`);
  console.log(`  D-22: 원장님이 문제은행에서 승격해야 출제에 나간다.`);
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("load-ai-replacements")) void main();
