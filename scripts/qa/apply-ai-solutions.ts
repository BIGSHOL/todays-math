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
  const circled = "①②③④⑤";
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
    .replace(/,$/, "");
  return t;
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
      select: { problemCode: true, answer: true, solution: true },
    });
    if (!row) {
      skipped["행 없음"] = (skipped["행 없음"] ?? 0) + 1;
      continue;
    }
    if (row.solution && row.solution.trim() !== "") {
      alreadyHas += 1;
      continue;
    }
    if (normalizeAnswer(row.answer ?? "") !== normalizeAnswer(g.finalAnswer)) {
      mismatches.push({
        id: g.id,
        code: row.problemCode,
        dbAnswer: row.answer ?? "",
        aiAnswer: g.finalAnswer,
      });
      continue;
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
