/**
 * HWP 수식 키워드 **정본 어휘** — 손 목록 금지.
 *
 * 이 테스트가 지키는 것:
 *  1. 어휘가 변환기 정본에서 왔는가 (하드코딩한 낱말이 아닌가).
 *  2. `le`/`ge` 를 부등호로 옮길 때 **막아야 할 낱말을 실제로 막는가**.
 *     `rpile`·`left`·`angle` 안의 `le` 를 부등호로 읽으면 행렬과 괄호가 부서진다.
 *     이건 가정이 아니라 실측이다 — DB 에 `left( rpile-1&&1#0&&-3 right)` 이 있다.
 */
import { describe, expect, it } from "vitest";

import {
  HWP_REVERSE,
  HWP_STRUCT,
  HWP_TOKENS,
  blockingKeyword,
  isCanonicalHwpToken,
} from "../../../scripts/qa/hwpVocab";

describe("[hwpVocab] 정본에서 뽑은 어휘", () => {
  it("변환기 맵이 통째로 실려 있다 — 손으로 적은 십여 개가 아니다", () => {
    expect(HWP_TOKENS.length).toBeGreaterThan(100);
    expect(Object.keys(HWP_REVERSE).length).toBeGreaterThan(100);
  });

  it("과거에 놓쳤던 키워드가 어휘에 있다 (DIVIDE 사건 재발 방지)", () => {
    // 2026-08-17: 지표가 `DIV` 를 `(?![A-Za-z])` 로 닫아 `DIVIDE` 를 영영 0 으로 셌다.
    expect(isCanonicalHwpToken("DIV")).toBe(true);
    expect(isCanonicalHwpToken("TIMES")).toBe(true);
    expect(isCanonicalHwpToken("CDOTS")).toBe(true);
  });

  it("구조 키워드에 `pile` 변종이 다 들어 있다 — 정본 `_STRUCT` 는 `pile` 만 안다", () => {
    for (const kw of ["pile", "rpile", "lpile", "cpile", "over", "left"]) {
      expect(HWP_STRUCT).toContain(kw);
    }
  });
});

describe("[blockingKeyword] `le`/`ge` 치환을 막아야 하는 낱말", () => {
  it("행렬 정렬 키워드 `rpile` 을 막는다 — 실측 12 span", () => {
    expect(blockingKeyword("rpile")).toBe("rpile");
  });

  it("`left` 를 막는다 — 백슬래시가 떨어져 나간 잔재가 실제로 있다", () => {
    expect(blockingKeyword("left")).toBe("left");
  });

  it("`angle` · `triangle` 을 막는다 — 원장님이 지목한 영어 낱말 함정", () => {
    expect(blockingKeyword("angle")).toBe("angle");
    expect(blockingKeyword("triangle")).toBe("triangle");
  });

  it("진짜 부등호 잔재는 막지 않는다", () => {
    for (const run of ["le", "ge", "xle", "lexle", "age", "alemleb", "xyle"]) {
      expect(blockingKeyword(run)).toBeNull();
    }
  });

  it("두 글자 키워드는 부분 문자열로 막지 않는다 — 그러면 전부 막힌다", () => {
    // `in`·`to`·`of`·`pi` 같은 두 글자 토큰을 부분 문자열로 쓰면
    // `xinle`·`xtole` 같은 정상 잔재까지 통째로 막혀 규칙이 무력해진다.
    expect(blockingKeyword("xin")).toBeNull();
    expect(blockingKeyword("ito")).toBeNull();
  });
});
