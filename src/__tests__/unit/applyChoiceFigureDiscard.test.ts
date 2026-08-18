/**
 * 🟢 회귀 가드 — 짝을 못 찾은 문항을 **출제에서 뺄 때**의 가드들.
 *
 * ## 이 파일이 막는 사고는 실제로 났다
 *
 * 첫 판에서 **43건이 433건이 됐다.** 회수기는 판정을 반증하려고 «미분류»(그림 2장
 * 이상인 서술형 등)와 «반대쪽»(보기가 진짜 글자)까지 **일부러 넓게** 돌린다.
 * 그 둘의 «불가» 는 「못 쓰는 문항」이 아니라 **「보기 그림 문항이 아니다」**는 뜻이다.
 * 무리를 안 거르면 **멀쩡한 문항 390건이 함께 출제에서 빠진다.**
 *
 * 그게 눈에 띈 것은 D-20 집계였다 — 영향 단원이 25개가 아니라 **100개**였고
 * 정원 아래로 내려가는 단원이 **2개** 나왔다. 숫자를 세지 않았으면 못 봤다.
 *
 * ## 빼는 것은 **영구 삭제가 아니다**
 *
 * `directUseAllowed=false` 는 그림 유실 856건에 쓴 것과 **같은 방식**이다.
 * 원장에 행마다 이전 값과 사유를 남기므로 되살릴 수 있다.
 */
import { describe, expect, it } from "vitest";

import {
  classifyDiscard,
  decideDiscard,
  revertDiscard,
  type LockedRow,
} from "../../../scripts/qa/apply-choice-figure-discard";

const row = (over: Partial<Parameters<typeof decideDiscard>[1]> = {}) =>
  ({
    id: "p1",
    externalId: "ext-1",
    directUseAllowed: true,
    content: "다음 중 옳은 것은?\n1. 가\n2. 나\n3. 다\n4. 라\n5. 마",
    unitId: "u1",
    school: "가상중",
    questionNumber: 3,
    pool: "shared",
    reviewStatus: "approved",
    noAnswer: false,
    ...over,
  }) as NonNullable<Parameters<typeof decideDiscard>[1]>;

const pair = (verdict = "불가") => ({
  id: "p1",
  verdict,
  why: "원본 메타 없음",
});

describe("빼는 경우", () => {
  it("«보기그림» 무리의 «불가» 는 뺀다", () => {
    const d = decideDiscard(pair(), row(), false, true);
    expect(d.lock).toBe(true);
  });

  it("왜 망가졌는지 부류를 같이 남긴다 — 되살릴 길이 다르다", () => {
    const d = decideDiscard(pair(), row(), false, true);
    expect(d.lock && d.부류).toBe("짝을 못 찾음 — 원본을 다시 구해야 산다");
  });
});

describe("🔴 안 빼는 경우 — 멀쩡한 문항을 쓸어 담지 않는다", () => {
  it("🔴 «보기그림» 무리가 아니면 안 뺀다 — **43 이 433 이 된 그 결함**", () => {
    const d = decideDiscard(pair(), row(), false, false);
    expect(d).toEqual({
      lock: false,
      reason: "«보기그림» 무리가 아니다 (판정 대상 밖)",
    });
  });

  it("🔴 «자동»(짝을 되찾음)은 안 뺀다", () => {
    const d = decideDiscard(pair("자동"), row(), false, true);
    expect(d.lock).toBe(false);
  });

  it("🔴 «사람확인» 은 안 뺀다 — 사람이 보면 되는 것이지 못 쓰는 게 아니다", () => {
    const d = decideDiscard(pair("사람확인"), row(), false, true);
    expect(d).toEqual({ lock: false, reason: "«불가» 가 아니다 (사람확인)" });
  });

  it("🔴 그림 유실 원장에 이미 있으면 안 뺀다 — 되돌릴 때 서로 풀어 버린다", () => {
    const d = decideDiscard(pair(), row(), true, true);
    expect(d).toEqual({ lock: false, reason: "그림 유실 원장에 이미 있다" });
  });

  it("이미 빠져 있으면 안 건드린다 (멱등)", () => {
    const d = decideDiscard(
      pair(),
      row({ directUseAllowed: false }),
      false,
      true,
    );
    expect(d).toEqual({ lock: false, reason: "이미 빠져 있다 (멱등)" });
  });

  it("DB 에 행이 없으면 안 건드린다", () => {
    expect(decideDiscard(pair(), undefined, false, true).lock).toBe(false);
  });
});

describe("무엇이 망가졌나 — 부류", () => {
  it("보기 한 벌이 셋 이상이면 «문항 병합»", () => {
    const merged =
      "문제 하나?\n1. 가\n2. 나\n3. 다\n4. 라\n5. 마\n" +
      "문제 둘?\n1. 가\n2. 나\n3. 다\n4. 라\n5. 마\n" +
      "문제 셋?\n1. 가\n2. 나\n3. 다\n4. 라\n5. 마";
    expect(classifyDiscard(merged)).toContain("문항 병합");
  });

  it("아무 신호도 없으면 «짝을 못 찾음» — 원본을 다시 구해야 산다", () => {
    expect(classifyDiscard("다음 중 옳은 것은?")).toContain("짝을 못 찾음");
  });
});

describe("되돌리기 — 영구 삭제가 아니다", () => {
  const locked: LockedRow = {
    id: "p1",
    externalId: "ext-1",
    directUseAllowed: true,
    school: "가상중",
    questionNumber: 3,
    사유: "원본 메타 없음",
    부류: "짝을 못 찾음 — 원본을 다시 구해야 산다",
  };

  it("우리가 뺀 행이면 이전 값으로 되돌린다", () => {
    expect(revertDiscard(locked, { directUseAllowed: false })).toEqual({
      restore: true,
      to: true,
    });
  });

  it("🔴 되돌릴 값은 **원장에 적힌 값** 그대로다 — `true` 로 박으면 안 된다", () => {
    // 오늘 데이터에서는 뺀 행이 전부 `true` 였으므로 늘 `true` 로 돌아간다.
    // 그래도 «원장을 읽는다»와 «true 를 박는다»는 다른 코드다 — 나중에 이미
    // 빠져 있던 행까지 원장에 담는 변형이 생기면, 박아 둔 `true` 가 그 행을
    // 조용히 **출제 풀에 되돌려 놓는다.** 원장이 진실의 근거여야 한다.
    expect(
      revertDiscard(
        { ...locked, directUseAllowed: false },
        { directUseAllowed: false },
      ),
    ).toEqual({ restore: true, to: false });
  });

  it("🔴 이미 누가 풀었으면 안 건드린다 — 남의 변경을 덮지 않는다", () => {
    const d = revertDiscard(locked, { directUseAllowed: true });
    expect(d.restore).toBe(false);
    expect(d.restore === false && d.reason).toContain("남의 변경");
  });

  it("DB 에 행이 없으면 안 건드린다", () => {
    expect(revertDiscard(locked, undefined).restore).toBe(false);
  });
});
