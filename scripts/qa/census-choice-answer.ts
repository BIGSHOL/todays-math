/**
 * **발견기** — 「정답과 보기의 관계」를 **무엇이 결함인지 미리 정하지 않고** 센다.
 *
 *   npx tsx scripts/qa/census-choice-answer.ts
 *   npx tsx scripts/qa/census-choice-answer.ts --min 1   (전량 나열)
 *
 * ## 왜 판정기와 따로 두는가
 *
 * 판정기(`answerChoiceRules.ts`)는 «무엇이 결함인가»를 안다고 가정한다. 그러면
 * 목록에 없는 부류는 **구조적으로 0** 이 된다 — 이 저장소가 `le`/`ge` 에서 당한
 * 자리다(CLAUDE.md 2026-08-18). 그래서 이 자는 판정을 하지 않고 **축을 갈라
 * 전량을 늘어놓기만** 한다. 사람이 표를 보고 부류를 발견한다.
 *
 * 축은 넷이고 전부 «기계가 셀 수 있는 사실» 이다:
 *
 *   ㉠ 정답 **첫 글자** 별 빈도 — 표기 계열을 발견한다(➀ 와 PUA 를 이렇게 찾았다)
 *   ㉡ (정답이 가리키는 번호) × (지면에 찍히는 보기 칸 수) × (읽은 근거) 전량
 *   ㉢ 지면에 찍히는 보기의 **원래 번호 배열** 패턴 별 빈도
 *   ㉣ 본문 줄머리에 오는 **비ASCII·비한글 문자** 빈도 — 파서가 못 읽는 마커를 찾는다
 *
 * 그리고 **규칙이 못 읽은 것을 반드시 찍는다** — 「둘러싸인 숫자처럼 생겼는데
 * 규칙의 계열 밖인 문자」와 「판정 불가」. 0으로 뭉개면 새는 줄 모른다.
 * 일부러 뺀 계열은 **이유와 함께** 따로 찍어, 마지막 줄에는 «아무도 목록에 안 적은
 * 것»만 남게 한다.
 */
import { PrismaClient } from "@prisma/client";

import {
  choiceLabels,
  circledValue,
  knownCircledGlyphs,
  readAnswerRef,
} from "./answerChoiceRules";

const prisma = new PrismaClient();

interface Row {
  id: string;
  content: string;
  answer: string;
}

/**
 * 「둘러싸인 무언가처럼 보이는가」 — 규칙의 계열과 **무관하게** 유니코드 **블록**으로 본다.
 * 규칙(`CIRCLED_FAMILIES`)은 이 블록들의 일부만 안다. 차집합이 곧 «규칙이 못 읽는 것»이다.
 */
const ENCLOSED_BLOCKS: readonly (readonly [number, number])[] = [
  [0x2460, 0x24ff], // Enclosed Alphanumerics
  [0x2776, 0x2793], // Dingbats — circled digits
  [0x3200, 0x32ff], // Enclosed CJK Letters and Months
  [0x1f100, 0x1f1ff], // Enclosed Alphanumeric Supplement
];
const looksEnclosed = (ch: string): boolean => {
  const cp = ch.codePointAt(0);
  return (
    cp !== undefined && ENCLOSED_BLOCKS.some(([lo, hi]) => cp >= lo && cp <= hi)
  );
};

/**
 * 둘러싸인 글자 중 **일부러 보기 번호에서 뺀 것**. 빼는 이유를 적어 둔다 —
 * 그래야 마지막 줄에 «아무도 목록에 안 적은 것»만 남는다.
 *   · U+2474~U+249B — ⑴ ⑵ 는 세부문항 마커다. 보기 번호가 아니다.
 *   · U+3200~U+32FF — ㉠ ㈎ 같은 **상자 라벨**이다. 보기 번호가 아니다.
 * 둘 다 제품 파서의 마커 정규식에도 없다 — 지면은 이것들을 보기로 그리지 않는다.
 */
const DELIBERATELY_EXCLUDED: readonly (readonly [number, number, string])[] = [
  [0x2474, 0x249b, "괄호 숫자 — 세부문항 마커"],
  [0x3200, 0x32ff, "둘러싸인 한글·CJK — 상자 라벨"],
];
const excludedReason = (ch: string): string | null => {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return null;
  const hit = DELIBERATELY_EXCLUDED.find(([lo, hi]) => cp >= lo && cp <= hi);
  return hit ? hit[2] : null;
};

type Bucket = { n: number; ids: string[] };
const add = (map: Map<string, Bucket>, key: string, id: string) => {
  const t = map.get(key) ?? { n: 0, ids: [] };
  t.n += 1;
  if (t.ids.length < 6) t.ids.push(id);
  map.set(key, t);
};

function print(title: string, map: Map<string, Bucket>, min: number) {
  const sorted = [...map].sort((a, b) => b[1].n - a[1].n);
  const shown = sorted.filter(([, t]) => t.n >= min);
  console.log(`\n## ${title} — ${sorted.length}종`);
  for (const [k, t] of shown) {
    const ex =
      t.n <= 6 ? `   ex ${t.ids.map((i) => i.slice(0, 8)).join(" ")}` : "";
    console.log(`  ${String(t.n).padStart(7)}  ${k}${ex}`);
  }
  const hidden = sorted.length - shown.length;
  if (hidden > 0)
    console.log(`  … ${min}건 미만 ${hidden}종은 접었다 (--min 1 로 전량)`);
}

