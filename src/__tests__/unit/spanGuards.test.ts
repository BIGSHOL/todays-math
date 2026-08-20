/**
 * 🔴 **덩어리 단위 판정** — 한 덩어리가 걸릴 때 그 행 전부를 버리면 안 된다.
 *
 * 실측: 행 단위로 걸었더니 107행이 통째로 버려졌고, 그 안에서 「변환 대상인데
 * 안 고쳐진」 문항이 102개였다. 대부분은 `{13} over {20}` 처럼 아무 문제 없이
 * 바뀌는 덩어리였다. 판정 단위는 **바꾸는 단위와 같아야 한다.**
 */
import { describe, expect, it } from "vitest";

import { mergeLedgerRows } from "../../../scripts/qa/repair-solution-hwp";
import type { SpanPiece } from "../../../scripts/qa/spanGuards";
import {
  judgeConverted,
  spliceAccepted,
  빈분수,
  수,
} from "../../../scripts/qa/spanGuards";

const B = String.fromCharCode(92);

describe("judgeConverted — 바뀐 덩어리를 받아들일지", () => {
  it("멀쩡한 변환은 통과한다", () => {
    expect(judgeConverted("{13} over {20}", `${B}frac{13}{20}`)).toEqual({
      ok: true,
    });
  });

  it("변환에 실패했으면 안 바꾼다", () => {
    expect(judgeConverted("a over b", null)).toMatchObject({ ok: false });
  });

  it("바뀐 것이 없으면 안 바꾼다", () => {
    expect(judgeConverted("x+1", "x+1")).toMatchObject({ ok: false });
  });

  /**
   * 🔴 결과에 맨 키워드가 남으면 **지면에 글자로 나간다.** 이 자리는
   * `scopeOf` 로는 구조적으로 못 본다 — 변환한 덩어리엔 역슬래시가 늘 있다.
   */
  it("잔재가 남으면 버린다 — `sqrt {3} of 3` 의 날 `of`", () => {
    const v = judgeConverted("sqrt {3} of 3", `${B}sqrt{3}of3`);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.남은).toContain("of");
  });

  it("🔴 `\\overline{OF}` 의 `OF` 는 잔재가 아니다 — 점 O·F 선분이다", () => {
    expect(judgeConverted("bar{OF}", `${B}overline{OF}`)).toEqual({ ok: true });
  });

  it("한글을 잃으면 버린다", () => {
    expect(judgeConverted("a over b 이고", `${B}frac{a}{b}`)).toMatchObject({
      ok: false,
    });
  });

  /**
   * 🔴 수는 **개수까지** 센다. 집합으로 세면 같은 수가 또 있을 때 손실이
   * 구조적으로 안 보인다 — 실측으로 이 규칙이 6행을 더 잡았다.
   */
  it("같은 수가 둘인데 하나를 잃으면 잡아낸다", () => {
    expect(수("1 2 2 3").get("2")).toBe(2);
    expect(
      judgeConverted(
        "{1} over {2} + {1} over {2}",
        `${B}frac{1}{2}+${B}frac{1}{}`,
      ),
    ).toMatchObject({ ok: false });
  });

  it("빈 분수가 새로 생기면 버린다", () => {
    expect(빈분수(`${B}frac{${B}pi}{}`)).toBe(1);
    expect(judgeConverted("LE pi over", `${B}frac{${B}pi}{}`)).toMatchObject({
      ok: false,
    });
  });
});

describe("spliceAccepted — 걸린 덩어리 하나가 그 행 전부를 버리게 하지 않는다", () => {
  /** `$…$` 를 훑어 갈아 끼울 자리를 만든다 — 제품과 같은 방식. */
  const piecesOf = (text: string, outs: (string | null)[]) => {
    const ps: SpanPiece[] = [];
    let i = 0;
    for (const m of text.matchAll(/\$([^$]*)\$/g))
      ps.push({
        start: m.index,
        end: m.index + m[0].length,
        body: m[1]!,
        out: outs[i++] ?? null,
      });
    return ps;
  };

  const 행 = "먼저 $a over b$ 이고 그다음 $sqrt {3} of 3$ 이다.";

  it("🔴 뒤 덩어리가 걸려도 **앞 덩어리는 고친다**", () => {
    const r = spliceAccepted(
      행,
      piecesOf(행, [`${B}frac{a}{b}`, `${B}sqrt{3}of3`]),
    );
    expect(r.바꾼수).toBe(1);
    expect(r.after).toContain(`$${B}frac{a}{b}$`);
    // 못 고친 덩어리는 **원래 글자 그대로** 남는다 — 지금까지와 같은 상태다.
    expect(r.after).toContain("$sqrt {3} of 3$");
    expect(r.버림.map((b) => b.why)).toEqual(["잔재가 남았다"]);
  });

  it("하나도 못 고치면 바꾼 수가 0이라 그 행은 안 쓴다", () => {
    const r = spliceAccepted(행, piecesOf(행, [null, `${B}sqrt{3}of3`]));
    expect(r.바꾼수).toBe(0);
    expect(r.after).toBe(행);
  });

  /**
   * 🔴 뒤에서부터 갈아 끼우지 않으면 **앞자리를 바꾼 순간 뒤 자리 오프셋이
   *    흔들려** 엉뚱한 곳을 자른다. 길이가 달라지는 변환으로 못 박는다.
   */
  it("길이가 크게 달라져도 두 자리를 정확히 갈아 끼운다", () => {
    const t = "$a over b$와 $c over d$";
    const r = spliceAccepted(
      t,
      piecesOf(t, [`${B}frac{aaaaaaaaaa}{b}`, `${B}frac{c}{d}`]),
    );
    expect(r.바꾼수).toBe(2);
    expect(r.after).toBe(`$${B}frac{aaaaaaaaaa}{b}$와 $${B}frac{c}{d}$`);
  });
});

describe("mergeLedgerRows — 되돌리기 원장은 누적한다", () => {
  const row = (id: string, before: string, after: string) => ({
    id,
    code: id,
    before,
    after,
    spans: 1,
  });

  it("앞 회차 행을 잃지 않는다", () => {
    const prev = [row("a", "A0", "A1"), row("b", "B0", "B1")];
    const got = mergeLedgerRows(prev, [row("c", "C0", "C1")]);
    expect(got.map((r) => r.id).sort()).toEqual(["a", "b", "c"]);
  });

  /**
   * 🔴 같은 문항이 두 번 나오면 **처음의 `before`** 를 남긴다.
   *    마지막 `before` 를 쓰면 1차가 만든 값으로 되돌아가 「되돌렸다고 하면서
   *    아무것도 안 되돌린 것」이 된다.
   */
  it("두 번 고친 문항은 처음 before · 마지막 after 를 남긴다", () => {
    const got = mergeLedgerRows(
      [row("a", "날것", "1차결과")],
      [row("a", "1차결과", "2차결과")],
    );
    expect(got).toHaveLength(1);
    expect(got[0]).toMatchObject({ before: "날것", after: "2차결과" });
  });
});
