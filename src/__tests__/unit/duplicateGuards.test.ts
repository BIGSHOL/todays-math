/**
 * 🔴 중복 입력이 두 곳의 가드를 통째로 뚫었다 — 적대적 리뷰 재현.
 *
 * 둘 다 뿌리가 같다: **개수만 세고 중복을 보지 않았다.**
 *
 * 1) 수동 배점 조정 — 같은 문항 번호를 여러 번 담아 보내면 합계가 100 으로 계산되지만
 *    실제 저장된 시험지 만점은 100 이 아니다(재현에서 148점 시험지가 남았다).
 *    D-42(합계 100)와 D-45(만점 100 아닌 시험지는 출제·채점에서 제외)를 동시에 우회한다.
 *
 * 2) 채점 — 같은 문항 응답을 두 번 보내면 "모든 문항에 응답이 필요하다" 검사가
 *    `Set` 크기만 보기 때문에 통과하고, 그 문항의 배점이 **두 번 더해진다.**
 *    예측 문제지는 만점 100 을 보장하므로 중복 한 건이 곧 만점 초과 점수가 된다.
 */
import { describe, expect, it } from "vitest";

import { validateManualScores } from "@/lib/predictor/scoreNormalizer";

describe("[T7.19] 수동 배점 조정 — 중복 문항 번호", () => {
  it("🔴 같은 번호를 여러 번 세어 100 을 만들 수 없다", () => {
    // 25문항 시험지인데 1번을 24번 담고 2번을 한 번 담았다. 합은 정확히 100 이지만
    // 실제로는 두 문항만 갱신되고 나머지 23문항은 옛 배점 그대로 남는다.
    const questions = [
      ...Array.from({ length: 24 }, () => ({ number: 1, score: 2 })),
      { number: 2, score: 52 },
    ];
    const check = validateManualScores(questions);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toContain("중복");
  });

  it("중복이 없으면 그대로 통과한다", () => {
    const questions = [
      { number: 1, score: 50 },
      { number: 2, score: 50 },
    ];
    expect(validateManualScores(questions).ok).toBe(true);
  });

  it("중복 안내에 어느 번호가 겹쳤는지 적는다 — 원장이 고칠 수 있어야 한다", () => {
    const check = validateManualScores([
      { number: 3, score: 40 },
      { number: 3, score: 30 },
      { number: 7, score: 30 },
    ]);
    expect(check.ok).toBe(false);
    expect(check.ok === false && check.message).toContain("3");
  });
});
