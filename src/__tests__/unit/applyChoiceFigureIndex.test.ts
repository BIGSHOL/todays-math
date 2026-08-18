/**
 * 🟢 회귀 가드 — 보기 그림 짝 **적재 스크립트의 가드들**.
 *
 * ## 왜 이 파일이 있는가
 *
 * 가드를 `main()` 안에 두면 DB 없이는 시험할 수 없고, 그러면 「가드가 있다」는 말만
 * 남는다. 이 저장소는 그래서 **변이 테스트**를 쓴다 — 망가뜨려 봐야 가드인 줄 안다.
 * 여기서는 판단을 순수 함수(`planRow`)로 떼어 내 **가드마다 반증 표본**을 댄다.
 *
 * ## 이 가드들이 막는 것은 하나다 — **그럴듯한 거짓말**
 *
 * 원장님 확정(2026-08-18): 짝을 모르는 문항은 빈 배열로 두고 지면은 오늘처럼 그린다.
 * 지금은 못 푸는 문항이 **못 푸는 채로 보인다.** 틀린 짝은 **그럴듯해 보이면서
 * 틀린다** — 학생이 ③을 골랐는데 그게 ③이 아니다. 그건 지금보다 나쁘다.
 * 그래서 아래 테스트는 「쓰는 것」보다 **「안 쓰는 것」**을 훨씬 많이 센다.
 */
import { describe, expect, it } from "vitest";

import {
  planRow,
  revertRow,
  type DbRow,
  type LedgerRow,
  type Pair,
} from "../../../scripts/qa/apply-choice-figure-index";

const URLS = [
  "/figures/5427/q13.jpeg",
  "/figures/5427/q13_1.jpeg",
  "/figures/5427/q13_2.jpeg",
  "/figures/5427/q13_3.jpeg",
  "/figures/5427/q13_4.jpeg",
];

const db = (over: Partial<DbRow> = {}): DbRow => ({
  id: "p1",
  figureUrls: URLS,
  choiceFigureIndex: [],
  examId: "5427",
  questionNumber: 13,
  ...over,
});

const pair = (over: Partial<Pair> = {}): Pair => ({
  id: "p1",
  verdict: "자동",
  why: "발문 0장 + 보기 5장",
  figureUrls: URLS,
  choiceFigureIndex: [1, 2, 3, 4, 5],
  ...over,
});

describe("쓰는 경우", () => {
  it("«자동» · 목록 그대로 · 규약 통과면 쓴다", () => {
    const d = planRow(pair(), db());
    expect(d.ok).toBe(true);
    if (!d.ok) return;
    expect(d.row.after).toEqual([1, 2, 3, 4, 5]);
    expect(d.row.before).toEqual([]); // 되돌리기의 근거
    expect(d.row.figureUrls).toEqual(URLS);
  });

  it("되돌리기 자료에 **적용 전 값**을 담는다", () => {
    // 실제로는 [] 이지만, 값이 있었다면 그 값이 그대로 실려야 한다.
    const d = planRow(pair(), db({ choiceFigureIndex: [] }));
    expect(d.ok && d.row.before).toEqual([]);
  });
});

