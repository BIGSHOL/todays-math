/**
 * 🔴 RED → 🟢 GREEN — 「AI 가 도형에 없는 값을 지어 넣었는가」 (D-55, 2026-08-19).
 *
 * 실측 표본이 이 검사를 만든 이유다. 프롬프트가 「지어내지 마십시오」라고 시켰는데
 * 그대로 어겼고, 그 스펙은 엔진을 **성공적으로 통과**했다 — 그럴듯하게 그려진 오답이다.
 */
import { describe, expect, it } from "vitest";

import { figureFabricationReason } from "@/lib/figure/figureMatchesContent";

/**
 * 2026-08-19 실제로 DeepSeek 이 낸 스펙의 요지.
 * 본문은 「반지름의 길이가 $12cm$ 인 원에서 색칠한 부분의 넓이를 구하시오」뿐인데
 * 도형에는 35°·45°·25°·15° 가 찍혀 있었다.
 */
const 지어낸_스펙 = {
  version: 2,
  points: { O: [0, 0], A: [85, 0], B: [60, 60] },
  circles: { c: { center: "O", radius: 85 } },
  angles: {
    a1: { vertex: "O", points: ["A", "B"], label: "35°" },
    a2: { vertex: "O", points: ["B", "A"], label: "45°" },
  },
  dimensions: { d1: { points: ["O", "A"], label: "12 cm" } },
  labels: { O: "O", A: "A", B: "B" },
};

const 본문 =
  "오른쪽 그림과 같이 반지름의 길이가 $12cm$인 원에서 색칠한 부분의 넓이를 구하시오.";

describe("[D-55] figureFabricationReason", () => {
  it("본문에 없는 각도를 넣으면 사유와 함께 잡는다 (실측 표본)", () => {
    const reason = figureFabricationReason(지어낸_스펙, 본문);
    expect(reason).not.toBeNull();
    // 무엇이 문제인지 원장님이 바로 읽을 수 있어야 한다.
    expect(reason).toContain("35");
    expect(reason).toContain("45");
  });

  it("본문에 있는 값만 쓰면 통과한다", () => {
    const 정직한_스펙 = {
      version: 2,
      points: { O: [0, 0], A: [85, 0] },
      circles: { c: { center: "O", radius: 85 } },
      dimensions: { d1: { points: ["O", "A"], label: "12 cm" } },
      labels: { O: "O", A: "A" },
    };
    expect(figureFabricationReason(정직한_스펙, 본문)).toBeNull();
  });

  it("좌표·반지름의 숫자는 보지 않는다 — 지면에 안 찍히는 배치값이다", () => {
    // radius 85·좌표 85 는 본문에 없지만 글자로 찍히지 않는다. 이걸 잡으면
    // 정상 도형이 전부 「지어냄」이 되어 판정이 쓸모없어진다.
    const spec = {
      version: 2,
      points: { O: [0, 0], A: [85, 0], B: [0, 137] },
      circles: { c: { center: "O", radius: 85 } },
      segments: { OA: ["O", "A"] },
      labels: { O: "O", A: "A" },
    };
    expect(figureFabricationReason(spec, "원 $O$ 에서 $x$ 의 값을 구하시오.")).toBeNull();
  });

  it("표기가 달라도 숫자가 같으면 통과한다 ($12cm$ ↔ 12 cm)", () => {
    const spec = {
      version: 2,
      dimensions: { d1: { points: ["A", "B"], label: "12 cm" } },
    };
    expect(figureFabricationReason(spec, "한 변이 $12cm$ 인 정사각형")).toBeNull();
  });

  it("labels 가 객체 꼴이어도 그 안의 text 를 본다", () => {
    const spec = {
      version: 2,
      labels: { A: { text: "7 cm", position: "auto" } },
    };
    expect(figureFabricationReason(spec, "한 변이 $12cm$ 인 정사각형")).toContain(
      "7",
    );
  });

  it("숫자가 없는 라벨(점 이름)은 지어냄이 아니다", () => {
    const spec = { version: 2, labels: { A: "A", B: "B", O: "O" } };
    expect(figureFabricationReason(spec, "원 $O$ 의 넓이")).toBeNull();
  });
});
