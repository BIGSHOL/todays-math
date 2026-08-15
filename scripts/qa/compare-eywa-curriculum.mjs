/**
 * eywa 교육과정 원본(MATH_CURRICULUM) ↔ 우리 Unit 트리 대조.
 *
 * 우리 단원 시드는 eywa 의 `curriculum.ts` 에서 생성했다(T0.3). 그 뒤 양쪽이
 * 갈라졌는지 확인한다. 원본은 코드 파일이라 손으로 옮기지 말고 객체 리터럴만
 * 브레이스 매칭으로 떼어 평가한다(CLAUDE.md Lessons Learned 2026-08-13).
 *
 *   node scripts/qa/compare-eywa-curriculum.mjs
 *   EYWA_CURRICULUM=<경로> node scripts/qa/compare-eywa-curriculum.mjs
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const SRC =
  process.env.EYWA_CURRICULUM ??
  String.raw`C:\Creative\eywa\src\features\onescreen\curriculum.ts`;
const ANCHOR = "export const MATH_CURRICULUM";

function extractLiteral(text) {
  const at = text.indexOf(ANCHOR);
  if (at < 0) throw new Error(`${ANCHOR} 를 찾지 못했다: ${SRC}`);
  const open = text.indexOf("{", text.indexOf("=", at));
  let depth = 0;
  let inStr = null;
  for (let i = open; i < text.length; i += 1) {
    const c = text[i];
    if (inStr) {
      if (c === "\\") i += 1;
      else if (c === inStr) inStr = null;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") inStr = c;
    else if (c === "/" && text[i + 1] === "/") i = text.indexOf("\n", i);
    else if (c === "{") depth += 1;
    else if (c === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(open, i + 1);
    }
  }
  throw new Error("객체 리터럴이 닫히지 않았다");
}

const raw = new Function(`return (${extractLiteral(readFileSync(SRC, "utf-8"))})`)();

/**
 * 학년 라벨 표기 차이를 흡수한다. eywa 는 로마숫자("미적분Ⅰ"), 우리는
 * 아라비아 숫자("미적분1")를 쓴다 — T0.3 시드 때 의도한 표기다.
 * 여기서 흡수하지 않으면 같은 데이터가 57건 차이로 보인다.
 */
const GRADE_LABEL = { 미적분Ⅰ: "미적분1", 미적분Ⅱ: "미적분2" };
const normGrade = (g) => GRADE_LABEL[g] ?? g;

// eywa: { 학년: [{ unit, lessons: [...] }] }  →  Set("학년||단원||차시")
const eywa = new Map();
for (const [grade, units] of Object.entries(raw)) {
  for (const u of units) {
    for (const lesson of u.lessons)
      eywa.set(`${normGrade(grade)}||${u.unit}||${lesson}`, true);
  }
}

const prisma = new PrismaClient();
const rows = await prisma.unit.findMany({
  select: { grade: true, chapter: true, section: true },
  orderBy: { orderIndex: "asc" },
});
await prisma.$disconnect();

const EYWA_GRADES = new Set(Object.keys(raw).map(normGrade));
const ours = new Map();
for (const r of rows) ours.set(`${r.grade}||${r.chapter}||${r.section}`, true);

const oursInScope = [...ours.keys()].filter((k) => EYWA_GRADES.has(k.split("||")[0]));
const missing = [...eywa.keys()].filter((k) => !ours.has(k)); // 원본엔 있고 우리엔 없음
const extra = oursInScope.filter((k) => !eywa.has(k)); // 우리에만 있음

const outOfScope = rows.filter((r) => !EYWA_GRADES.has(r.grade));
const byGrade = new Map();
for (const r of outOfScope) byGrade.set(r.grade, (byGrade.get(r.grade) ?? 0) + 1);

console.log(`원본: ${SRC}`);
console.log(`eywa 학년 ${EYWA_GRADES.size}개 · 차시 ${eywa.size}`);
console.log(`우리 트리 전체 ${rows.length} · eywa 범위 ${oursInScope.length}`);
console.log(`\n일치 ${oursInScope.length - extra.length} · 원본에만 있음 ${missing.length} · 우리에만 있음 ${extra.length}`);
console.log(`eywa 범위 밖: ${[...byGrade].map(([g, n]) => `${g} ${n}`).join(" · ")}`);

const head = (label, list) => {
  if (!list.length) return;
  console.log(`\n── ${label} (${list.length}) ──`);
  for (const k of list.slice(0, 25)) console.log("   " + k.replaceAll("||", " / "));
  if (list.length > 25) console.log(`   … 외 ${list.length - 25}건`);
};
head("원본에만 있음 — 우리 트리에 누락", missing);
head("우리에만 있음 — 원본과 다름", extra);
