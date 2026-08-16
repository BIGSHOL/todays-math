/**
 * 왜 이 테스트가 있는가 — **합성 픽스처만 믿지 않기 위해서다.**
 *
 * 이 프로젝트는 직전 회차에 그 실수를 냈다. `convertRpm` 이 원본 키를 잘못 읽어 객관식 정답
 * 4,862건이 통째로 비었는데, 손으로 만든 픽스처는 그 결함을 그대로 통과시켜 테스트가 초록이었다
 * (docs/planning/tracks/README.md). 그래서 배점 보정기도 실제 학교 눈금 전수로 한 번 더 건다.
 *
 * 검사하는 불변식은 셋이다.
 *   1. `ok` 면 합계가 **정확히 100** 이다(0.01점 단위 정수 합).
 *   2. `ok` 면 모든 배점이 **그 학교 눈금 집합 안**이다 — 없는 값을 지어내지 않는다.
 *   3. `합계_100_불가` 를 낸 조합은 **정말로 불가능**하다. 독립적으로 짠 도달 가능성 DP 로
 *      교차 검증한다 — 만들 수 있는데 못 만든다고 말하면 그것도 거짓말이다.
 *
 * 코퍼스는 저장소 밖에 있다(`PREDICTOR_CORPUS_DIR`, 기본값은 handoff-a-index 워크트리).
 * 없는 컴퓨터에서는 **조용히 건너뛴다** — 다른 트랙의 CI 를 이 경로 때문에 빨갛게 만들지 않는다.
 * 코퍼스는 **읽기만 한다.**
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { Blueprint, QuestionType } from "@/contracts/predictor.contract";
import type { NormalizerQuestion } from "@/contracts/scoreNormalizer.contract";
import { normalizeScores, sumScores } from "@/lib/predictor/scoreNormalizer";
import { FULL_MARK_MAX, FULL_MARK_MIN, MIN_QUESTIONS } from "@/lib/predictor/paperTrust";

const CORPUS_DIR =
  process.env.PREDICTOR_CORPUS_DIR ??
  join(
    process.cwd(),
    "..",
    "handoff-a-index",
    "scripts",
    "qa",
    "reports",
  );

const BATCHES = ["final-batch", "index-batch"];
const hasCorpus = BATCHES.some((batch) => existsSync(join(CORPUS_DIR, batch)));

/** 0.01점 단위 정수 합계 10000 을 `count` 개의 눈금으로 만들 수 있는가. */
const FULL = 10_000;
function reachable(grid: readonly number[], count: number): boolean {
  let cur = new Uint8Array(FULL + 1);
  cur[0] = 1;
  for (let k = 1; k <= count; k += 1) {
    const next = new Uint8Array(FULL + 1);
    for (let s = 0; s <= FULL; s += 1) {
      if (!cur[s]) continue;
      for (const value of grid) if (s + value <= FULL) next[s + value] = 1;
    }
    cur = next;
  }
  return cur[FULL] === 1;
}

interface CorpusPaper {
  id: string;
  histogram: Blueprint["scoreHistogram"];
  types: QuestionType[];
}

/** 신뢰 가드(11 §11)를 통과한 편만 — 잘린 시험지의 눈금은 그 학교 관행이 아니다. */
function loadCorpus(): CorpusPaper[] {
  const papers: CorpusPaper[] = [];
  for (const batch of BATCHES) {
    const dir = join(CORPUS_DIR, batch);
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith(".json"))) {
      let parsed: { questions?: Array<{ score?: number; type?: string }> };
      try {
        parsed = JSON.parse(readFileSync(join(dir, file), "utf8"));
      } catch {
        continue;
      }
      const questions = parsed.questions ?? [];
      if (questions.length < MIN_QUESTIONS) continue;
      const scores = questions.map((q) => q.score);
      if (scores.some((s) => typeof s !== "number" || s <= 0)) continue;
      const total = (scores as number[]).reduce((a, b) => a + b, 0);
      if (total < FULL_MARK_MIN || total > FULL_MARK_MAX) continue;

      const counts = new Map<number, number>();
      for (const score of scores as number[]) {
        counts.set(score, (counts.get(score) ?? 0) + 1);
      }
      papers.push({
        id: `${batch}/${file}`,
        histogram: [...counts.entries()]
          .sort((a, b) => a[0] - b[0])
          .map(([score, count]) => ({ score, count })),
        types: questions.map((q) =>
          q.type === "서술형" ? "서술형" : q.type === "단답형" ? "단답형" : "객관식",
        ),
      });
    }
  }
  return papers;
}

describe.skipIf(!hasCorpus)("[T7.9] 배점 보정기 — 실측 코퍼스 전수", () => {
  it("실제 학교 눈금으로 돌려도 불변식이 깨지지 않는다", () => {
    const papers = loadCorpus();
    expect(papers.length).toBeGreaterThan(500);

    let cases = 0;
    let reached = 0;
    let missed = 0;
    const reasons = new Map<string, number>();

    for (const paper of papers) {
      const gridCenti = paper.histogram.map((h) => Math.round(h.score * 100));
      const gridValues = new Set(paper.histogram.map((h) => h.score));

      // 예측 문항 수는 실제와 어긋난다 — 원래 문항 수 주변으로 흔들어 본다.
      for (const delta of [-2, 0, 3]) {
        const count = paper.types.length + delta;
        if (count < MIN_QUESTIONS) continue;
        cases += 1;

        const questions: NormalizerQuestion[] = Array.from(
          { length: count },
          (_, i) => ({
            number: i + 1,
            qtype: paper.types[i] ?? "객관식",
            difficultyLabel: null,
            originalScore: null,
          }),
        );
        const result = normalizeScores({
          questions,
          histogram: paper.histogram,
        });

        if (result.ok) {
          reached += 1;
          expect(result.totalScore).toBe(100);
          expect(sumScores(result.questions.map((q) => q.score))).toBe(100);
          const offGrid = result.questions.find((q) => !gridValues.has(q.score));
          if (offGrid) {
            throw new Error(
              `${paper.id} n=${count} — 눈금 밖 배점 ${offGrid.score}`,
            );
          }
          continue;
        }

        reasons.set(result.reason, (reasons.get(result.reason) ?? 0) + 1);
        if (result.reason === "합계_100_불가" && reachable(gridCenti, count)) {
          missed += 1;
        }
      }
    }

    // 만들 수 있는데 "못 만든다"고 말하면 그것도 거짓말이다.
    expect(missed).toBe(0);
    // 실측 기준선 — 2026-08-16 측정치는 4,344건 중 4,272건(98.3%)이었다.
    expect(reached / cases).toBeGreaterThan(0.95);
    expect(reasons.get("눈금_해상도_초과") ?? 0).toBe(0);
  }, 600_000);
});
