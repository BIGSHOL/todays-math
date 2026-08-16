/**
 * 분류 결과 중 **근거가 선 것만** 학교 공식 정답으로 교정한다 (트랙 B-1).
 *
 * 왜 골라 쓰나: `classify-answer-mismatch.ts` 의 「진짜오답」은 *DB 와 공식이 다르다*는
 * 뜻이지 *DB 가 틀렸다*는 뜻이 아니다. 표본 26건을 원본 지면과 맞춰 보니 절반 가까이가
 * 「같은 답을 다르게 적은 것」이었다. 그래서 갈래마다 근거의 종류를 나눠 적용한다:
 *
 * | 갈래 | 근거 | 기본 적용 |
 * |---|---|---|
 * | 공식복수정답 | 학교가 원문자를 더 적었다(복수정답 처리). 값 판단이 필요 없다 | ○ |
 * | 우리일부만 | 공식면에 소문항이 더 있고 겹치는 것은 일치한다. 우리 답이 불완전 | ○ |
 * | 값이다름·소문항불일치 | **DB 만 다르고 바깥 두 출처가 같을 때만** (`--three-way`) | ✕ |
 *
 * 인쇄될 값이므로 **공식 문자열이 지면에 그대로 나가도 되는지**를 따로 본다 —
 * 분수 가로선 잔재(`√⁄5`)는 고쳐 쓰고, 첨자가 소실된 낌새(`e15`)가 있으면 보류한다.
 *
 *   npx tsx scripts/qa/apply-official-answers.ts                       드라이런
 *   npx tsx scripts/qa/apply-official-answers.ts --three-way           3자 확정분까지
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-official-answers.ts --apply
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { hasJunkGlyph, isSeeSolution } from "./answer-notation";
import { writeAppliedLog } from "./applied-log";

const CLASSIFIED = "scripts/qa/reports/answer-mismatch-classified.json";
const THREE_WAY = "scripts/qa/reports/answer-3way.json";
const BACKUP = "scripts/qa/reports/answer-correction-backup.json";

/** 값 판단 없이 구조만으로 결론이 서는 갈래. */
const STRUCTURAL = new Set(["공식복수정답", "우리일부만"]);

interface Row {
  id: string;
  externalId: string;
  ours: string;
  official: string;
}

/**
 * 공식 문자열을 **지면에 그대로 인쇄해도 되게** 다듬는다.
 *
 * 정답면 텍스트 레이어는 근호 윗줄을 별도 글리프(U+2044)로 흘린다 — `√⁄5`.
 * 그건 되돌릴 수 있다. 되돌릴 수 없는 훼손은 `null` 을 내고 보류한다.
 */
function printable(official: string): { text: string; hold?: string } | null {
  if (hasJunkGlyph(official)) return null;
  if (isSeeSolution(official)) return null;
  const text = official.replace(/√\s*⁄/g, "√").trim();
  // 근호에 딸리지 않은 분수 가로선이 남았으면 수식이 뭉개진 것이다.
  if (text.includes("⁄")) return null;
  if (text.length === 0 || text.length > 60) return null;
  // 글자 뒤에 붙은 숫자는 위첨자가 소실된 낌새다 (`e15` = e¹⁵, `a2+b2` = a²+b²).
  // 아래첨자(`a1`)일 수도 있어 버리진 않고 **보류**로 표시한다.
  if (/[A-Za-z]\d/.test(text)) return { text, hold: "첨자 소실 의심" };
  return { text };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const useThreeWay = process.argv.includes("--three-way");

  const classified = JSON.parse(await readFile(CLASSIFIED, "utf-8")) as {
    rules: Array<{ rule: string; verdict: string; items: Row[] }>;
  };

  const picked = new Map<string, { row: Row; why: string }>();
  for (const group of classified.rules) {
    if (!STRUCTURAL.has(group.rule)) continue;
    for (const row of group.items) picked.set(row.id, { row, why: group.rule });
  }

  let threeWayCount = 0;
  if (useThreeWay) {
    try {
      const doc = JSON.parse(await readFile(THREE_WAY, "utf-8")) as {
        rows: Record<string, Row[]>;
      };
      for (const row of doc.rows["DB오답확정"] ?? []) {
        picked.set(row.id, { row, why: "3자확정" });
        threeWayCount += 1;
      }
    } catch {
      console.log(`(${THREE_WAY} 가 없다 — 3자 확정분은 건너뛴다)`);
    }
  }

  const ready: Array<{ row: Row; why: string; next: string }> = [];
  const held: Array<{ row: Row; why: string; reason: string }> = [];
  for (const { row, why } of picked.values()) {
    const safe = printable(row.official);
    if (!safe) {
      held.push({ row, why, reason: "공식 문자열을 인쇄할 수 없다" });
      continue;
    }
    if (safe.hold) {
      held.push({ row, why, reason: safe.hold });
      continue;
    }
    ready.push({ row, why, next: safe.text });
  }

  console.log("── 공식 정답으로 교정 ──");
  console.log(`고른 것 ${picked.size} (구조 근거 ${picked.size - threeWayCount} · 3자 확정 ${threeWayCount})`);
  console.log(`  적용 가능 ${ready.length} · 보류 ${held.length}`);
  const byReason = new Map<string, number>();
  for (const h of held) byReason.set(h.reason, (byReason.get(h.reason) ?? 0) + 1);
  for (const [reason, n] of byReason) console.log(`     보류 사유 — ${reason} ${n}`);
  for (const item of ready.slice(0, 5)) {
    console.log(
      `   ${item.row.externalId.padEnd(9)} [${item.why}] ${JSON.stringify(item.row.ours).slice(0, 28)} → ${JSON.stringify(item.next).slice(0, 34)}`,
    );
  }

  if (ready.length === 0) return;
  await mkdir("scripts/qa/reports", { recursive: true });
  await writeFile(
    BACKUP,
    JSON.stringify(
      {
        ready: ready.map((r) => ({
          id: r.row.id,
          externalId: r.row.externalId,
          why: r.why,
          before: r.row.ours,
          after: r.next,
        })),
        held: held.map((h) => ({
          id: h.row.id,
          externalId: h.row.externalId,
          why: h.why,
          reason: h.reason,
          ours: h.row.ours,
          official: h.row.official,
        })),
      },
      null,
      1,
    ),
    "utf-8",
  );
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
  const prisma = new PrismaClient();
  try {
    const applied = [];
    let skipped = 0;
    for (const item of ready) {
      // 그 사이 다른 트랙이 바꿨을 수 있다. 우리가 본 값일 때만 덮는다.
      const current = await prisma.problem.findUnique({
        where: { id: item.row.id },
        select: { answer: true },
      });
      if (current?.answer !== item.row.ours) {
        console.log(`   건너뜀 ${item.row.externalId} — 그 사이 값이 바뀌었다`);
        skipped += 1;
        continue;
      }
      await prisma.problem.update({
        where: { id: item.row.id },
        data: { answer: item.next },
      });
      applied.push({
        id: item.row.id,
        externalId: item.row.externalId,
        before: item.row.ours,
        after: item.next,
        why: item.why,
      });
    }
    const logPath = await writeAppliedLog(
      "phase3-structural",
      "scripts/qa/apply-official-answers.ts",
      applied,
    );
    console.log(`
적용 — ${applied.length}건 교정 · 건너뜀 ${skipped}`);
    console.log(`되돌리기 목록(이 단계만) → ${logPath}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
