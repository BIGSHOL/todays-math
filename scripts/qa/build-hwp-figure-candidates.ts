/**
 * 그림 유실 기출 문항에 대해 **HWP 정본의 어느 문항인지**를 맞추고, 회수 후보를 만든다.
 *
 *   npx tsx scripts/qa/build-hwp-figure-candidates.ts
 *   npx tsx scripts/qa/build-hwp-figure-candidates.ts --list   # 맞춘 결과를 전부 찍는다
 *
 * 선행: `python scripts/qa/extract-hwp-all.py --exams <examId,…>`
 *       (→ `scripts/qa/reports/hwp/<examId>.json` 과 `reports/hwpx/<examId>.hwpx`)
 * 입력: `scripts/qa/reports/pe-figure-targets.json`  (그림 유실 기출 행 + 원본 경로)
 *       `scripts/figure/hwp-figure-index.json`       (HWP 문항별 그림 색인)
 * 출력: `scripts/qa/reports/figure-recover-candidates.json`  (recover-hwp-figures.py 입력)
 *       `scripts/qa/reports/figure-row-map.json`             (앵커 어긋남 검사용 지도)
 *       `scripts/qa/reports/hwp-figure-align.jsonl`          (맞춤 근거 — `sim`)
 *
 * ## 왜 정렬을 다시 만드나
 *
 * 트랙 D 가 만든 `hwp-verdicts.jsonl`(DB 문항번호 ↔ HWP 순번)은 **이 컴퓨터에 없다**
 * — 워크트리가 정리되면서 사라졌고, 커밋된 `hwp-verdict-list.json` 은 교체·보류
 * 4,385행뿐이라 대상 123편 중 4편만 덮는다. 없는 것을 기다리는 대신 **여기서 다시
 * 맞춘다.** 근거는 같다 — DB 본문과 HWP 발문이 같은 문항인가.
 *
 * ## 열쇠는 한글+숫자다
 *
 * HWP 수식은 `$LEFT ( -2,~3 RIGHT )$` 같은 한글 스크립트고 DB 는 LaTeX 다. 그대로
 * 비교하면 같은 문항이 0.5 아래로 내려간다. **훼손되는 부분(수식 명령·라틴 변수)을
 * 버리고 훼손되지 않는 한글+숫자만 남긴다** — 숫자를 남기므로 「숫자만 다른 형제」는
 * 갈라진다 (CLAUDE.md 2026-08-17).
 *
 * ## 「가장 닮은 것」으로는 모자란다 — **버금과의 차이**를 함께 본다
 *
 * 한 시험지 안에는 발문이 거의 같은 형제 문항이 있다(같은 유형 3연속). 최고점만 보면
 * 옆 문항에 붙는다. 그래서 **버금과 `MIN_MARGIN` 이상 벌어질 때만** 맞다고 본다.
 * 못 가르면 후보에서 뺀다 — 엉뚱한 그림을 붙이느니 그림 없이 두는 게 낫다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/** 맞았다고 보는 최소 유사도. */
const MIN_SIM = 0.7;
/** 버금 후보와 이만큼 벌어져야 «가른 것»이다. */
const MIN_MARGIN = 0.12;

const TARGETS = "scripts/qa/reports/pe-figure-targets.json";
const INDEX = "scripts/figure/hwp-figure-index.json";
const HWP_DIR = "scripts/qa/reports/hwp";
const OUT_CAND = "scripts/qa/reports/figure-recover-candidates.json";
const OUT_ALIGN = "scripts/qa/reports/hwp-figure-align.jsonl";
/**
 * **버린 행까지 전부** 적는다. 회수되지 않은 행이 «원본에 없다»인지 «검출이 안 된다»인지
 * «판정이 안 선다»인지는 뒤 단계가 다시 물어야 하는데, 그 근거(맞춘 HWP 순번·유사도)가
 * 통과분에만 남아 있으면 **버린 행은 조사 자체가 불가능**해진다.
 * (CLAUDE.md 2026-08-18 「비교에서 빠진 표본은 반드시 세어 찍어라」)
 */
const OUT_ALIGN_ALL = "scripts/qa/reports/hwp-figure-align-all.jsonl";

type Target = {
  id: string;
  externalId: string | null;
  examId: string | null;
  questionNumber: number | null;
  content: string;
};

type HwpQuestion = { number: number; stem?: string | null; choices?: string[] };

const KEEP = /[가-힣0-9]+/g;

/** 훼손되지 않는 부분만 남긴다 — 한글과 숫자. */
function key(text: string): string {
  return (text.match(KEEP) ?? []).join("");
}

/** 두 문자열의 문자 2-gram Dice 계수. 길이 차이에 견디고 순서를 조금은 본다. */
function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a === b) return 1;
  const grams = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i + 1 < s.length; i++) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const ga = grams(a);
  const gb = grams(b);
  let hit = 0;
  for (const [g, n] of ga) hit += Math.min(n, gb.get(g) ?? 0);
  const total = a.length - 1 + (b.length - 1);
  return total > 0 ? (2 * hit) / total : 0;
}