describe("🔴 안 쓰는 경우 — 모르는 것을 그럴듯하게 채우지 않는다", () => {
  it("«자동» 이 아니면 손대지 않는다 (사람확인)", () => {
    const d = planRow(pair({ verdict: "사람확인" }), db());
    expect(d).toEqual({ ok: false, reason: "«자동» 이 아니다 (사람확인)" });
  });

  it("«자동» 이 아니면 손대지 않는다 (불가)", () => {
    const d = planRow(pair({ verdict: "불가" }), db());
    expect(d.ok).toBe(false);
  });

  it("🔴 멱등 — 이미 값이 있으면 건드리지 않는다", () => {
    const d = planRow(pair(), db({ choiceFigureIndex: [0, 1, 2, 3, 4] }));
    expect(d).toEqual({ ok: false, reason: "이미 값이 있다 (멱등)" });
  });

  it("🔴 그림 목록이 **한 장이라도 줄면** 안 쓴다 — 배열이 한 칸씩 밀린다", () => {
    // `prune-figures.mjs` 가 발문 그림을 뗀 상황. 색인이 가리키는 곳이 통째로 달라진다.
    const d = planRow(pair(), db({ figureUrls: URLS.slice(1) }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain("그림 목록이 바뀌었다");
  });

  it("🔴 그림 목록의 **순서만 달라져도** 안 쓴다", () => {
    const swapped = [URLS[1]!, URLS[0]!, ...URLS.slice(2)];
    const d = planRow(pair(), db({ figureUrls: swapped }));
    expect(d.ok).toBe(false);
    expect(d.ok === false && d.reason).toContain("그림 목록이 바뀌었다");
  });

  it("🔴 파일 하나가 **다른 경로로 바뀌어도** 안 쓴다 (길이는 같다)", () => {
    const replaced = [...URLS];
    replaced[2] = "/figures/5427/q13_9.jpeg";
    const d = planRow(pair(), db({ figureUrls: replaced }));
    expect(d.ok).toBe(false);
  });

  it("🔴 배열 길이가 그림 수와 다르면 안 쓴다", () => {
    const d = planRow(pair({ choiceFigureIndex: [1, 2, 3, 4] }), db());
    expect(d.ok === false && d.reason).toContain("규약 위반");
  });

  it("🔴 0 이 아닌 번호가 겹치면 안 쓴다 — 그림 둘이 같은 ③을 주장한다", () => {
    const d = planRow(pair({ choiceFigureIndex: [1, 2, 3, 3, 5] }), db());
    expect(d.ok === false && d.reason).toContain("규약 위반");
  });

  it("🔴 색인이 범위를 벗어나면 안 쓴다", () => {
    const d = planRow(pair({ choiceFigureIndex: [1, 2, 3, 4, 99] }), db());
    expect(d.ok === false && d.reason).toContain("규약 위반");
  });

  it("🔴 배열이 비었으면 안 쓴다 — «모른다» 는 쓰는 값이 아니다", () => {
    const d = planRow(pair({ choiceFigureIndex: [] }), db());
    expect(d.ok === false && d.reason).toContain("규약 위반");
  });

  it("DB 에 행이 없으면 안 쓴다", () => {
    expect(planRow(pair(), undefined)).toEqual({
      ok: false,
      reason: "DB 에 그 행이 없다",
    });
  });
});

describe("발문 그림이 섞인 모양", () => {
  it("첫 장이 발문(0)이어도 통과한다 — 실측 44건의 모양", () => {
    const six = [...URLS, "/figures/5427/q13_5.jpeg"];
    const d = planRow(
      pair({ figureUrls: six, choiceFigureIndex: [0, 1, 2, 3, 4, 5] }),
      db({ figureUrls: six }),
    );
    expect(d.ok).toBe(true);
  });

  it("발문 그림(0)은 여럿이어도 겹침으로 보지 않는다", () => {
    const seven = [
      ...URLS,
      "/figures/5427/q13_5.jpeg",
      "/figures/5427/q13_6.jpeg",
    ];
    const d = planRow(
      pair({ figureUrls: seven, choiceFigureIndex: [0, 0, 1, 2, 3, 4, 5] }),
      db({ figureUrls: seven }),
    );
    expect(d.ok).toBe(true);
  });
});

describe("되돌리기 — 안전망도 시험한다", () => {
  const ledger = (over: Partial<LedgerRow> = {}): LedgerRow => ({
    id: "p1",
    examId: "5427",
    questionNumber: 13,
    figureUrls: URLS,
    before: [],
    after: [1, 2, 3, 4, 5],
    why: "",
    ...over,
  });

  it("우리가 쓴 값이면 `before` 로 되돌린다", () => {
    const d = revertRow(ledger(), db({ choiceFigureIndex: [1, 2, 3, 4, 5] }));
    expect(d).toEqual({ restore: true, to: [] });
  });

  it("🔴 되돌릴 값은 원장의 `before` **그대로**다 — 빈 배열로 박으면 안 된다", () => {
    // 덮어쓰기 모드가 생기면 `before` 가 비어 있지 않을 수 있다. 그때
    // `[]` 를 박으면 되돌리기가 조용히 남의 값을 지운다.
    const d = revertRow(
      ledger({ before: [0, 1, 2, 3, 4] }),
      db({ choiceFigureIndex: [1, 2, 3, 4, 5] }),
    );
    expect(d).toEqual({ restore: true, to: [0, 1, 2, 3, 4] });
  });

  it("🔴 지금 값이 우리가 쓴 값과 다르면 **안 덮는다** (남의 변경 보호)", () => {
    const d = revertRow(ledger(), db({ choiceFigureIndex: [5, 4, 3, 2, 1] }));
    expect(d.restore).toBe(false);
    expect(d.restore === false && d.reason).toContain("남의 변경");
  });

  it("이미 되돌아가 있으면(빈 배열) 다시 안 건드린다 — 멱등", () => {
    const d = revertRow(ledger(), db({ choiceFigureIndex: [] }));
    expect(d.restore).toBe(false);
  });

  it("DB 에 행이 없으면 안 건드린다", () => {
    expect(revertRow(ledger(), undefined).restore).toBe(false);
  });
});
