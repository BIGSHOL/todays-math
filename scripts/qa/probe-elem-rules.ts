/**
 * 초등 생성기 230문항에 가드를 댄다 — 원장님 육안 검수(2026-08-22) 결함을 규칙으로 접은 것.
 * 원장: `docs/planning/tracks/elem-engine-review-20260822.md`
 *
 *   npx tsx scripts/qa/probe-elem-rules.ts            # 전체
 *   npx tsx scripts/qa/probe-elem-rules.ts 초3        # 한 학년만
 *   npx tsx scripts/qa/probe-elem-rules.ts 초3 --list # 걸린 것 전량 나열
 *
 * 「끝났다」 = 이 스크립트가 **전 규칙 0** 을 찍는 것.
 */
import {
  elementaryUnits,
  generateElementaryProblem,
} from "../../src/lib/elementary/generate";
import {
  arabicPolygons,
  bareNumbers,
  runawayDecimals,
  tooAdvanced,
  unfilledPlaceholders,
} from "../../src/lib/elementary/rules";

/** 다양성을 재는 씨앗들. 하나로는 「늘 같은 도형」이 구조적으로 안 보인다. */
const SEEDS = [20260821, 7, 1234, 99991, 20260822, 555, 31337, 4242];

const gradeArg = process.argv.slice(2).find((a) => a.startsWith("초"));
const listAll = process.argv.includes("--list");

/**
 * R9-b — 씨앗이 달라도 **그림**이 늘 같으면 결함이다.
 *
 * 함수로 빼 둔 이유: 지금 실측 위반이 **0**이라(그림 붙는 소단원 85개 전량 갈림)
 * 전량 검사만으로는 **이 규칙이 걸릴 수 있는지조차 알 수 없다.**
 * 0은 「깨끗」과 「못 셈」을 구분해 주지 않으므로 아래 `--selftest` 로 직접 시험한다.
 */
export function figureIsFixed(specs: (unknown | null)[]): boolean {
  const json = specs.map((s) => JSON.stringify(s ?? null));
  return json.some((j) => j !== "null") && new Set(json).size === 1;
}

if (process.argv.includes("--selftest")) {
  const rows: [string, boolean, boolean][] = [
    [
      "그림이 늘 같다 — 걸려야",
      figureIsFixed([{ kind: "a" }, { kind: "a" }, { kind: "a" }]),
      true,
    ],
    [
      "그림이 갈린다 — 통과해야",
      figureIsFixed([{ kind: "a" }, { kind: "b" }, { kind: "a" }]),
      false,
    ],
    ["그림이 아예 없다 — 통과해야", figureIsFixed([null, null, null]), false],
    [
      "한 씨앗만 그림이 없다 — 걸리면 안 됨",
      figureIsFixed([{ kind: "a" }, null, { kind: "a" }]),
      false,
    ],
    [
      "같은 kind 인데 값이 다르다 — 통과해야",
      figureIsFixed([{ k: 1 }, { k: 2 }]),
      false,
    ],
  ];
  let bad = 0;
  for (const [why, got, want] of rows) {
    if (got !== want) bad += 1;
    console.log(`  ${got === want ? "✅" : "❌"} ${why}`);
  }
  console.log(
    bad === 0 ? "\n✅ R9-b 눈금 5건 (양성 1 · 음성 4)" : `\n❌ ${bad}건 어긋남`,
  );
  process.exit(bad === 0 ? 0 : 1);
}

const units = elementaryUnits().filter(
  (u) => !gradeArg || u.grade === gradeArg,
);

type Hit = { rule: string; where: string; detail: string };
const hits: Hit[] = [];
const add = (rule: string, where: string, detail: string) =>
  hits.push({ rule, where, detail });

