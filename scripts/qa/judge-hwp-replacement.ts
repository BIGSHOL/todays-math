/**
 * 트랙 D-2 — HWP 원본 ↔ DB 본문을 문항 단위로 맞대고 **교체/보류/유지**를 가른다.
 *
 *   입력  scripts/qa/reports/db-content.jsonl   (export-db-content-snapshot.ts)
 *         scripts/qa/reports/hwp-latex/*.json   (build-hwp-latex.py)
 *   출력  scripts/qa/reports/hwp-verdicts.jsonl (행 단위 판정 — 본문은 안 싣는다)
 *         scripts/qa/reports/hwp-verdicts-summary.json
 *
 * ⚠️ 정렬을 먼저 검증한다. `hwp_extract.parse_exam` 의 `number` 는 **미주 순번**이지
 * 지면에 인쇄된 문항 번호가 아니다(`for i, q in enumerate(questions, 1)`). 표본에서는
 * 잘 맞았지만(중앙값 Dice 0.986) 어긋나면 **엉뚱한 문항의 본문을 덮어쓴다.**
 *
 * ⚠️⚠️ 처음엔 "유사도 중앙값이 낮으면 정렬 실패" 로 걸었는데 **정확히 거꾸로였다** —
 * 강북고 2928(1~12번 본문이 통째로 "정답" 두 글자)과 국제고 2697(DB 2건이 둘 다 해설)이
 * 바로 그 이유로 통째로 버려졌다. **손상이 심할수록 유사도가 낮다.** 유사도 부재는
 * 정렬 오류의 증거가 아니다(tracks/README: "몰림은 조사 단서일 뿐 배제 근거가 아니다").
 * 그래서 판정을 뒤집었다 — **다른 오프셋이 0보다 뚜렷이 나을 때만** 어긋난 것으로 본다.
 * 근거는 본문 유사도 말고도 **배점·정답 일치**(본문과 독립)를 같이 센다.
 * 2928 은 유사도 합이 offset0 1.44 vs 나머지 0.31~0.47 로 0 이 3배였다 — 정렬은 옳았다.
 *
 * 화면에는 숫자만 찍는다(tracks/README §4).
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { renderKatexSafe } from "../../src/lib/math/katexRender";
import { tokenizeMath } from "../../src/lib/math/segments";
import {
  alignExam,
  buildHwpContent,
  judgeSignals,
  verdictOf,
  type DbRow,
  type HwpQ,
} from "./hwpJudgeRules";
import {
  ANSWER_CIRCLED_CLASS,
  circledValueRaw,
} from "../../src/lib/math/circledNumber";

const DB = "scripts/qa/reports/db-content.jsonl";
const HWP_DIR = "scripts/qa/reports/hwp-latex";
const OUT = "scripts/qa/reports/hwp-verdicts.jsonl";
const SUM = "scripts/qa/reports/hwp-verdicts-summary.json";

/** KaTeX 가 못 그린 수식 개수. renderKatexSafe 는 실패해도 붉게 두지 않고
 *  중립 `.math-raw` 로 떨어뜨린다(CLAUDE.md 교훈) — 그 폴백을 센다. */
function mathFailures(text: string): { fail: number; total: number } {
  let fail = 0;
  let total = 0;
  for (const seg of tokenizeMath(text ?? "")) {
    if (seg.type === "text") continue;
    total += 1;
    const html = renderKatexSafe(seg.value, seg.type === "display");
    if (html.includes("math-raw")) fail += 1;
  }
  return { fail, total };
}

