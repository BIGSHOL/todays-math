/**
 * 단계 3 **허용 목록**을 만든다 — 「눈으로 본 시트에 있는 자리」만.
 *
 *   node scripts/qa/build-svg-whitelist.mjs
 *
 * 왜 차단이 아니라 허용인가: 전량 검수가 **중간에 끊겼다**(계정 세션 한도).
 * 「결함만 뺀다」로 두면 **안 본 자리가 조용히 들어온다.** 안 본 자리에 무엇이
 * 있는지는 정의상 모르고, 본 구간에서 실제로 「전혀 다른 그림」이 나왔다 —
 * 수치 가드를 전부 통과한 채로. 그러니 못 본 것은 결함이 아니라 **아직 근거가
 * 없는 것**이고, 근거 없이 지면에 내보내지 않는다.
 *
 * 규칙은 **하나**다: 「본 시트 목록」 안에 있으면 넣고, 확인된 결함이면 뺀다.
 * 규칙이 둘이 되면 다음 사람이 어느 쪽이 참인지 못 고른다.
 *
 * ⚠️ 아무것도 안 바꾼다. 목록 파일만 쓴다.
 */
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import path from "node:path";

const VERIFY = "C:/Users/user/orca/workspaces/testautocreator/그림벡터검수/scripts/qa/reports/svg-compare";
const OUT = "scripts/qa/reports/svg-whitelist.txt";

/** 눈으로 본 시트. 구간마다 **누가 봤는지**를 같이 적는다 — 근거가 사라지면 다시 못 센다. */
const SEEN = [
  { from: 1, to: 66, by: "병렬 세션 1" },
  { from: 67, to: 67, by: "직접" },
  { from: 114, to: 114, by: "직접" },
  { from: 133, to: 198, by: "병렬 세션 3" },
  { from: 199, to: 199, by: "직접" },
];

/** 눈으로 보고 **결함**으로 확정한 것. 부류를 같이 적는다. */
const DEFECTS = {
  "1410": "내용 — 전혀 다른 그림",
  "1524": "내용 — 원뿔 한 토막 칠 빠짐",
  "0485": "내용 — 축 이름·화살촉 잘림",
  "0263": "내용 — 상자그림 왼쪽 끝 표시 빠짐",
  "0510": "미관 — 삽화가 검은 덩어리",
  "1283": "미관 — 삽화가 검은 덩어리",
  "0480": "미관 — 벽돌 무늬 사라짐",
};

const sheets = JSON.parse(readFileSync(path.join(VERIFY, "contact/sheets.json"), "utf-8"))["행"];
const index = JSON.parse(readFileSync(path.join(VERIFY, "index.json"), "utf-8"))["행"];
const BSLASH = String.fromCharCode(92); // 헤러독이 백슬래시를 먹는다 — 리터럴을 안 쓴다
const svgOf = new Map(index.map((r) => [String(r.file).slice(0, 4), r.svg.split(BSLASH).join("/")]));

const seen = (n) => SEEN.some((r) => n >= r.from && n <= r.to);
const allow = [], blocked = [];
let seenSheets = 0;
for (const s of sheets) {
  if (!seen(s.sheet)) continue;
  seenSheets++;
  for (const n of s.items) {
    if (DEFECTS[n]) { blocked.push(n); continue; }
    const p = svgOf.get(n);
    if (!p) { console.error(`🔴 ${n} 의 SVG 경로를 못 찾았다`); process.exit(1); }
    allow.push([n, p]);
  }
}

// 분모를 먼저 세어 찍고, 안 맞으면 멈춘다 — 「본 것 = 허용 + 결함」이어야 한다.
const expected = seenSheets * 6;
const got = allow.length + blocked.length;
if (Math.abs(expected - got) > 6) {
  console.error(`🔴 본 시트 ${seenSheets}장이면 ${expected}짝인데 ${got}짝이다 — 범위가 샜다.`);
  process.exit(1);
}
// 확정 결함이 본 구간 밖에 있으면 그 판정이 목록에 반영되지 않는다 — 알린다.
for (const n of Object.keys(DEFECTS))
  if (!blocked.includes(n))
    console.error(`⚠️ 결함 ${n} 은 본 시트 밖이라 허용 목록에 애초에 없다 (문제 없음)`);

mkdirSync(path.dirname(OUT), { recursive: true });
const head = [
  "# 단계 3 SVG 채택 **허용 목록** — 눈으로 본 시트에 있는 자리만.",
  "# 여기 없는 자리는 「결함」이 아니라 **아직 안 본 것**이다. 래스터로 남는다.",
  `# 본 시트 ${seenSheets} / 263 · 허용 ${allow.length}짝 · 확정 결함 ${blocked.length}짝`,
  "#",
  ...SEEN.map((r) => `#   시트 ${r.from}~${r.to} — ${r.by}`),
  "#",
  ...Object.entries(DEFECTS).map(([n, w]) => `#   결함 ${n}: ${w}`),
  "",
];
const NL = String.fromCharCode(10);
writeFileSync(OUT, head.concat(allow.map(([n, p]) => `${p}  # ${n}`)).join(NL) + NL, "utf-8");
console.log(`본 시트 ${seenSheets}/263 · 허용 ${allow.length}짝 · 결함 제외 ${blocked.length}짝 → ${OUT}`);