/** 발문 중복은 **전체** 를 봐야 한다 — 학년을 걸러도 분모는 230 이다. */
const allByContent = new Map<string, string>();
for (const unit of elementaryUnits()) {
  const p = generateElementaryProblem(unit);
  const where = `${p.grade} ${p.section}`;
  const prev = allByContent.get(p.content);
  if (prev) {
    if (!gradeArg || p.grade === gradeArg) {
      add("R5 발문중복", where, `= ${prev}`);
    }
  } else {
    allByContent.set(p.content, where);
  }
}

for (const unit of units) {
  const p = generateElementaryProblem(unit);
  const where = `${p.grade} ${p.section}`;
  const all = `${p.content}\n${p.answer}\n${p.solution}`;

  const bare = [
    ...bareNumbers(p.content).map((x) => `발문:${x}`),
    ...bareNumbers(p.answer).map((x) => `정답:${x}`),
    ...bareNumbers(p.solution).map((x) => `해설:${x}`),
  ];
  if (bare.length) add("R1 KaTeX밖숫자", where, bare.slice(0, 6).join(" "));

  const dec = runawayDecimals(all);
  if (dec.length) add("R2 샌소수", where, dec[0]!);

  const adv = tooAdvanced(p.orderIndex, p.solution);
  if (adv.length) add("R3 학년밖연산", where, adv.join(","));

  const poly = [...arabicPolygons(all), ...unfilledPlaceholders(all)];
  if (poly.length) add("R4 도형이름", where, poly.join(","));

  // R9 — 씨앗을 바꿔도 문항이 통째로 같으면 단조롭다.
  // 원장님: 「항상 도형은 다양할수록 좋음. 너무 단조로우면 재미도 학습의욕도 떨어짐」
  const items = SEEDS.map((s) => generateElementaryProblem(unit, s));
  const variants = new Set(items.map((i) => i.content));
  if (variants.size === 1)
    add("R9 고정문항", where, `씨앗 ${SEEDS.length}개 전부 동일`);

  // R9-b — **그림**도 갈려야 한다.
  //
  // ⚠️ 위 검사는 `content` **만** 본다. 그런데 원장님의 **첫 번째** 지적이
  // 「직각인 도형의 기호를 쓰라고했는데 … **문제마다 똑같은 도형 출제하지말고**」였다 —
  // 즉 **그림**이었다. 발문만 갈리고 그림이 늘 같으면 그 결함은 구조적으로 안 보인다.
  // elem-g4 가 「R9 는 figureSpec 을 안 본다」고 짚어 줘서 알았다(2026-08-22).
  //
  // 지금 실측 위반 0(그림 붙는 소단원 85개 전량 갈림)이라 **회귀 방지용**이다.
  // 일부러 한 가지 그림만 써야 하는 소단원이 생기면 여기에 걸린다 — 그때 근거를 남기면 된다.
  if (figureIsFixed(items.map((i) => i.figureSpec ?? null))) {
    add(
      "R9 고정그림",
      where,
      `발문 ${variants.size}가지인데 그림은 씨앗 ${SEEDS.length}개 전부 동일`,
    );
  }
}

const byRule = new Map<string, Hit[]>();
for (const h of hits) {
  if (!byRule.has(h.rule)) byRule.set(h.rule, []);
  byRule.get(h.rule)!.push(h);
}

console.log(`대상 소단원 ${units.length}${gradeArg ? ` (${gradeArg})` : ""}\n`);
if (hits.length === 0) {
  console.log("✅ 전 규칙 0");
} else {
  for (const [rule, list] of [...byRule].sort(
    (a, b) => b[1].length - a[1].length,
  )) {
    console.log(`${rule.padEnd(16)} ${String(list.length).padStart(4)}`);
    for (const h of listAll ? list : list.slice(0, 4)) {
      console.log(`      · ${h.where} → ${h.detail}`);
    }
    if (!listAll && list.length > 4)
      console.log(`      … ${list.length - 4}건 더 (--list)`);
  }
  console.log(`\n합계 ${hits.length}건`);
}
process.exitCode = hits.length === 0 ? 0 : 1;