const codeLabel = (ch: string) =>
  `${JSON.stringify(ch)} U+${ch
    .codePointAt(0)!
    .toString(16)
    .toUpperCase()
    .padStart(4, "0")}`;

async function main(): Promise<void> {
  const flag = process.argv.indexOf("--min");
  const min = flag >= 0 ? Number(process.argv[flag + 1] ?? 1) : 20;

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer
       FROM problem
      WHERE pool = 'shared' AND review_status = 'approved'
        AND direct_use_allowed = true AND answer <> '(정답 없음)'
      ORDER BY id`,
  )) as Row[];
  console.log(`# 발견기 — 출제 가능 풀 ${rows.length}건 (판정하지 않는다)`);

  const firstChar = new Map<string, Bucket>();
  const cross = new Map<string, Bucket>();
  const labelPattern = new Map<string, Bucket>();
  const lead = new Map<string, Bucket>();
  const outsideAlphabet = new Map<string, Bucket>();
  const excludedTally = new Map<string, Bucket>();
  const unjudgeable: string[] = [];
  let unjudgeableCount = 0;

  const known = new Set(knownCircledGlyphs());

  for (const r of rows) {
    /* ㉠ */
    add(
      firstChar,
      codeLabel([...(r.answer ?? "").trim()][0] ?? "(빈값)"),
      r.id,
    );

    /* ㉣ */
    for (const m of (r.content ?? "").matchAll(/\n[ \t]*([^\s])/g)) {
      const ch = m[1]!;
      const cp = ch.codePointAt(0)!;
      if (cp < 0x80 || /[가-힣ㄱ-ㅎㅏ-ㅣ]/.test(ch)) continue;
      const mark = circledValue(ch) > 0 ? "  ← 규칙이 번호로 읽는다" : "";
      add(lead, `${codeLabel(ch)}${mark}`, r.id);
    }

    /* 규칙의 계열 밖인데 둘러싸인 글자 */
    for (const ch of (r.answer ?? "").trim().slice(0, 3)) {
      if (known.has(ch) || !looksEnclosed(ch) || circledValue(ch) > 0) continue;
      const reason = excludedReason(ch);
      add(
        reason ? excludedTally : outsideAlphabet,
        `${codeLabel(ch)}${reason ? `  (일부러 뺌: ${reason})` : ""}`,
        r.id,
      );
    }

    /* ㉡ ㉢ */
    const labelled = choiceLabels(r.content ?? "");
    if (labelled === null) {
      unjudgeableCount += 1;
      if (unjudgeable.length < 10) unjudgeable.push(r.id);
      continue;
    }
    const ref = readAnswerRef(r.answer ?? "", labelled.bodies, labelled.labels);
    const num = ref.nums.length ? Math.max(...ref.nums) : 0;
    add(
      cross,
      `정답번호 ${num} × 보기칸 ${labelled.labels.length} · 근거 ${ref.basis}`,
      r.id,
    );
    const dropped = labelled.dropped.length
      ? ` 버려짐[${labelled.dropped.join(",")}]`
      : "";
    add(labelPattern, `[${labelled.labels.join(",")}]${dropped}`, r.id);
  }

  print("㉠ 정답 첫 글자", firstChar, min);
  print(
    "㉡ (정답이 가리키는 번호) × (지면 보기 칸 수) × (읽은 근거)",
    cross,
    min,
  );
  print("㉢ 지면 보기의 «원래 번호» 배열", labelPattern, min);
  print("㉣ 본문 줄머리의 비ASCII·비한글 문자", lead, Math.max(min, 20));

  console.log(`\n## 규칙이 못 읽은 것 (0으로 뭉개지 않는다)`);
  const ex = unjudgeable.length
    ? `  ex ${unjudgeable.map((i) => i.slice(0, 8)).join(" ")}`
    : "";
  console.log(
    `  판정 불가(제품 파서와 본문 대조 실패) ${unjudgeableCount}건${ex}`,
  );
  console.log(`\n  일부러 뺀 계열 — 이유를 적어 둔 것:`);
  if (excludedTally.size === 0) console.log(`     (없음)`);
  for (const [k, t] of [...excludedTally].sort((a, b) => b[1].n - a[1].n))
    console.log(`     ${String(t.n).padStart(5)}  ${k}`);

  console.log(
    `\n  아무도 목록에 안 적은 것 (둘러싸인 숫자처럼 생겼는데 규칙 밖):`,
  );
  if (outsideAlphabet.size === 0) {
    console.log(`     0종`);
  } else {
    for (const [k, t] of [...outsideAlphabet].sort((a, b) => b[1].n - a[1].n))
      console.log(
        `     🔴 ${String(t.n).padStart(5)}  ${k}   ex ${t.ids
          .map((i) => i.slice(0, 8))
          .join(" ")}`,
      );
  }
  await prisma.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
