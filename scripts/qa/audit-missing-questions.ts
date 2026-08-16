/**
 * 트랙 D — **문항 결손 주장을 굳힌다.**
 *
 * 판정기는 "HWP 문항 수 > DB 행 수" 인 편을 세어 3,384문항이라고 보고했다.
 * 그건 **상한이다.** 적재 파이프라인은 정당한 이유로 행을 뺀다:
 *
 *   `classifyDrafts` — 그림 파일 못 찾음(`skipped_figure`) · 단원 미분류(`unclassified`)
 *   `toLoadRows`     — 본문 빈 것 · 1만자 초과 · 비완료본(D-37)
 *   insert           — `externalId` 중복
 *
 * 게다가 `hwp_extract.parse_exam` 의 `number` 는 **미주 순번**이라, 미주가 문항보다
 * 많은 편에서는 뒤쪽에 실체 없는 번호가 생길 수 있다. 그래서 숫자를 그대로 믿지 않고
 * 아래로 가른다.
 *
 *   꼬리 결손  : 빠진 번호가 DB 최대 번호 **뒤**에만 있다 → 미주 인공물이 의심된다
 *   중간 결손  : DB 번호 사이가 뚫려 있다 → 진짜 누락에 가깝다
 *
 * 그리고 빠진 문항의 HWP 실체를 본다(빈 껍데기인가 · 소단원이 있는가 · 보기가 있는가).
 *
 *   npx tsx scripts/qa/audit-missing-questions.ts [--sample 20]
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

import { buildHwpContent, sigKo, type HwpQ } from "./hwpJudgeRules";

const HWP_DIR = "scripts/qa/reports/hwp-latex";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const OUT = "scripts/qa/reports/missing-questions.json";

/** 실체 있는 문항으로 볼 최소 길이. 이보다 짧으면 추출 인공물로 본다. */
const MIN_REAL = 40;

interface Missing {
  examId: string;
  n: number;
  position: "꼬리" | "중간" | "머리";
  len: number;
  choices: number;
  hasTopic: boolean;
  hasAnswer: boolean;
  koLen: number;
  real: boolean;
}

async function main(): Promise<void> {
  const sampleN = Number(
    process.argv[process.argv.indexOf("--sample") + 1] || "0",
  );

  const db = new Map<string, Set<number>>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.source !== "past_exam" || r.n == null) continue;
    const eid = String(r.examId);
    if (!db.has(eid)) db.set(eid, new Set());
    db.get(eid)!.add(r.n);
  }

  // 정렬이 확인된 편만 본다. 번호를 못 믿으면 결손도 못 믿는다.
  const align = new Map<string, string>();
  for (const line of (await readFile(VERDICTS, "utf-8")).split("\n")) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    if (v.id && v.align) align.set(v.examId, v.align);
  }

  const missing: Missing[] = [];
  const stat = {
    생성시각: new Date().toISOString(),
    대상편: 0,
    정렬미확인_제외편: 0,
    결손있는편: 0,
    결손문항_상한: 0,
    위치: { 꼬리: 0, 중간: 0, 머리: 0 },
    실체: { 실체있음: 0, 빈껍데기: 0 },
    실체있음_중간결손: 0,
    소단원있음: 0,
    보기4개이상: 0,
    정답있음: 0,
  };

  for (const f of (await readdir(HWP_DIR)).filter((x) => x.endsWith(".json"))) {
    const eid = f.replace(/\.json$/, "");
    const have = db.get(eid);
    if (!have || have.size === 0) continue;
    if (align.get(eid) !== "확정" && align.get(eid) !== "정황") {
      stat.정렬미확인_제외편 += 1;
      continue;
    }
    stat.대상편 += 1;
    const qs: HwpQ[] = JSON.parse(await readFile(`${HWP_DIR}/${f}`, "utf-8")).questions ?? [];
    const dbMin = Math.min(...have);
    const dbMax = Math.max(...have);
    let examHasMissing = false;

    for (const q of qs) {
      if (have.has(q.number)) continue;
      examHasMissing = true;
      stat.결손문항_상한 += 1;
      const content = buildHwpContent(q);
      const position =
        q.number > dbMax ? "꼬리" : q.number < dbMin ? "머리" : "중간";
      const real = content.trim().length >= MIN_REAL;
      stat.위치[position] += 1;
      stat.실체[real ? "실체있음" : "빈껍데기"] += 1;
      if (real && position === "중간") stat.실체있음_중간결손 += 1;
      if (q.topic) stat.소단원있음 += 1;
      if ((q.choices?.length ?? 0) >= 4) stat.보기4개이상 += 1;
      if (q.answer) stat.정답있음 += 1;
      missing.push({
        examId: eid,
        n: q.number,
        position,
        len: content.trim().length,
        choices: q.choices?.length ?? 0,
        hasTopic: Boolean(q.topic),
        hasAnswer: Boolean(q.answer),
        koLen: sigKo(content).length,
        real,
      });
    }
    if (examHasMissing) stat.결손있는편 += 1;
  }

  await writeFile(OUT, JSON.stringify({ stat, missing }, null, 1), "utf-8");

  const pct = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(1) : "0.0");
  console.log("── 문항 결손 감사 ──");
  console.log(`대상 ${stat.대상편}편 (정렬 미확인으로 제외 ${stat.정렬미확인_제외편}편)`);
  console.log(`결손 있는 편 ${stat.결손있는편} · 결손 문항 **상한** ${stat.결손문항_상한}`);
  console.log(
    `위치 — 꼬리 ${stat.위치.꼬리} (${pct(stat.위치.꼬리, stat.결손문항_상한)}%)` +
      ` · 중간 ${stat.위치.중간} · 머리 ${stat.위치.머리}`,
  );
  console.log(
    `실체 — 본문 ${MIN_REAL}자 이상 ${stat.실체.실체있음}` +
      ` · 빈껍데기 ${stat.실체.빈껍데기}`,
  );
  console.log(
    `**실체 있는 중간 결손 ${stat.실체있음_중간결손}** ← 진짜 누락에 가장 가까운 숫자`,
  );
  console.log(
    `참고 — 소단원 보유 ${stat.소단원있음} · 보기 4개↑ ${stat.보기4개이상} · 정답 보유 ${stat.정답있음}`,
  );
  console.log("→", OUT);

  if (sampleN > 0) {
    // 실체 있는 중간 결손을 눈으로 본다. 결정론적으로 고르게 흩어 뽑는다.
    const pool = missing.filter((m) => m.real && m.position === "중간");
    const step = Math.max(1, Math.floor(pool.length / sampleN));
    const picked = pool.filter((_, i) => i % step === 0).slice(0, sampleN);
    console.log(`\n── 실체 있는 중간 결손 표본 ${picked.length}/${pool.length} ──`);
    for (const m of picked) {
      const qs: HwpQ[] = JSON.parse(
        await readFile(`${HWP_DIR}/${m.examId}.json`, "utf-8"),
      ).questions;
      const q = qs.find((x) => x.number === m.n)!;
      const body = buildHwpContent(q).replace(/\n+/g, " ⏎ ");
      console.log(
        `\n[${m.examId}-${m.n}] ${m.len}자 · 보기${m.choices} · 소단원 ${m.hasTopic ? "있음" : "없음"} · 정답 ${m.hasAnswer ? "있음" : "없음"}`,
      );
      console.log(`   ${body.slice(0, 150)}${body.length > 150 ? " …" : ""}`);
    }
  }
}

void main();
