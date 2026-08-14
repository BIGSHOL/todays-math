import { describe, expect, it } from "vitest";

import { isProblemAccessible, problemVisibleWhere } from "@/lib/problemPool";

describe("[D-31] 공용 풀 조회 조건", () => {
  it("shared 또는 본인 userId를 본다", () => {
    expect(problemVisibleWhere("user-1")).toEqual({
      OR: [{ pool: "shared" }, { userId: "user-1" }],
    });
  });

  it("공용 문항은 누구나 접근하고 private는 소유자만 접근한다", () => {
    expect(isProblemAccessible({ pool: "shared", userId: "other" }, "me")).toBe(
      true,
    );
    expect(isProblemAccessible({ pool: "private", userId: "me" }, "me")).toBe(
      true,
    );
    expect(
      isProblemAccessible({ pool: "private", userId: "other" }, "me"),
    ).toBe(false);
  });
});
