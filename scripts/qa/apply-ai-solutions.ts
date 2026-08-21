/**
 * Claude 생성 해설 적용 — **기록된 정답과 일치할 때만** (2026-08-22, 원장님 지시).
 *
 *   npx tsx --env-file=.env scripts/qa/apply-ai-solutions.ts <생성파일.json...>   # dry-run
 *   ALLOW_AI_SOLUTION=1 npx tsx ... <생성파일.json...>                            # 실쓰기
 *
 * 생성 파일 형식: [{ id, finalAnswer, solution } | { id, skip: 사유 }]
 *
 * 가드 (이 저장소의 교훈 그대로):
 *  · **답 대조가 문지기다.** 에이전트는 정답을 못 봤다 — 독립적으로 푼 답이
 *    DB 정답과 일치할 때만 해설을 채운다. 불일치는 「정답 의심」 목록으로 남긴다
 *    (오답 데이터를 잡는 부산물 — 본문 밖 근거끼리의 교차 검산).
 *  · 해설의 수식 조각을 KaTeX 로 실렌더 — 실패 신호(#cc0000)면 그 행은 안 채운다.
 *  · $ 홀수(수식 안 닫힘)면 안 채운다.
 *  · 지금 해설이 비어 있을 때만 채운다 — 있는 해설을 덮지 않는다.
 *  · 원장은 **누적**한다(append) — 두 번째 회차가 첫 회차를 덮으면 되돌리기가
 *    죽는다(2026-08-20). 행이 줄면 멈춘다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";
import katex from "katex";

const APPLY = process.env.ALLOW_AI_SOLUTION === "1";
const LEDGER = path.join("scripts", "qa", "reports", "ai-solution-ledger.json");
const MISMATCH = path.join(
  "scripts",
  "qa",
  "reports",
  "ai-solution-mismatch.json",
);
const SKIPLOG = path.join("scripts", "qa", "reports", "ai-solution-skip.json");

const p = new PrismaClient();

type Gen =
  | { id: string; finalAnswer: string; solution: string }
  | { id: string; skip: string };

/** 답 표기 차이를 접는다 — ①↔1(객관식), $·공백·\left 류, √·분수. */
function normalizeAnswer(s: string): string {
  let t = s.trim();
  // 원문자 보기 번호 — 표준(①…, U+2460~)뿐 아니라 HWP 추출이 남기는 딩뱃
  // 변형(➀…, U+2780~)도 같은 뜻이다. 43건 실측(2026-08-22, J10102-GXYG 등).
  const circledSets = ["①②③④⑤", "➀➁➂➃➄"];
  for (const circled of circledSets)
    for (let i = 0; i < circled.length; i += 1)
      t = t.split(circled[i]!).join(String(i + 1));
  t = t
    .replace(/\$\s*/g, "")
    .replace(/\\left|\\right|\\,|\\;|\\!|~/g, "")
    .replace(/\\sqrt\{([^{}]+)\}/g, "√$1")
    .replace(/\\sqrt(\d)/g, "√$1")
    .replace(/\\frac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\dfrac\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/\\times/g, "×")
    .replace(/\\pi/g, "π")
    .replace(/\\degree|°/g, "")
    .replace(/[{}\s]/g, "")
    // 나열형 답의 구분자 — "D > A > C > B" 와 "D, A, C, B" 는 같은 뜻인데
    // 구분자만 다르다. 소문항 구분자 쉼표("⑴ 70, ⑵ 35" vs "⑴ 70 ⑵ 35")도
    // 이걸로 접힌다. (2026-08-22 실측: J10201-5Y3Q·BVQQ)
    .replace(/[,>]/g, "")
    // 숫자 바로 뒤 개수 단위 — DB 는 "45개"처럼 단위를 남기고, 프롬프트는
    // finalAnswer 에 "값 자체"만 요구해 AI 는 "45"만 준다. 서술형 문장
    // 답(예: "소인수가 2와 5뿐")은 숫자로 안 끝나 이 규칙에 안 걸린다.
    .replace(/(\d)(개|가지)$/, "$1")
    // 잔여 백슬래시 쓸어내기 — `\ `(간격 명령) 는 `[{}\s]` 가 공백만 지우고
    // 백슬래시는 안 지워 "a=2\b" 처럼 남는다(2026-08-22 실측: J10201-F5EN).
    // 여기까지 왔으면 \frac·\sqrt·\times·\pi·\degree·\left·\right·\,·\;·\!
    // 는 이미 다 처리됐으므로, 남은 백슬래시는 전부 이런 찌꺼기다.
    .replace(/\\/g, "");
  return t;
}

