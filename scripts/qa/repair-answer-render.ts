/**
 * **지면에 깨져 나가는 정답**을 학교 공식 정답면의 깨끗한 표기로 바꾼다 (트랙 B).
 *
 * 왜: `audit-answer-render.ts` 로 재 보니 정답 74건이 한글 수식 스크립트(HWP)나
 * 잘린 LaTeX 그대로다 — `$12$$f(x)=3x+`, `$-3le x`, `$53over57$전체 경우의 수는`.
 * KaTeX 가 못 읽어 원시 문자열이 그대로 인쇄된다. 값이 맞아도 학생은 답을 못 읽는다.
 *
 * 원인은 이관 단계다. `extract-final-batch.py` 가 HWP 의 `answer` 필드를 그대로
 * 옮겼는데, 그 필드에 한글 수식 스크립트와 풀이 조각이 섞여 있었다
 * (3자 대조에서 DB 와 HWP 가 **54건 전부 글자까지 같음**을 확인했다).
 *
 * **고치는 방향은 AI 가 아니라 원본이다.** 같은 시험지의 PDF 정답면에는 학교가
 * 인쇄한 깨끗한 답이 있다. 값이 같다는 것을 표기 규칙으로 확인한 뒤에만 바꾼다.
 *
 *   npx tsx scripts/qa/repair-answer-render.ts                    드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-answer-render.ts --apply
 *
 * PUA 원문자(①~⑤)는 여기 대상이 아니다 — `repair-answer-glyphs.ts` 가 따로 한다.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import {
  canon,
  canonLoose,
  hasBrokenGlyph,
  hasJunkGlyph,
  isSeeSolution,
  stripUnits,
} from "./answer-notation";
import { writeAppliedLog } from "./applied-log";

const OFFICIAL_DIR = "scripts/qa/reports/official-answers";
const BACKUP = "scripts/qa/reports/answer-render-repair.json";

/** KaTeX 가 못 읽어 원시 문자열로 떨어진 흔적. */
function failedRender(html: string): boolean {
  return (
    html.includes("math-raw") ||
    html.includes("katex-error") ||
    /#cc0000/i.test(html)
  );
}

/** 역슬래시 없는 HWP 수식 편집기 문법. `\sqrt{15}` 같은 정상 LaTeX 는 뺀다. */
const HWP_TOKEN =
  /(?<!\\)\b(?:over|sqrt|LEFT|RIGHT|ANGLE|TIMES|LEQ|GEQ|rarrow|dyad|cdots|bar|it|rm)\b/;

function broken(answer: string): boolean {
  if (answer.trim() === "" || answer.includes("정답 없음")) return false;
  const math = answer.match(/\$([^$]*)\$/g) ?? [];
  if (math.some((seg) => HWP_TOKEN.test(seg))) return true;
  // 여는 `$` 만 있고 닫히지 않은 것은 산출물이 잘린 흔적이다.
  if ((answer.match(/\$/g) ?? []).length % 2 === 1) return true;
  try {
    return failedRender(renderMathHtml(answer));
  } catch {
    return true;
  }
}

/** 공식 문자열을 지면에 그대로 인쇄해도 되는지. 훼손이면 null. */
function printable(official: string): string | null {
  if (hasJunkGlyph(official) || isSeeSolution(official)) return null;
  const text = official.replace(/√\s*⁄/g, "√").trim();
  if (text.includes("⁄")) return null;
  if (text.length === 0 || text.length > 60) return null;
  // 글자 뒤 숫자는 위첨자가 소실된 낌새다 (`e15`). 그대로 인쇄하면 틀린 값이 된다.
  if (/[A-Za-z]\d/.test(text)) return null;
  if (broken(text)) return null;
  return text;
}

/**
 * 값이 같다고 볼 수 있는지. **여기서는 좁게 본다** — 표기를 바꾸는 일이라
 * 값이 조금이라도 다르면 손대면 안 된다. 우리 쪽이 잘린 답이면 공식이 더 길 수 있어
 * 「공식이 우리 앞부분과 같다」도 허용한다.
 */