function main(): void {
  const list = process.argv.includes("--list");
  const targets = (
    JSON.parse(readFileSync(TARGETS, "utf8")) as { 목록: Target[] }
  ).목록;
  const index = JSON.parse(readFileSync(INDEX, "utf8")) as Record<
    string,
    { q?: Record<string, { bin: string }[]> }
  >;

  const byExam = new Map<string, Target[]>();
  for (const t of targets) {
    const e = t.externalId?.split("-")[0];
    if (!e) continue;
    if (!byExam.has(e)) byExam.set(e, []);
    byExam.get(e)!.push(t);
  }

  const cands: {
    id: string;
    e: string;
    q: number;
    pics: string[];
    sim: number;
    hwpNumber: number;
  }[] = [];
  const align: string[] = [];
  const alignAll: string[] = [];
  const skip: Record<string, number> = {};
  const bump = (why: string) => (skip[why] = (skip[why] ?? 0) + 1);

  for (const [exam, rows] of [...byExam].sort(
    (a, b) => Number(a[0]) - Number(b[0]),
  )) {
    const hwpPath = `${HWP_DIR}/${exam}.json`;
    if (!existsSync(hwpPath)) {
      bump("HWP 추출본이 아직 없다");
      for (const t of rows) {
        alignAll.push(
          JSON.stringify({
            id: t.id,
            externalId: t.externalId,
            examId: exam,
            n: t.questionNumber,
            why: "HWP 추출본이 아직 없다",
          }),
        );
      }
      continue;
    }
    const qs = (
      JSON.parse(readFileSync(hwpPath, "utf8")) as { questions: HwpQuestion[] }
    ).questions;
    const keys = qs.map((q) =>
      key(`${q.stem ?? ""} ${(q.choices ?? []).join(" ")}`),
    );
    const pics = index[exam]?.q ?? {};

    for (const t of rows) {
      const dbKey = key(t.content);
      const scored = keys
        .map((k, i) => ({ i, s: dice(dbKey, k) }))
        .sort((a, b) => b.s - a.s);
      const best = scored[0];
      const second = scored[1];
      const note = (why: string, extra: Record<string, unknown> = {}) =>
        alignAll.push(
          JSON.stringify({
            id: t.id,
            externalId: t.externalId,
            examId: exam,
            n: t.questionNumber,
            why,
            sim: Number((best?.s ?? 0).toFixed(3)),
            margin: Number(((best?.s ?? 0) - (second?.s ?? 0)).toFixed(3)),
            ...extra,
          }),
        );
      if (!best || best.s < MIN_SIM) {
        bump("닮은 HWP 문항이 없다");
        note("닮은 HWP 문항이 없다");
        continue;
      }
      if (second && best.s - second.s < MIN_MARGIN) {
        // 형제 문항과 못 가른다 — 붙이면 옆 문항 그림이 간다.
        bump("버금과 못 가른다");
        note("버금과 못 가른다", { hwpNumber: qs[best.i]!.number });
        continue;
      }
      const hwpNumber = qs[best.i]!.number;
      const mine = pics[String(hwpNumber)];
      if (!mine || mine.length === 0) {
        bump("그 HWP 문항에 그림이 없다");
        note("그 HWP 문항에 그림이 없다", { hwpNumber });
        continue;
      }
      const q = t.questionNumber ?? hwpNumber;
      cands.push({
        id: t.id,
        e: exam,
        q,
        pics: mine.map((p) => p.bin),
        sim: Number(best.s.toFixed(3)),
        hwpNumber,
      });
      note("후보", { hwpNumber, pics: mine.length });
      align.push(
        JSON.stringify({
          id: t.id,
          externalId: t.externalId,
          examId: exam,
          n: q,
          hwpNumber,
          sim: Number(best.s.toFixed(3)),
          margin: Number((best.s - (second?.s ?? 0)).toFixed(3)),
          pics: mine.length,
        }),
      );
      if (list) {
        console.log(
          `${best.s.toFixed(3)} (버금 ${(second?.s ?? 0).toFixed(3)})  ` +
            `${t.externalId}\tHWP#${hwpNumber}\t그림 ${mine.length}장`,
        );
      }
    }
  }

  writeFileSync(OUT_CAND, JSON.stringify(cands, null, 1), "utf8");
  writeFileSync(OUT_ALIGN, align.join("\n") + "\n", "utf8");
  writeFileSync(OUT_ALIGN_ALL, alignAll.join("\n") + "\n", "utf8");
  console.log(`\n대상 ${targets.length}행 · 후보 ${cands.length}행`);
  for (const [why, n] of Object.entries(skip).sort((a, b) => b[1] - a[1])) {
    console.log(`  건너뜀: ${why} ${n}`);
  }
  // 「대상 = 후보 + 건너뜀」이 안 맞으면 조용히 빠진 행이 있다는 뜻이다.
  const counted = cands.length + Object.values(skip).reduce((a, b) => a + b, 0);
  if (counted !== targets.length) {
    throw new Error(
      `분모가 안 맞는다: 대상 ${targets.length} ≠ 후보+건너뜀 ${counted}`,
    );
  }
  if (alignAll.length !== targets.length) {
    throw new Error(
      `전량 기록이 모자란다: 대상 ${targets.length} ≠ 기록 ${alignAll.length}`,
    );
  }
  console.log(`→ ${OUT_CAND}\n→ ${OUT_ALIGN}\n→ ${OUT_ALIGN_ALL}`);
}

main();
