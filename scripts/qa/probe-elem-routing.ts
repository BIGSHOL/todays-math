/**
 * 소단원 이름이 **서로를 포함해서** 갈래가 죽는 자리를 찾는다.
 *
 * 왜 필요한가 — elem-g5 가 2026-08-22 에 실물로 겪었다:
 *
 *     "반올림 알아보기와 어림의 활용".includes("올림")  //  ← **true**
 *
 * 「반올림」소단원이 **「올림」갈래로 샜다.** 그런데 올림도 반올림도 정답 계산은 맞으니
 * `probe-elem-rules`(표기) · `probe-elem-section-conditions`(조건) · `probe-elem-arithmetic`(값)
 * **셋 다 초록**이었다. 갈래가 죽었다는 것은 어느 지표에도 안 나타난다.
 * 변이 시험이 「반올림을 버림으로 바꿔도 초록」이라 그제서야 드러났다.
 *
 * 이 검사는 **생성기 원문**에서 `s.includes("…")` 낱말을 뽑아,
 * 「짧은 낱말이 긴 낱말보다 **먼저** 판정되는」 짝을 찾는다. 그게 곧 죽은 갈래다.
 *
 *   npx tsx scripts/qa/probe-elem-routing.ts
 *   npx tsx scripts/qa/probe-elem-routing.ts --selftest
 *
 * ⚠️ 「위험한 짝이 0」은 「갈래가 다 산다」가 아니다 — 이 검사는 `includes` 로 가르는
 * 자리만 본다. 그래서 **본 낱말 수를 반드시 함께 찍는다.**
 */
import { readFileSync } from "node:fs";
import { elementaryUnits } from "../../src/lib/elementary/generate";

const FILES = ["g3", "g4", "g5", "g6"] as const;

/**
 * 원문에 나온 순서대로 `s.includes("…")` / `section.includes("…")` 의 낱말을 뽑되,
 * **어느 함수 안인지**를 함께 적는다.
 *
 * ⚠️ 함수 경계를 안 보면 **거짓 경보가 쏟아진다.** 실측(2026-08-22): 파일 전체를 한
 * 덩어리로 읽었더니 g5 에서 7건이 잡혔는데 **전부 거짓**이었다 —
 * `includes("소수")` 는 `reduce()` 안이고 `includes("(1보다 작은 소수)×(자연수)")` 는
 * `decMul()` 안이라 **서로 경쟁하지 않는다.** 다른 갈래는 서로를 못 막는다.
 * **거짓 경보는 가드를 끈다.**
 */
function needlesOf(src: string): { needle: string; at: number; fn: string }[] {
  // 최상위 함수 시작점 — 줄 첫머리의 `function 이름(` 만 센다(중첩·화살표는 제외).
  const bounds: { name: string; at: number }[] = [];
  for (const m of src.matchAll(/^function\s+(\w+)\s*\(/gm)) {
    bounds.push({ name: m[1]!, at: m.index! });
  }
  const fnAt = (at: number) => {
    let name = "(파일 최상위)";
    for (const b of bounds) {
      if (b.at > at) break;
      name = b.name;
    }
    return name;
  };
  const out: { needle: string; at: number; fn: string }[] = [];
  for (const m of src.matchAll(
    /\b(?:s|section|name)\.includes\(\s*"([^"]+)"\s*\)/g,
  )) {
    out.push({ needle: m[1]!, at: m.index!, fn: fnAt(m.index!) });
  }
  return out;
}

/**
 * 죽은 갈래: 낱말 A 가 낱말 B 의 **일부**이고(A ⊂ B), 원문에서 **A 가 먼저** 판정된다면,
 * B 를 이름에 가진 소단원은 **B 갈래에 영영 못 간다.**
 */
type Risk = {
  file: string;
  fn: string;
  shortNeedle: string;
  longNeedle: string;
  sections: string[];
};

