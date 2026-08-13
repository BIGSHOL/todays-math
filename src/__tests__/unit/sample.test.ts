// T0.4 인프라 검증용 샘플 테스트 (실제 기능 테스트는 T0.5.3에서 작성)
import { describe, expect, it } from "vitest";

import { sum } from "@/__tests__/unit/__fixtures__/sum";

describe("[인프라 샘플] sum", () => {
  it("두 숫자를 더한 값을 반환한다", () => {
    expect(sum(2, 3)).toBe(5);
  });
});
