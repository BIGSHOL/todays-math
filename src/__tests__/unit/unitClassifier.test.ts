/**
 * 트랙 G — 힌트 없는 문항의 소단원 판정기.
 *
 * ⚠️ 여기 픽스처는 **로직**(후보 제한·기권·대체 경로)만 지킨다.
 * **정확도는 합성 픽스처로 증명할 수 없다** — 합성 픽스처가 이관 결함을 통과시킨
 * 전례가 있다(tracks/README.md). 정확도는 실데이터 23,166문항을 편 단위로 가른
 * `scripts/classify/evaluate-classifier.ts` 가 잰다.
 */
import { describe, expect, it } from "vitest";
import { extractFeatures, problemText } from "@/lib/classify/features";
import { classify, rangeKey, scoreCandidates, train, type LabeledDoc } from "@/lib/classify/unitClassifier";

const doc = (
  externalId: string, examId: string, unitId: string, text: string,
  gradeKey = "중2", semester: number | null = 1, round: string | null = "중간",
): LabeledDoc => ({ externalId, examId, unitId, gradeKey, semester, round, text });

describe("extractFeatures", () => {
  it("수식 명령을 토큰으로 남긴다 — 단원을 강하게 가르는 단서다", () => {
    expect(extractFeatures(String.raw`값은 $\sin \theta$ 이다`)).toContain(String.raw`C\sin`);
  });

  it("수식 구간 안의 글자는 한글 n-gram 으로 세지 않는다", () => {
    const features = extractFeatures("$일차함수$ 이차함수");
    expect(features).toContain("K이차");
    expect(features).not.toContain("K일차");
  });

  it("같은 특징이 여러 번 나와도 한 번만 센다 — 긴 문항이 과대 대표되지 않게", () => {
    const features = extractFeatures("함수 함수 함수");
    expect(features.filter((f) => f === "K함수")).toHaveLength(1);
  });

  it("본문과 선택지를 함께 본다", () => {
    expect(problemText("문제", ["보기1", "보기2"])).toBe("문제 보기1 보기2");
  });
});

describe("scoreCandidates", () => {
  const model = train([
    doc("1-1", "1", "u-소인수", "소인수분해를 이용하여 최대공약수를 구하시오"),
    doc("1-2", "1", "u-소인수", "자연수를 소인수분해 하시오"),
    doc("2-1", "2", "u-일차", "일차방정식을 풀어 해를 구하시오"),
    doc("2-2", "2", "u-일차", "일차방정식의 해가 되는 값을 구하시오"),
  ]);

  it("범위 사전에 있는 단원만 후보로 놓는다", () => {
    const ranked = scoreCandidates(model, { gradeKey: "중2", semester: 1, round: "중간", text: "소인수분해" });
    expect(new Set(ranked.map((r) => r.unitId))).toEqual(new Set(["u-소인수", "u-일차"]));
  });

  it("본문이 닮은 단원을 위로 올린다", () => {
    const ranked = scoreCandidates(model, { gradeKey: "중2", semester: 1, round: "중간", text: "소인수분해 하시오" });
    expect(ranked[0].unitId).toBe("u-소인수");
  });

  it("범위 조합이 학습셋에 없으면 학년 사전으로 물러선다", () => {
    const ranked = scoreCandidates(model, { gradeKey: "중2", semester: 2, round: "기말", text: "일차방정식" });
    expect(ranked.length).toBeGreaterThan(0);
    expect(ranked[0].unitId).toBe("u-일차");
  });

  it("학년 자체를 모르면 후보가 없다", () => {
    expect(scoreCandidates(model, { gradeKey: "고3", semester: 1, round: "중간", text: "무엇" })).toHaveLength(0);
  });
});

describe("classify", () => {
  const model = train([
    doc("1-1", "1", "u-소인수", "소인수분해를 이용하여 최대공약수를 구하시오"),
    doc("1-2", "1", "u-소인수", "자연수를 소인수분해 하시오"),
    doc("2-1", "2", "u-일차", "일차방정식을 풀어 해를 구하시오"),
    doc("2-2", "2", "u-일차", "일차방정식의 해가 되는 값을 구하시오"),
  ]);
  const query = { gradeKey: "중2", semester: 1, round: "중간", text: "소인수분해 하시오" };

  it("확신이 문턱을 넘으면 붙인다", () => {
    const result = classify(model, query, 0.5);
    expect(result.status).toBe("mapped");
    if (result.status === "mapped") {
      expect(result.unitId).toBe("u-소인수");
      expect(result.confidence).toBeGreaterThan(0.5);
      expect(result.confidence).toBeLessThanOrEqual(1);
    }
  });

  it("문턱에 못 미치면 붙이지 않고 미분류로 남긴다 — 틀리게 붙이는 것보다 낫다", () => {
    expect(classify(model, query, 0.999).status).toBe("unclassified");
  });

  it("후보 범위를 못 만들면 미분류다", () => {
    const result = classify(model, { gradeKey: "고3", semester: 1, round: "중간", text: "무엇" }, 0.5);
    expect(result.status).toBe("unclassified");
  });

  it("문턱이 무한대인 학년(보정값 없음)은 절대 채택되지 않는다", () => {
    expect(classify(model, query, Number.POSITIVE_INFINITY).status).toBe("unclassified");
  });
});

describe("rangeKey", () => {
  it("학년·학기·회차를 한 키로 묶는다", () => {
    expect(rangeKey("중2", 1, "중간")).toBe("중2|1|중간");
  });

  it("빠진 값도 키로 만든다 — 던지면 판정이 통째로 멈춘다", () => {
    expect(rangeKey("중2", null, null)).toBe("중2|?|?");
  });
});
