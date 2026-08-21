/**
 * SVG 검수 판정을 **한 파일로 모은다** — 「누가 무엇을 봤나」가 셧다운을 견디게.
 *
 *   node scripts/qa/collect-svg-verdicts.mjs [판정폴더]
 *
 * ## 왜 필요한가
 *
 * 쓸기(`scripts/qa/svg-verify/run-*.sh`)는 시트마다 파일 하나를 **세션 임시
 * 폴더**에 쓴다. 재개는 그래서 잘 되는데, 임시 폴더가 지워지면 1,200장 넘는
 * 판정이 통째로 사라진다 — 그러면 「어디까지 했나」를 다시 알 길이 없다.
 * 2026-08-21 셧다운에서 배운 것이 정확히 그것이다.
 *
 * ## 🔴 「몇 장 돌았나」로 세지 않는다
 *
 * 보고서가 「gemini 263/263 완료」라고 적었는데 실제로는 **24장이 0바이트**였다.
 * 쓸기가 그 시트에서 API 오류(`high traffic`)를 받아 판정을 한 줄도 못 냈는데,
 * **파일은 만들어져서** 파일 개수로는 263이 된다. 그래서 여기서는 파일이 아니라
 * **판정 줄**을 세고, 시트 색인과 대 보아 다음 셋을 따로 찍는다:
 *
 *   · **빠짐**   그 시트에 있는 짝인데 판정이 없다
 *   · **지어냄** 그 시트에 **없는** 짝 번호를 판정했다 (표본을 안 보고 지어낸 것)
 *   · **군더더기** 같은 짝을 두 번 판정했다
 *
 * 지어냄은 판정자를 믿기 **전에** 세야 한다(CLAUDE.md 2026-08-21). 열쇠는
 * `scripts/qa/reports/svg-sheets.json` — 시트마다 어느 4자리 짝이 실렸는지 안다.
 */
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";

const SHEETS = "scripts/qa/reports/svg-sheets.json";
const OUT = "scripts/qa/reports/svg-verdicts.tsv";
const DEFAULT_DIR = path.join(
  process.env.LOCALAPPDATA ?? "",
  "Temp/claude/C--Creative-testautocreator/514755a6-ad9e-4e2a-882d-210afa7581c6/scratchpad/codex검수",
);

/** 꼬리표 → 사람이 읽는 이름. 꼬리표는 파일 이름에만 있어 여기서 풀어 준다. */
const TAGS = {
  "": "codex-1",
  b: "codex-2",
  g: "gemini",
  g2: "gemini-3.1pro",
  a: "antigravity",
  o: "agy-o",
};

const dir = process.argv[2] ?? DEFAULT_DIR;
if (!existsSync(dir)) {
  console.error(`판정 폴더가 없다: ${dir}`);
  console.error("쓸기를 돌린 세션의 스크래치패드 경로를 인자로 넘겨라.");
  process.exit(1);
}
if (!existsSync(SHEETS)) {
  console.error(`시트 색인이 없다: ${SHEETS}`);
  process.exit(1);
}

const index = JSON.parse(readFileSync(SHEETS, "utf8"));
/** 시트 번호 → 그 시트에 실린 4자리 짝 집합. 지어냄을 세는 열쇠다. */
const onSheet = new Map(index["행"].map((r) => [r.sheet, new Set(r.items)]));

const VERDICT = /^(\d{4}) (OK|결함)(?:\s+(.*))?$/;
const FILE = /^sheet-(\d{4})(?:\.([a-z0-9]+))?\.txt$/;

const rows = [];
const stat = new Map(); // 꼬리표 → 집계

for (const name of readdirSync(dir).sort()) {
  const m = FILE.exec(name);
  if (!m) continue;
  const sheet = Number(m[1]);
  const tag = m[2] ?? "";
  const judge = TAGS[tag] ?? `?${tag}`;
  const full = path.join(dir, name);

  const s = stat.get(judge) ?? {
    파일: 0,
    빈파일: 0,
    판정시트: 0,
    짝: 0,
    결함: 0,
    빠짐: 0,
    지어냄: 0,
    군더더기: 0,
    지어낸예: [],
  };
  stat.set(judge, s);
  s.파일 += 1;

  if (statSync(full).size === 0) {
    // 🔴 **돌긴 돌았는데 아무것도 안 나온 것.** 파일 개수로 세면 이게 «완료»가 된다.
    s.빈파일 += 1;
    continue;
  }
  s.판정시트 += 1;

  const 실린짝 = onSheet.get(sheet) ?? new Set();
  const 본짝 = new Set();
  for (const line of readFileSync(full, "utf8").split(/\r?\n/)) {
    const v = VERDICT.exec(line.trim());
    if (!v) continue;
    const [, pair, verdict, note] = v;
    if (본짝.has(pair)) {
      s.군더더기 += 1;
      continue;
    }
    본짝.add(pair);
    if (!실린짝.has(pair)) {
      s.지어냄 += 1;
      if (s.지어낸예.length < 5) s.지어낸예.push(`시트 ${m[1]}의 ${pair}`);
      // 지어낸 줄도 **버리지 않고 적는다** — 지워 버리면 다음 사람이 못 센다.
    }
    s.짝 += 1;
    if (verdict === "결함") s.결함 += 1;
    rows.push([m[1], judge, pair, verdict, (note ?? "").replace(/\t/g, " ")]);
  }
  for (const pair of 실린짝) if (!본짝.has(pair)) s.빠짐 += 1;
}

rows.sort((a, b) => a[0].localeCompare(b[0]) || a[1].localeCompare(b[1]) || a[2].localeCompare(b[2]));

writeFileSync(
  OUT,
  [
    "# SVG 검수 판정 집계 — scripts/qa/collect-svg-verdicts.mjs 가 만든다. 손으로 고치지 말 것.",
    `# 판정 원본: ${dir} (세션 임시 폴더 — 지워질 수 있다. 이 파일이 사본이다)`,
    "# sheet\tjudge\tpair\tverdict\tnote",
    ...rows.map((r) => r.join("\t")),
    "",
  ].join("\n"),
  "utf8",
);

const 총시트 = index["총시트"];
console.log(`시트 ${총시트}장 · 짝 ${index["총짝"]}개\n`);
console.log(
  `${"판정자".padEnd(16)}${"판정한 시트".padStart(12)}${"빈 파일".padStart(9)}${"짝".padStart(7)}${"결함".padStart(7)}${"빠짐".padStart(7)}${"지어냄".padStart(8)}`,
);
for (const [judge, s] of [...stat].sort((a, b) => b[1].짝 - a[1].짝)) {
  console.log(
    `${judge.padEnd(16)}${`${s.판정시트}/${총시트}`.padStart(12)}${String(s.빈파일).padStart(9)}` +
      `${String(s.짝).padStart(7)}${String(s.결함).padStart(7)}${String(s.빠짐).padStart(7)}${String(s.지어냄).padStart(8)}`,
  );
  if (s.지어낸예.length)
    console.log(`${"".padEnd(16)}지어낸 예: ${s.지어낸예.join(" · ")}`);
}
console.log(`\n판정 줄 ${rows.length.toLocaleString()}개 → ${OUT}`);