async function loadDb(): Promise<Map<string, Map<number, DbRow>>> {
  const byExam = new Map<string, Map<number, DbRow>>();
  const rl = createInterface({
    input: createReadStream(DB, { encoding: "utf-8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (!line.trim()) continue;
    const r = JSON.parse(line);
    // 트랙 C 가 RPM 행에 다른 모양의 키를 채운 사고가 있었다(코디네이터 2026-08-16).
    // 형식이 아니라 `source` 로 거른다.
    if (r.source !== "past_exam" || r.n == null) continue;
    const eid = String(r.examId);
    if (!byExam.has(eid)) byExam.set(eid, new Map());
    byExam.get(eid)!.set(r.n, r as DbRow);
  }
  return byExam;
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const byExam = await loadDb();
  const files = (await readdir(HWP_DIR)).filter((f) => f.endsWith(".json"));

  await mkdir(path.dirname(OUT), { recursive: true });
  const lines: string[] = [];

  const sum = {
    생성시각: new Date().toISOString(),
    HWP추출편: files.length,
    DB행있는편: 0,
    정렬: { 확정: 0, 정황: 0, 근거없음: 0 } as Record<string, number>,
    오프셋보정편: 0,
    판정행: 0,
    교체: 0,
    보류: 0,
    유지: 0,
    S사유: {} as Record<string, number>,
    H사유: {} as Record<string, number>,
    문항결손: { 편: 0, HWP초과문항: 0 },
    수식: { DB실패: 0, DB전체: 0, HWP실패: 0, HWP전체: 0 },
  };

  for (const f of files) {
    const eid = f.replace(/\.json$/, "");
    const rows = byExam.get(eid);
    if (!rows || rows.size === 0) continue;
    sum.DB행있는편 += 1;

    const doc = JSON.parse(await readFile(path.join(HWP_DIR, f), "utf-8"));
    const qs: HwpQ[] = doc.questions ?? [];
    if (qs.length > rows.size) {
      sum.문항결손.편 += 1;
      sum.문항결손.HWP초과문항 += qs.length - rows.size;
    }

    // ── 정렬 검증 ──
    const align = alignExam(qs, rows);
    sum.정렬[align.grade] += 1;
    if (align.offset !== 0) sum.오프셋보정편 += 1;

    for (const q of qs) {
      const row = rows.get(q.number + align.offset);
      if (!row) continue;
      const parsed = parseProblemContent(row.content);
      const hwpContent = buildHwpContent(q);
      const dbM = mathFailures(row.content);
      const hwpM = mathFailures(hwpContent);
      sum.수식.DB실패 += dbM.fail;
      sum.수식.DB전체 += dbM.total;
      sum.수식.HWP실패 += hwpM.fail;
      sum.수식.HWP전체 += hwpM.total;

      const sig = judgeSignals({
        row,
        hwp: q,
        dbQuestion: parsed.question,
        dbChoices: parsed.choices,
        dbMathFail: dbM.fail,
        hwpMathFail: hwpM.fail,
        dbMathTotal: dbM.total,
        hwpMathTotal: hwpM.total,
      });
      let v = verdictOf(sig);
      // 정렬 근거가 없는 편에서 교체하면 **엉뚱한 행을 덮어쓸 수 있다.** 보류로 내린다.
      if (v === "교체" && align.grade === "근거없음") {
        v = "보류";
        sig.H.push("H9_정렬근거없음");
      }
      sum.판정행 += 1;
      sum[v] += 1;
      for (const s of sig.S) sum.S사유[s] = (sum.S사유[s] ?? 0) + 1;
      for (const h of sig.H) sum.H사유[h] = (sum.H사유[h] ?? 0) + 1;

      lines.push(
        JSON.stringify({
          id: row.id,
          externalId: row.externalId,
          examId: eid,
          n: row.n,
          hwpNumber: q.number,
          verdict: v,
          align: align.grade,
          alignOffset: align.offset,
          S: sig.S,
          H: sig.H,
          sim: Number(sig.sim.toFixed(3)),
          dbLen: row.content.length,
          hwpLen: hwpContent.length,
          dbChoices: parsed.choices.length,
          hwpChoices: q.choices?.length ?? 0,
          dbMathFail: dbM.fail,
          dbMathTotal: dbM.total,
          hwpMathFail: hwpM.fail,
          hwpMathTotal: hwpM.total,
          hwpType: q.type,
          hwpScore: q.score,
          dbType: row.problemType,
          figs: row.figs,
        }),
      );
    }
  }

  await writeFile(OUT, lines.join("\n") + "\n", "utf-8");
  await writeFile(SUM, JSON.stringify(sum, null, 1), "utf-8");

  const pct = (a: number, b: number) =>
    b ? ((a * 100) / b).toFixed(1) : "0.0";
  console.log("── D-2 교체 판정 ──");
  console.log(`HWP 추출 ${sum.HWP추출편}편 · DB 행 있는 편 ${sum.DB행있는편}`);
  console.log(
    `정렬 근거 — 확정 ${sum.정렬.확정} · 정황 ${sum.정렬.정황} · 근거없음 ${sum.정렬.근거없음} (오프셋 보정 ${sum.오프셋보정편}편)`,
  );
  console.log(
    `판정 ${sum.판정행}행 — 교체 ${sum.교체} (${pct(sum.교체, sum.판정행)}%) · ` +
      `보류 ${sum.보류} (${pct(sum.보류, sum.판정행)}%) · 유지 ${sum.유지} (${pct(sum.유지, sum.판정행)}%)`,
  );
  console.log("S 사유:", JSON.stringify(sum.S사유, null, 0));
  console.log("H 사유:", JSON.stringify(sum.H사유, null, 0));
  console.log(
    `문항 결손 — HWP 가 더 많은 편 ${sum.문항결손.편} · 초과 문항 ${sum.문항결손.HWP초과문항}`,
  );
  console.log(
    `수식 렌더 실패 — DB ${sum.수식.DB실패}/${sum.수식.DB전체} (${pct(sum.수식.DB실패, sum.수식.DB전체)}%) · ` +
      `HWP ${sum.수식.HWP실패}/${sum.수식.HWP전체} (${pct(sum.수식.HWP실패, sum.수식.HWP전체)}%)`,
  );
  console.log("→", OUT);
  void args;
}

main();