/** content 의 번호 매김 보기("1. $85$\n2. $90$…")를 {번호: 값} 으로 뽑는다. */
function extractChoices(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const re = /(?:^|\n)\s*([1-5])[.)]\s*([^\n]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content))) map.set(m[1]!, m[2]!.trim());
  return map;
}

/** AI 가 「보기 번호」 대신 「값 자체」를 낸 경우를 구제한다 — finalAnswer 가
 *  본문 보기 중 정확히 하나와 값이 같으면 그 보기 번호로 취급한다. 값이
 *  둘 이상의 보기와 같으면(모호) 구제하지 않는다.
 *  (2026-08-22 실측: J10102-PWZN·RAE5 — AI 계산은 맞았는데 지시(「보기
 *  번호로」)를 안 지켜 "④" 대신 "18" 을 내 거짓 불일치가 났다.) */
function resolveViaChoices(
  content: string,
  finalAnswer: string,
): string | null {
  const choices = extractChoices(content);
  if (choices.size === 0) return null;
  const target = normalizeAnswer(finalAnswer);
  const matches = [...choices.entries()].filter(
    ([, v]) => normalizeAnswer(v) === target,
  );
  return matches.length === 1 ? matches[0]![0] : null;
}

function rendersClean(solution: string): boolean {
  const dollars = (solution.match(/\$/g) ?? []).length;
  if (dollars % 2 !== 0) return false;
  for (const seg of solution.match(/\$[^$]+\$/g) ?? []) {
    try {
      const html = katex.renderToString(seg.slice(1, -1), {
        throwOnError: false,
      });
      if (html.includes("katex-error") || html.includes("#cc0000"))
        return false;
    } catch {
      return false;
    }
  }
  return true;
}

