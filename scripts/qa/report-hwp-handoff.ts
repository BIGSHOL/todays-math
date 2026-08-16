/**
 * 트랙 D-4 — HWP 재추출로 **덤으로 열리는 것**을 세어 다른 트랙에 넘긴다.
 *
 * 트랙 D 가 쓰는 컬럼은 `content` · `problemType` 뿐이다. 아래는 전부 남의 컬럼이라
 * **세기만 하고 직접 쓰지 않는다**(track-d-hwp.md 완료 기준).
 *
 *   정답·해설  → 트랙 B (`answer`)
 *   그림       → 트랙 A (`figureUrls`) — `.hwpx` 의 `BinData` 를 그대로 넘긴다
 *   소단원     → 단원 매핑 담당 (적재 안 된 문항을 되살릴 수 있는지)
 *   문항 결손  → 코디네이터 (INSERT 라 트랙 D 범위 밖)
 *
 *   npx tsx scripts/qa/report-hwp-handoff.ts
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

const HWP_DIR = "scripts/qa/reports/hwp-latex";
const HWPX_DIR = "scripts/qa/reports/hwpx";
const SNAPSHOT = "scripts/qa/reports/db-content.jsonl";
const VERDICTS = "scripts/qa/reports/hwp-verdicts.jsonl";
const OUT = "scripts/qa/reports/hwp-handoff.json";

const NO_ANSWER = "(정답 없음)";
/** 최종 값이 없는 정답 표기. 트랙 B 의 '증명·작도형 74건' 이 이 부류다. */
const REF_ANSWER = /^(해설\s*참조|풀이\s*참조|풀이참조|해설참조)$/;

