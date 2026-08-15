/**
 * `√` 뒤에 무엇이 오는지 분포를 센다 — `\sqrt{...}` 변환 규칙의 근거.
 *
 * 추측으로 정규식을 쓰면 `√ab` 를 `\sqrt{ab}` 로 볼지 `\sqrt{a}b` 로 볼지에서
 * 조용히 틀린다. 실제 데이터가 어떤 꼴인지 먼저 본다.
 *
 * 사용: node scripts/qa/scan-radical.mjs
 */
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

const rows = await db.problem.findMany({
  where: { OR: [{ content: { contains: "√" } }, { answer: { contains: "√" } }] },
  select: { content: true, answer: true },
});

const count = new Map();
const sample = new Map();

function bucket(tail) {
  if (tail.startsWith("{")) return "√{…}  중괄호";
  if (tail.startsWith("(")) return "√(…)  괄호";
  if (/^-/.test(tail)) return "√-…   음수";
  if (/^\d/.test(tail)) return "√숫자";
  if (/^\\/.test(tail)) return "√\\명령";
  if (/^[a-zA-Z]/.test(tail)) return "√문자";
  return `√기타 ${JSON.stringify(tail.slice(0, 3))}`;
}

for (const r of rows) {
  const text = `${r.content}\n${r.answer ?? ""}`;
  for (const m of text.matchAll(/√(.{0,8})/g)) {
    const k = bucket(m[1]);
    count.set(k, (count.get(k) ?? 0) + 1);
    if (!sample.has(k)) sample.set(k, `√${m[1]}`);
  }
}

console.log(`√ 포함 문항 ${rows.length}`);
console.log("건수  분류            예시");
for (const [k, v] of [...count].sort((a, b) => b[1] - a[1]).slice(0, 12)) {
  console.log(`${String(v).padStart(5)}  ${k.padEnd(15)} ${JSON.stringify(sample.get(k))}`);
}

// 숫자 뒤에 몇 자리까지 붙는지 — `√10` 을 `\sqrt{1}0` 으로 자르면 안 된다
const digits = new Map();
for (const r of rows) {
  for (const m of `${r.content}\n${r.answer ?? ""}`.matchAll(/√(\d+)/g)) {
    digits.set(m[1].length, (digits.get(m[1].length) ?? 0) + 1);
  }
}
console.log("\n√ 뒤 숫자 자릿수:", JSON.stringify(Object.fromEntries([...digits].sort())));

// 문자 뒤에 몇 글자가 이어지는지
const letters = new Map();
for (const r of rows) {
  for (const m of `${r.content}\n${r.answer ?? ""}`.matchAll(/√([a-zA-Z]+)/g)) {
    letters.set(m[1].length, (letters.get(m[1].length) ?? 0) + 1);
  }
}
console.log("√ 뒤 알파벳 길이:", JSON.stringify(Object.fromEntries([...letters].sort())));

await db.$disconnect();