async function main() {
  const files = process.argv.slice(2).filter((a) => a.endsWith(".json"));
  if (files.length === 0) throw new Error("생성 파일을 하나 이상 넘겨라");
  const gens: Gen[] = files.flatMap(
    (f) => JSON.parse(readFileSync(f, "utf8")) as Gen[],
  );
  console.log("생성 항목:", gens.length, "(파일", files.length, ")");

  const filled: Array<{
    id: string;
    code: string | null;
    before: string | null;
    after: string;
    finalAnswer: string;
  }> = [];
  const mismatches: Array<{
    id: string;
    code: string | null;
    dbAnswer: string;
    aiAnswer: string;
  }> = [];
  const skipped: Record<string, number> = {};
  const skipRows: Array<{ id: string; reason: string }> = [];
  let renderFail = 0;
  let alreadyHas = 0;

  for (const g of gens) {
    if ("skip" in g) {
      skipped[g.skip] = (skipped[g.skip] ?? 0) + 1;
      skipRows.push({ id: g.id, reason: g.skip });
      continue;
    }
    const row = await p.problem.findUnique({
      where: { id: g.id },
      select: {
        problemCode: true,
        answer: true,
        solution: true,
        content: true,
      },
    });
    if (!row) {
      skipped["행 없음"] = (skipped["행 없음"] ?? 0) + 1;
      continue;
    }
    if (row.solution && row.solution.trim() !== "") {
      alreadyHas += 1;
      continue;
    }
    const dbNorm = normalizeAnswer(row.answer ?? "");
    let aiFinal = g.finalAnswer;
    if (dbNorm !== normalizeAnswer(aiFinal)) {
      const resolved = resolveViaChoices(row.content, aiFinal);
      if (resolved && dbNorm === normalizeAnswer(resolved)) {
        aiFinal = resolved; // 값→보기번호 구제 성공
      } else {
        mismatches.push({
          id: g.id,
          code: row.problemCode,
          dbAnswer: row.answer ?? "",
          aiAnswer: g.finalAnswer,
        });
        continue;
      }
    }
    if (!rendersClean(g.solution)) {
      renderFail += 1;
      continue;
    }
    filled.push({
      id: g.id,
      code: row.problemCode,
      before: row.solution,
      after: g.solution.trim(),
      finalAnswer: g.finalAnswer,
    });
  }

  console.log(
    `채움 ${filled.length} · 답 불일치 ${mismatches.length} · 렌더 실패 ${renderFail} · 이미 있음 ${alreadyHas}`,
  );
  for (const [k, v] of Object.entries(skipped))
    console.log(`  건너뜀(${k}): ${v}`);
  for (const m of mismatches.slice(0, 10))
    console.log(
      `  불일치) ${m.code}: DB «${m.dbAnswer}» vs AI «${m.aiAnswer}»`,
    );

  if (!APPLY) {
    console.log("[dry-run] 실쓰기는 ALLOW_AI_SOLUTION=1");
    return;
  }

  // 원장 누적 — 줄어들면 멈춘다
  const prev = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf8")) as {
        rows: Array<{ id: string; before: string | null; after: string }>;
      })
    : { rows: [] };
  const byId = new Map(prev.rows.map((r) => [r.id, r]));
  for (const f of filled) {
    const old = byId.get(f.id);
    if (old)
      old.after = f.after; // 같은 문항 재적용 — 처음 before 유지
    else byId.set(f.id, { id: f.id, before: f.before, after: f.after });
  }
  if (byId.size < prev.rows.length) throw new Error("원장이 줄어든다 — 중단");
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        note: "Claude 생성 해설 (답 일치 시에만). apply-ai-solutions.ts",
        rows: [...byId.values()],
      },
      null,
      1,
    ),
    "utf8",
  );

  // 불일치도 누적 보존 — 정답 의심 목록
  const prevMis = existsSync(MISMATCH)
    ? (JSON.parse(readFileSync(MISMATCH, "utf8")) as typeof mismatches)
    : [];
  const misIds = new Set(prevMis.map((m) => m.id));
  writeFileSync(
    MISMATCH,
    JSON.stringify(
      [...prevMis, ...mismatches.filter((m) => !misIds.has(m.id))],
      null,
      1,
    ),
    "utf8",
  );

  // 건너뜀도 누적 — 내보내기가 이 목록을 빼야 매 배치 같은 문항을 다시 안 푼다
  const prevSkip = existsSync(SKIPLOG)
    ? (JSON.parse(readFileSync(SKIPLOG, "utf8")) as Array<{
        id: string;
        reason: string;
      }>)
    : [];
  const skipIds = new Set(prevSkip.map((r) => r.id));
  writeFileSync(
    SKIPLOG,
    JSON.stringify(
      [...prevSkip, ...skipRows.filter((r) => !skipIds.has(r.id))],
      null,
      1,
    ),
    "utf8",
  );

  let applied = 0;
  for (const f of filled) {
    await p.problem.update({
      where: { id: f.id },
      data: { solution: f.after },
    });
    applied += 1;
  }
  console.log(
    "적용:",
    applied,
    "· 원장 누적:",
    byId.size,
    "· 정답 의심 누적:",
    prevMis.length + mismatches.filter((m) => !misIds.has(m.id)).length,
  );
}
main().finally(() => p.$disconnect());