async function main(): Promise<void> {
  const files = (await readdir(HWP_DIR)).filter((f) => f.endsWith(".json"));
  const hwpxSet = new Set(
    (await readdir(HWPX_DIR).catch(() => [] as string[]))
      .filter((f) => f.endsWith(".hwpx"))
      .map((f) => f.replace(/\.hwpx$/, "")),
  );

  // DB 쪽 — 원본경로+번호가 아니라 examId+번호로 잇는다(판정기와 같은 열쇠).
  const db = new Map<string, Map<number, { answer: string; solLen: number; figs: number }>>();
  const rl = createInterface({
    input: createReadStream(SNAPSHOT, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    if (r.source !== "past_exam" || r.n == null) continue;
    const eid = String(r.examId);
    if (!db.has(eid)) db.set(eid, new Map());
    db.get(eid)!.set(r.n, { answer: r.answer, solLen: r.solLen, figs: r.figs });
  }

  // 정렬이 확인된 편만 센다 — 정렬을 못 믿으면 넘기는 값도 못 믿는다.
  const alignOk = new Set<string>();
  for (const line of (await readFile(VERDICTS, "utf-8")).split("\n")) {
    if (!line.trim()) continue;
    const v = JSON.parse(line);
    if (v.id && (v.align === "확정" || v.align === "정황")) alignOk.add(v.examId);
  }

  const t = {
    생성시각: new Date().toISOString(),
    HWP추출편: files.length,
    DB행있는편: 0,
    정렬확인편: 0,
    HWP문항: 0,
    트랙B_정답: { DB정답없음: 0, HWP가채움: 0, DB해설참조: 0, HWP해설있음: 0, DB해설없음: 0, HWP해설로채움: 0 },
    트랙A_그림: { hwpx보유편: hwpxSet.size, hwpx없는편: 0 },
    단원_소단원: { HWP소단원있음: 0, HWP소단원없음: 0 },
    배점유형: { HWP배점있음: 0, HWP객관식: 0, HWP서술형: 0, HWP단답형: 0, HWP기타: 0 },
    문항결손: { 편: 0, HWP초과문항: 0 },
  };

  for (const f of files) {
    const eid = f.replace(/\.json$/, "");
    const rows = db.get(eid);
    const qs = JSON.parse(await readFile(`${HWP_DIR}/${f}`, "utf-8")).questions ?? [];
    if (!hwpxSet.has(eid)) t.트랙A_그림.hwpx없는편 += 1;
    if (!rows || rows.size === 0) continue;
    t.DB행있는편 += 1;
    if (!alignOk.has(eid)) continue;
    t.정렬확인편 += 1;

    if (qs.length > rows.size) {
      t.문항결손.편 += 1;
      t.문항결손.HWP초과문항 += qs.length - rows.size;
    }

    for (const q of qs) {
      t.HWP문항 += 1;
      if (q.topic) t.단원_소단원.HWP소단원있음 += 1;
      else t.단원_소단원.HWP소단원없음 += 1;
      if (q.score != null) t.배점유형.HWP배점있음 += 1;
      const kind = q.type === "객관식" ? "HWP객관식"
        : q.type === "서술형" ? "HWP서술형"
        : q.type === "단답형" ? "HWP단답형" : "HWP기타";
      t.배점유형[kind as keyof typeof t.배점유형] += 1;

      const r = rows.get(q.number);
      if (!r) continue;
      const dbAns = (r.answer ?? "").trim();
      if (dbAns === NO_ANSWER || !dbAns) {
        t.트랙B_정답.DB정답없음 += 1;
        if ((q.answer ?? "").trim()) t.트랙B_정답.HWP가채움 += 1;
      }
      if (REF_ANSWER.test(dbAns)) {
        t.트랙B_정답.DB해설참조 += 1;
        if ((q.solution ?? "").trim()) t.트랙B_정답.HWP해설있음 += 1;
      }
      if (r.solLen === 0) {
        t.트랙B_정답.DB해설없음 += 1;
        if ((q.solution ?? "").trim()) t.트랙B_정답.HWP해설로채움 += 1;
      }
    }
  }

  await writeFile(OUT, JSON.stringify(t, null, 1), "utf-8");
  const pct = (a: number, b: number) => (b ? ((a * 100) / b).toFixed(1) : "0.0");
  console.log("── D-4 다른 트랙에 넘길 것 (세기만 함, 쓰지 않음) ──");
  console.log(`HWP 추출 ${t.HWP추출편}편 · DB 행 있는 편 ${t.DB행있는편} · 정렬 확인 ${t.정렬확인편} · 문항 ${t.HWP문항}`);
  console.log(
    `트랙 B(정답) — DB 정답없음 ${t.트랙B_정답.DB정답없음} 중 HWP 가 채움 ` +
      `${t.트랙B_정답.HWP가채움} (${pct(t.트랙B_정답.HWP가채움, t.트랙B_정답.DB정답없음)}%)`,
  );
  console.log(
    `트랙 B(해설) — DB '해설참조' ${t.트랙B_정답.DB해설참조} 중 HWP 해설 보유 ${t.트랙B_정답.HWP해설있음}` +
      ` · DB 해설없음 ${t.트랙B_정답.DB해설없음} 중 HWP 해설 보유 ${t.트랙B_정답.HWP해설로채움}`,
  );
  console.log(
    `트랙 A(그림) — .hwpx 보유 ${t.트랙A_그림.hwpx보유편}편 · 아직 없는 편 ${t.트랙A_그림.hwpx없는편}` +
      " (backfill-hwpx.py 로 채운다)",
  );
  console.log(
    `소단원 — HWP 에 있음 ${t.단원_소단원.HWP소단원있음} (${pct(t.단원_소단원.HWP소단원있음, t.HWP문항)}%)`,
  );
  console.log(
    `배점·유형 — 배점 ${t.배점유형.HWP배점있음} · 객관식 ${t.배점유형.HWP객관식}` +
      ` · 서술형 ${t.배점유형.HWP서술형} · 단답형 ${t.배점유형.HWP단답형} · 기타 ${t.배점유형.HWP기타}`,
  );
  console.log(
    `문항 결손 — HWP 가 더 많은 편 ${t.문항결손.편} · 초과 ${t.문항결손.HWP초과문항}` +
      " → INSERT 라 트랙 D 범위 밖, 코디네이터에게 넘김",
  );
  console.log("→", OUT);
}

void main();
