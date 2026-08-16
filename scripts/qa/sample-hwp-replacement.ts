/**
 * 트랙 D-2 — 판정 결과를 **눈으로 확인**하기 위한 표본 뽑기.
 *
 * "동어반복 측정을 조심할 것 … 실제 화면을 보고서야 틀린 걸 알았다"(10-handoff §8.5).
 * 규칙이 스스로를 증명하게 두지 않는다. 판정별로 골고루 뽑아 사람이 직접 본다.
 *
 *   npx tsx scripts/qa/sample-hwp-replacement.ts [--verdict 교체] [--n 30] [--seed 7]
 *
 * ⚠️ 표본 출력에는 본문이 실린다 — **보고서에 그대로 옮기지 말 것**(tracks/README §4).
 */
import { readFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { buildHwpContent, stripWatermark, type HwpQ } from "./hwpJudgeRules";

const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const DB = "scripts/qa/reports/db-content.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";

/** 결정론적 셔플 — 같은 seed 면 같은 표본이 나와 재검증이 된다. */
function mulberry(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function arg(name: string, dflt: string): string {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

const cut = (s: string, n: number) =>
  (s ?? "").replace(/\n+/g, " ⏎ ").slice(0, n) + ((s ?? "").length > n ? " …" : "");

async function main() {
  const want = arg("verdict", "교체");
  const n = Number(arg("n", "30"));
  const rnd = mulberry(Number(arg("seed", "7")));
  const width = Number(arg("width", "300"));

  interface Verdict {
    id: string; externalId: string | null; examId: string; n: number;
    hwpNumber: number; verdict: string; S: string[]; H: string[]; sim: number;
    dbLen: number; hwpLen: number; align: string;
  }
  const picked: Verdict[] = [];
  for (const line of (await readFile(VERDICTS, "utf-8")).split("\n")) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    if (v.verdict !== want || !v.id) continue;
    // --only S8_수식뭉갬 : **그 사유 하나만** 걸린 행. 새 규칙이 혼자서도
    // 옳은 판정을 내는지 보려면 다른 사유가 섞이지 않은 것을 봐야 한다.
    const only = arg("only", "");
    if (only && !(v.S.length === 1 && v.S[0] === only)) continue;
    // --minratio 1.8 : HWP 가 DB 보다 이 배수 이상 길고 --mindiff 자 이상 차이나는 행.
    // "DB 가 지문을 잃었는가" 를 눈으로 확인하는 용도다.
    const minRatio = Number(arg("minratio", "0"));
    const minDiff = Number(arg("mindiff", "0"));
    if (minRatio > 0 && !(v.hwpLen >= v.dbLen * minRatio && v.hwpLen - v.dbLen >= minDiff)) continue;
    picked.push(v);
  }
  // --worst: 무작위 대신 **유사도가 가장 낮은 것부터** — 거짓 음성 사냥용.
  if (process.argv.includes("--worst")) {
    picked.sort((a, b) => a.sim - b.sim);
  } else if (process.argv.includes("--longest")) {
    picked.sort((a, b) => b.hwpLen / Math.max(1, b.dbLen) - a.hwpLen / Math.max(1, a.dbLen));
  } else
  for (let i = picked.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rnd() * (i + 1));
    [picked[i], picked[j]] = [picked[j], picked[i]];
  }
  const take = picked.slice(0, n);
  const ids = new Set(take.map((t) => t.id));

  const db = new Map<string, { content: string }>();
  const rl = createInterface({
    input: createReadStream(DB, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const l of rl) {
    if (!l.trim()) continue;
    const r = JSON.parse(l);
    if (ids.has(r.id)) db.set(r.id, r);
  }

  console.log(`판정 "${want}" ${picked.length}건 중 ${take.length}건 표본 (seed ${arg("seed", "7")})\n`);
  for (const [k, t] of take.entries()) {
    const r = db.get(t.id);
    if (!r) continue;
    const doc = JSON.parse(await readFile(`${HWP_DIR}/${t.examId}.json`, "utf-8"));
    const q: HwpQ | undefined = doc.questions.find((x: HwpQ) => x.number === t.hwpNumber);
    const p = parseProblemContent(r.content);
    console.log(`── [${k + 1}] ${t.examId}-${t.n} · align=${t.align} · S=${t.S.join(",") || "-"} · H=${t.H.join(",") || "-"} · sim=${t.sim}`);
    console.log(`   DB (${r.content.length}자, 보기${p.choices.length}) : ${cut(p.question, width)}`);
    if (p.choices.length) console.log(`        보기 : ${cut(p.choices.join(" | "), 160)}`);
    console.log(`   HWP(${q ? buildHwpContent(q).length : 0}자, 보기${q?.choices?.length ?? 0}) : ${cut(stripWatermark(q?.stem ?? ""), width)}`);
    if (q?.choices?.length) console.log(`        보기 : ${cut(q.choices.map(stripWatermark).join(" | "), 160)}`);
    console.log("");
  }
}

main();
