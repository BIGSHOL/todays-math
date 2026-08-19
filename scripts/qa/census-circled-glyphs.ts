/**
 * 발견기 — **«둘러싼 숫자»가 실제로 어떤 계열로 들어와 있나.**
 *
 * ## 왜 이걸 세나
 *
 * `scripts/qa/` 안에 원문자 목록이 **손으로 열세 벌** 적혀 있다
 * (`answer-notation.ts:147` · `classify-answer-mismatch.ts:56` · `choiceFigureRules.ts:42`
 *  · `figrefRuler.ts:115` · `load-answer-backfill.ts:42` … ). 전부 `①..⑩` 나 `①..⑮` 다.
 *
 * CLAUDE.md 2026-08-18 이 적어 둔 그 자리다 — **목록을 손으로 쓰면 세는 쪽과
 * 고치는 쪽이 같이 눈이 먼다.** 목록에 없는 계열은 «0 건» 이 되고, 0 인 줄도 모른다.
 *
 * 그래서 **무엇이 원문자인지 미리 정하지 않는다.** 유니코드에서 «둘러싼 숫자» 성질을
 * 가진 계열을 코드포인트 산술로 훑고, 컬럼마다 **실제 건수**를 센다.
 * 어느 목록이 새는지는 이 숫자가 정한다 — 추측이 아니라.
 *
 * 사용:
 *   npx tsx scripts/qa/census-circled-glyphs.ts
 *   npx tsx scripts/qa/census-circled-glyphs.ts --samples 5
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 계열의 **시작 코드포인트만** 적고 번호는 계산한다.
 * 손으로 글자를 나열하지 않는 이유는 파일 머리 주석에 있다.
 */
const FAMILIES = [
  { base: 0x2460, size: 20, name: "① 원문자 (U+2460)" },
  { base: 0x2776, size: 10, name: "❶ 검은 원문자 (U+2776)" },
  { base: 0x2780, size: 10, name: "➀ 산세리프 (U+2780)" },
  { base: 0x278a, size: 10, name: "➊ 검은 산세리프 (U+278A)" },
  { base: 0x24f5, size: 10, name: "⓵ 겹원 (U+24F5)" },
  { base: 0x3251, size: 15, name: "㉑ 21~35 (U+3251)" },
  { base: 0x32b1, size: 15, name: "㊱ 36~50 (U+32B1)" },
] as const;

/** 이 저장소의 손 목록이 **실제로 아는** 범위 — 열세 벌이 전부 이 안이다. */
const HAND_LISTED = new Set(
  Array.from({ length: 15 }, (_, i) => String.fromCodePoint(0x2460 + i)),
);

type Col = "answer" | "content" | "solution";
const COLS: Col[] = ["answer", "content", "solution"];

async function main() {
  const showSamples = process.argv.includes("--samples");
  const rows = await prisma.problem.findMany({
    select: { id: true, answer: true, content: true, solution: true },
  });
  console.log(`분모: problem 전량 ${rows.length.toLocaleString()}건\n`);

  // 계열 × 컬럼 = 그 계열 글자가 하나라도 든 **행** 수
  const hit = new Map<string, Map<Col, Set<string>>>();
  const sample = new Map<string, string>();
  // 손 목록 **밖**의 글자만 따로 — 이게 「아무도 목록에 안 적은 것」이다
  const blind = new Map<Col, Set<string>>(COLS.map((c) => [c, new Set()]));

  for (const r of rows) {
    for (const col of COLS) {
      const v = r[col];
      if (!v) continue;
      for (const ch of v) {
        const cp = ch.codePointAt(0)!;
        const fam = FAMILIES.find((f) => cp >= f.base && cp < f.base + f.size);
        if (!fam) continue;
        if (!hit.has(fam.name)) hit.set(fam.name, new Map());
        const m = hit.get(fam.name)!;
        if (!m.has(col)) m.set(col, new Set());
        m.get(col)!.add(r.id);
        if (!HAND_LISTED.has(ch)) blind.get(col)!.add(r.id);
        if (!sample.has(fam.name + col))
          sample.set(
            fam.name + col,
            `${r.id.slice(0, 8)} ${col}: ${v.slice(0, 90)}`,
          );
      }
    }
  }

  console.log("=== 계열 × 컬럼 — 그 계열이 든 **행** 수 ===");
  console.log("계열".padEnd(28) + COLS.map((c) => c.padStart(10)).join(""));
  for (const f of FAMILIES) {
    const m = hit.get(f.name);
    const cells = COLS.map((c) =>
      String(m?.get(c)?.size ?? 0).padStart(10),
    ).join("");
    console.log(f.name.padEnd(28) + cells);
  }

  console.log(
    "\n=== 🔴 손 목록(①..⑮) **밖** — 열세 벌이 구조적으로 못 세는 것 ===",
  );
  for (const c of COLS) {
    console.log(`  ${c.padEnd(10)} ${blind.get(c)!.size.toLocaleString()}행`);
  }
  const all = new Set<string>();
  for (const c of COLS) for (const id of blind.get(c)!) all.add(id);
  console.log(`  ${"합(중복 제거)".padEnd(10)} ${all.size.toLocaleString()}행`);

  if (showSamples) {
    console.log("\n=== 표본 ===");
    for (const [k, v] of sample) console.log(`  [${k}] ${v}`);
  }

  await prisma.$disconnect();
}

main().catch(async (e) => {
  await prisma.$disconnect();
  throw e;
});