function risks(file: string, src: string, sections: string[]): Risk[] {
  const ns = needlesOf(src);
  const out: Risk[] = [];
  for (const a of ns) {
    for (const b of ns) {
      if (a.needle === b.needle) continue;
      if (a.fn !== b.fn) continue; // 다른 갈래끼리는 서로를 못 막는다
      if (!b.needle.includes(a.needle)) continue; // A ⊂ B 만 본다
      if (a.at >= b.at) continue; // A 가 **먼저** 판정될 때만 위험하다
      const hit = sections.filter((s) => s.includes(b.needle));
      if (hit.length > 0) {
        out.push({
          file,
          fn: a.fn,
          shortNeedle: a.needle,
          longNeedle: b.needle,
          sections: hit,
        });
      }
    }
  }
  return out;
}

// ── 눈금 ───────────────────────────────────────────────────────────────
if (process.argv.includes("--selftest")) {
  const 걸려야 = risks(
    "fixture",
    `if (s.includes("올림")) return up();\nif (s.includes("반올림")) return round();`,
    ["2-1-6 반올림 알아보기와 어림의 활용"],
  );
  const 걸리면안됨_순서 = risks(
    "fixture",
    `if (s.includes("반올림")) return round();\nif (s.includes("올림")) return up();`,
    ["2-1-6 반올림 알아보기와 어림의 활용"],
  );
  const 걸리면안됨_무관 = risks(
    "fixture",
    `if (s.includes("넓이")) return a();\nif (s.includes("둘레")) return b();`,
    ["1-6-1 넓이 알아보기", "1-6-2 둘레 알아보기"],
  );
  const 걸리면안됨_다른함수 = risks(
    "fixture",
    `function reduce61(u, r) {
  if (s.includes("소수")) return dec();
}
function decMul61(u, r) {
  if (s.includes("(1보다 작은 소수)×(자연수)")) return m();
}`,
    ["2-4-1 (1보다 작은 소수)×(자연수)의 계산"],
  );
  const rows: [string, number, number][] = [
    ["짧은 낱말이 먼저 — 반올림이 올림으로 샌다", 걸려야.length, 1],
    ["긴 낱말이 먼저 — 안전하다", 걸리면안됨_순서.length, 0],
    ["포함 관계가 없다 — 안전하다", 걸리면안됨_무관.length, 0],
    [
      "**다른 함수**라 서로를 못 막는다 — 실제로 거짓 경보 7건을 냈던 모양",
      걸리면안됨_다른함수.length,
      0,
    ],
  ];
  let failed = 0;
  for (const [why, got, want] of rows) {
    const ok = got === want;
    if (!ok) failed += 1;
    console.log(`  ${ok ? "✅" : "❌"} ${why}  (잡힌 수 ${got}, 기대 ${want})`);
  }
  console.log(
    failed === 0
      ? "\n✅ 눈금 4건 전부 맞다 (양성 1 · 음성 3)"
      : `\n❌ 눈금 ${failed}건 어긋남 — **가드를 믿을 수 없다**`,
  );
  process.exit(failed === 0 ? 0 : 1);
}

// ── 전량 ───────────────────────────────────────────────────────────────
const units = elementaryUnits();
const all: Risk[] = [];
let needleCount = 0;

for (const f of FILES) {
  const src = readFileSync(`src/lib/elementary/${f}.ts`, "utf8");
  const grade = `초${f.slice(1)}`;
  const sections = units.filter((u) => u.grade === grade).map((u) => u.section);
  needleCount += needlesOf(src).length;
  all.push(...risks(f, src, sections));
}

console.log(`\`includes\` 로 가르는 낱말 ${needleCount}개를 훑었다\n`);
if (all.length === 0) {
  console.log("✅ 죽은 갈래 0");
} else {
  console.log(
    `❌ 죽은 갈래 후보 ${all.length}건 — **짧은 낱말이 먼저 판정된다**`,
  );
  for (const r of all) {
    console.log(
      `  · ${r.file}.ts   「${r.shortNeedle}」 가 「${r.longNeedle}」 보다 먼저\n` +
        r.sections.map((s) => `        막히는 소단원: ${s}`).join("\n"),
    );
  }
  console.log(
    "\n  고치는 법: **긴 낱말을 먼저 판정**하라. 짧은 쪽을 지우면 그 갈래가 사라진다.",
  );
}
process.exitCode = all.length === 0 ? 0 : 1;