function sameValue(ours: string, official: string): boolean {
  if (canon(ours) === canon(official)) return true;
  if (stripUnits(ours) === stripUnits(official)) return true;
  if (canonLoose(ours) !== "" && canonLoose(ours) === canonLoose(official)) {
    return true;
  }
  // `$12$$f(x)=3x+` 처럼 답 뒤에 풀이가 붙어 잘린 것 — 앞머리가 공식과 같으면 같은 답이다.
  const head = /^\s*\$([^$]{1,40})\$/.exec(ours)?.[1];
  return head !== undefined && canon(head) === canon(official);
}

async function loadOfficial(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let files: string[] = [];
  try {
    files = (await readdir(OFFICIAL_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const file of files) {
    const doc = JSON.parse(await readFile(`${OFFICIAL_DIR}/${file}`, "utf-8"));
    for (const [number, item] of Object.entries(
      doc.items as Record<string, { parsed: string | null }>,
    )) {
      if (item.parsed) out.set(`${doc.examId}-${Number(number)}`, item.parsed);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const official = await loadOfficial();
  const prisma = new PrismaClient();
  try {
    // ⚠️ `source` 로 먼저 거른다. 트랙 C 가 RPM 행에 sumaek UUID 를 채우고 있어
    // `externalId` 형식을 가정하면 조용히 어긋난다.
    const rows = await prisma.problem.findMany({
      where: { source: "past_exam", externalId: { not: null } },
      select: { id: true, externalId: true, answer: true },
    });

    const ready: Array<{ id: string; externalId: string; before: string; after: string }> = [];
    const held: Array<{ externalId: string; reason: string }> = [];
    for (const row of rows) {
      if (hasBrokenGlyph(row.answer)) continue; // PUA 는 다른 도구 소관
      if (!broken(row.answer)) continue;
      const theirs = official.get(row.externalId as string);
      if (!theirs) {
        held.push({ externalId: row.externalId as string, reason: "공식 정답 없음" });
        continue;
      }
      const clean = printable(theirs);
      if (!clean) {
        held.push({ externalId: row.externalId as string, reason: "공식도 인쇄 불가" });
        continue;
      }
      if (!sameValue(row.answer, clean)) {
        held.push({ externalId: row.externalId as string, reason: "값이 같다고 볼 수 없다" });
        continue;
      }
      ready.push({
        id: row.id,
        externalId: row.externalId as string,
        before: row.answer,
        after: clean,
      });
    }

    console.log("── 깨진 정답 표기 복구 ──");
    console.log(`기출 ${rows.length}문항 · 깨진 것 ${ready.length + held.length}`);
    console.log(`  공식 표기로 바꿀 수 있음 ${ready.length}`);
    const byReason = new Map<string, number>();
    for (const h of held) byReason.set(h.reason, (byReason.get(h.reason) ?? 0) + 1);
    for (const [reason, n] of byReason) console.log(`  보류 — ${reason} ${n}`);
    for (const item of ready.slice(0, 5)) {
      console.log(
        `   ${item.externalId.padEnd(9)} ${JSON.stringify(item.before).slice(0, 42)} → ${JSON.stringify(item.after).slice(0, 34)}`,
      );
    }
    if (ready.length === 0) return;

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(BACKUP, JSON.stringify({ ready, held }, null, 1), "utf-8");
    console.log(`백업·보류 목록 → ${BACKUP}`);

    if (!apply) {
      console.log("\n드라이런이다. 반영하려면 --apply (+ ALLOW_SHARED_IMPORT=1)");
      return;
    }
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }
    const applied = [];
    let skipped = 0;
    for (const item of ready) {
      const current = await prisma.problem.findUnique({
        where: { id: item.id },
        select: { answer: true },
      });
      if (current?.answer !== item.before) {
        console.log(`   건너뜀 ${item.externalId} — 그 사이 값이 바뀌었다`);
        skipped += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: item.id },
        data: { answer: item.after },
      });
      applied.push(item);
    }
    const logPath = await writeAppliedLog(
      "phase2-render",
      "scripts/qa/repair-answer-render.ts",
      applied,
    );
    console.log(`
적용 — ${applied.length}건 복구 · 건너뜀 ${skipped}`);
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
