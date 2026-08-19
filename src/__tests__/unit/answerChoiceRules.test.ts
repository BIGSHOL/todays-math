/**
 * 「정답과 보기가 안 맞는 문항」 판정기 회귀 가드.
 *
 * 픽스처는 **공유 DB 의 실제 본문**을 줄인 것이다(문항 id 를 주석에 적었다).
 * 기대값은 규칙에서 유도하지 않고 **눈으로 확인한 사실**을 리터럴로 박는다 —
 * 규칙에서 기대값을 만들면 규칙이 틀릴 때 같이 틀린다(2026-08-18 «지표의 참이
 * 제품 상수에서 나오면 성적이 오른다»).
 *
 * 변이 시험: `bash scripts/qa/mutate-answer-choice-rules.sh`
 */
import { describe, expect, it } from "vitest";

import { parseProblemContent } from "@/lib/problem/parseProblemContent";

import {
  choiceLabels,
  circledValue,
  FATAL_VERDICTS,
  isFatal,
  judgeAnswerChoice,
  knownCircledGlyphs,
  readAnswerRef,
} from "../../../scripts/qa/answerChoiceRules";

/** 성한 5지선다 (실측 형태: 마커가 줄머리에 하나씩). */
const HEALTHY = [
  "다음 중 옳은 것은?",
  "",
  "1. $3$",
  "2. $4$",
  "3. $5$",
  "4. $6$",
  "5. $7$",
].join("\n");

/** 0423f306 — `① 등변사다리꼴② 평행사변형` 이 한 줄에 붙어 ② 가 안 잡힌다. */
const GLUED = [
  "다음 사각형 중 두 대각선이 서로 다른 것을 수직이등분하는 것은?",
  "",
  "① 등변사다리꼴② 평행사변형",
  "",
  "③ 직사각형",
  "",
  "④ 마름모",
  "",
  "⑤ 정사각형",
].join("\n");

/** 03ec0212 장산중 5 — 두 열 지면이 1,3,5 / 2,4 순서로 흘러나왔다. */
const COLUMN_ORDER = [
  "이때, ㈎, ㈏, ㈐에 알맞은 것은?",
  "",
  "1. 가",
  "3. 다",
  "5. 마",
  "",
  "2. 나",
  "4. 라",
].join("\n");

/** 10bc6c2c 압량중 2 — 보기가 통째로 그림이라 본문에 마커가 없다. */
const NO_CHOICES = "다음 사각형 중에서 평행사변형이 아닌 것은?";

/** 435052cb 학산중 6 꼴 — 마커는 다섯인데 ⑤ 의 본문이 비어 지면에서 사라진다. */
const DROPPED_FIFTH = [
  "다음 중 옳은 것은?",
  "",
  "1. $가$",
  "2. $나$",
  "3. $다$",
  "4. $라$",
  "5. ",
].join("\n");

/** 17ab5850 구암중 10 꼴 — 여러 문항이 한 행에 뭉쳐 1..5 가 두 번 나온다. */
const MERGED_TWO = [
  "다음 중 옳은 것은?",
  "",
  "1. $가$",
  "2. $나$",
  "3. $다$",
  "4. $라$",
  "5. $마$",
  "",
  "1. $바$",
  "2. $사$",
  "3. $아$",
  "4. $자$",
  "5. $차$",
].join("\n");

/** 보기 목록이 **통째로 2회** 저장된 OCR 결함 — 제품이 절반으로 줄인다. */
const DUPLICATED_BLOCK = [
  "다음 중 옳은 것은?",
  "",
  "1. $가나다라마바사$",
  "2. $나다라마바사아$",
  "3. $다라마바사아자$",
  "4. $라마바사아자차$",
  "5. $마바사아자차카$",
  "",
  "1. $가나다라마바사$",
  "2. $나다라마바사아$",
  "3. $다라마바사아자$",
  "4. $라마바사아자차$",
  "5. $마바사아자차카$",
].join("\n");

describe("circledValue — 원문자 계열을 «계산»으로 읽는다", () => {
  it.each([
    ["①", 1],
    ["⑤", 5],
    ["⑮", 15],
    ["➀", 1], // U+2780 dingbat — 실측 41건이 이 글자를 쓴다
    ["➄", 5],
    ["❶", 1], // U+2776 negative circled
    ["⓵", 1], // U+24F5 double circled
    [String.fromCodePoint(0xf083), 3], // HWP 기호폰트 PUA (answer-notation 정본이 편다)
  ])("%s → %i", (glyph, expected) => {
    expect(circledValue(glyph)).toBe(expected);
  });

  it("세부문항·상자 라벨은 보기 번호가 아니다", () => {
    for (const ch of ["⑴", "⑵", "㉠", "㈎", "1", "a"])
      expect(circledValue(ch)).toBe(0);
  });

  it("아는 글자 목록에 다섯 계열이 모두 들어 있다", () => {
    const known = knownCircledGlyphs();
    for (const ch of ["①", "❶", "➀", "➊", "⓵"]) expect(known).toContain(ch);
  });
});

describe("choiceLabels — 지면에 찍히는 보기의 «원래 번호»", () => {
  it("성한 문항은 1..5", () => {
    expect(choiceLabels(HEALTHY)?.labels).toEqual([1, 2, 3, 4, 5]);
  });

  it("마커가 `1)` 꼴이어도 같은 번호로 읽는다", () => {
    const raw = HEALTHY.split("\n")
      .map((line) => line.replace(/^([1-5])\. /, "$1) "))
      .join("\n");
    expect(choiceLabels(raw)?.labels).toEqual([1, 2, 3, 4, 5]);
    expect(choiceLabels(raw)?.bodies).toEqual(parseProblemContent(raw).choices);
  });

  it("마커가 원문자여도 같은 번호로 읽는다", () => {
    const raw = HEALTHY.split("\n")
      .map((line) =>
        line.replace(/^([1-5])\. /, (_m, d: string) =>
          String.fromCodePoint(0x2460 + Number(d) - 1),
        ),
      )
      .join("\n");
    expect(choiceLabels(raw)?.labels).toEqual([1, 2, 3, 4, 5]);
  });

  it("본문이 제품 파서의 choices 와 글자 그대로 같다", () => {
    expect(choiceLabels(HEALTHY)?.bodies).toEqual(
      parseProblemContent(HEALTHY).choices,
    );
  });

  it("줄 중간에 붙은 ② 도 **R2 가 잡는다** — 라벨이 [1,2,3,4,5] (D-58)", () => {
    // 2026-08-19 원장님 확정 전에는 [1,3,4,5] 였다. 그때 ⑤ 는 네 번째 자리라
    // 지면에 ④ 로 찍혔고, 학생이 ⑤ 를 고를 칸이 없었다. R2 가 제품 파서에
    // 들어가면서 이 부류 27건이 살아났다.
    expect(choiceLabels(GLUED)?.labels).toEqual([1, 2, 3, 4, 5]);
  });

  it("두 열 지면은 라벨이 [1,3,5,2,4] 로 나온다 (개수는 5로 맞다)", () => {
    expect(choiceLabels(COLUMN_ORDER)?.labels).toEqual([1, 3, 5, 2, 4]);
  });

  it("마커가 없으면 빈 배열이고 null 이 아니다", () => {
    expect(choiceLabels(NO_CHOICES)).toEqual({
      labels: [],
      bodies: [],
      dropped: [],
      deduped: false,
    });
  });

  it("마커는 있는데 본문이 비면 dropped 로 나온다", () => {
    const raw = "다음 중 옳은 것은?\n\n1. \n2. \n3. \n4. \n5. ";
    const got = choiceLabels(raw);
    expect(got?.labels).toEqual([]);
    expect(got?.dropped).toEqual([1, 2, 3, 4, 5]);
  });

  it("일부만 비면 그 번호만 dropped 로 빠진다", () => {
    const got = choiceLabels(DROPPED_FIFTH);
    expect(got?.labels).toEqual([1, 2, 3, 4]);
    expect(got?.dropped).toEqual([5]);
  });

  it("제품이 보기 블록 중복을 잘라 내면 이 자도 같이 잘라 낸다", () => {
    // 잘라 내지 않으면 본문이 제품과 달라져 `null`(미분류)이 된다.
    const got = choiceLabels(DUPLICATED_BLOCK);
    expect(got).not.toBeNull();
    expect(got?.deduped).toBe(true);
    expect(got?.labels).toEqual([1, 2, 3, 4, 5]);
    expect(got?.bodies).toEqual(parseProblemContent(DUPLICATED_BLOCK).choices);
  });
});

describe("readAnswerRef — 정답이 «몇 번»인지, 그리고 무엇을 근거로 읽었는지", () => {
  const bodies = ["$3$", "$4$", "$5$", "$6$", "$7$"];

  it("원문자", () => {
    expect(readAnswerRef("③", bodies)).toMatchObject({
      nums: [3],
      basis: "원문자",
    });
  });

  it("여러 개 고르는 정답", () => {
    expect(readAnswerRef("①, ③", bodies).nums).toEqual([1, 3]);
  });

  it("설명이 뒤에 붙어도 앞의 원문자만 읽는다", () => {
    expect(readAnswerRef("③ (①은 부호가 반대다)", bodies).nums).toEqual([3]);
  });

  it("맨숫자 — 값과 겹치지 않을 때만 번호로 읽는다", () => {
    expect(
      readAnswerRef("2", ["$가$", "$나$", "$다$", "$라$", "$마$"]),
    ).toMatchObject({ nums: [2], basis: "맨숫자" });
  });

  it("값으로도 번호로도 읽히고 **답이 갈리면** 고르지 않고 «모호»", () => {
    // 보기가 3,4,5,6,7 일 때 "4" 는 값으로 읽으면 ② 이고 번호로 읽으면 ④ 다.
    expect(readAnswerRef("4", bodies)).toMatchObject({
      nums: [],
      basis: "모호",
    });
    expect(readAnswerRef("3", bodies).basis).toBe("모호");
  });

  it("두 읽기가 **같은 번호**를 내면 모호하지 않다", () => {
    // 보기가 1,2,3,4,5 면 값 3 도 ③ 이고 번호 3 도 ③ 이다.
    expect(
      readAnswerRef("3", ["$1$", "$2$", "$3$", "$4$", "$5$"]),
    ).toMatchObject({ nums: [3], basis: "값일치" });
  });

  it("값이 숫자가 아니면 그냥 «값일치»", () => {
    expect(
      readAnswerRef("$22\\sqrt5$", ["$16√5$", "$22√5$", "$24√5$"]),
    ).toMatchObject({ nums: [2], basis: "값일치", crossChecked: true });
  });

  it("「번호. 값」은 값이 그 번호의 보기와 맞을 때만 읽는다", () => {
    expect(readAnswerRef("$5.\\ 7$", bodies)).toMatchObject({
      nums: [5],
      basis: "번호.값",
      crossChecked: true,
    });
    // 값이 안 맞으면 그 근거로는 안 읽는다.
    expect(readAnswerRef("$5.\\ 99$", bodies).basis).not.toBe("번호.값");
  });

  it("「값 (번호)」도 검산을 통과할 때만", () => {
    expect(readAnswerRef("7 (⑤)", bodies)).toMatchObject({
      nums: [5],
      basis: "값(번호)",
      crossChecked: true,
    });
    expect(readAnswerRef("99 (⑤)", bodies).basis).not.toBe("값(번호)");
  });

  it("검산은 «자리»가 아니라 «그 번호가 붙은 보기»와 한다", () => {
    // 라벨이 [1,3,4,5] 면 ③ 의 본문은 두 번째 자리에 있다.
    expect(
      readAnswerRef(
        "$3.\\ 나$",
        ["$가$", "$나$", "$다$", "$라$"],
        [1, 3, 4, 5],
      ),
    ).toMatchObject({ nums: [3], basis: "번호.값" });
  });

  it("서술형 정답은 번호가 아니다", () => {
    expect(readAnswerRef("축의 방정식 x=3, 꼭짓점 (3,-10)", bodies).basis).toBe(
      "없음",
    );
  });
});

describe("judgeAnswerChoice — 판정", () => {
  const judge = (content: string, answer: string, figures: string[] = []) =>
    judgeAnswerChoice({ content, answer, figureUrls: figures });

  it("성한 문항은 정상", () => {
    expect(judge(HEALTHY, "③").verdict).toBe("정상");
  });

  it("줄 중간 마커 부류는 **R2 가 살린다** — 예전엔 «정답번호어긋남» (D-58)", () => {
    // 이 자리가 R2 의 값이다. 고치기 전에는 라벨이 [1,3,4,5] 라 정답 ⑤ 가
    // 지면에 ④ 로 찍혔다 — 조용히 틀린 시험지였다.
    expect(judge(GLUED, "⑤").verdict).toBe("정상");
  });

  it("두 열 순서도 «정답번호어긋남» — 개수가 5라고 짝이 맞는 게 아니다", () => {
    const got = judge(COLUMN_ORDER, "③");
    expect(got.verdict).toBe("정답번호어긋남");
    expect(got.cause).toBe("번호 순서가 뒤집혔다");
  });

  it("보기가 한 칸도 안 찍히면 «보기0칸»", () => {
    expect(judge(NO_CHOICES, "⑤", ["a", "b", "c", "d", "e"])).toMatchObject({
      verdict: "보기0칸",
      cause: "보기 그림 (figref 부류)",
      fixedByLabelRendering: false,
    });
  });

  it("정답 번호의 보기가 아예 없으면 «정답보기없음»", () => {
    const raw = "다음 중 옳은 것은?\n\n2. $가$\n4. $나$";
    expect(judge(raw, "①").verdict).toBe("정답보기없음");
  });

  it("정답 번호가 두 번 나오면 «정답번호중복»", () => {
    const raw =
      "다음 중 옳은 것은?\n\n1. $가$\n2. $나$\n1. $다$\n2. $라$\n3. $마$";
    const got = judge(raw, "①");
    expect(got.verdict).toBe("정답번호중복");
    expect(got.fixedByLabelRendering).toBe(false);
  });

  it("정답 자리는 맞아도 다른 자리가 어긋나면 «지면번호어긋남»", () => {
    // 라벨 [1,2,3,5] → ① 은 제자리지만 넷째 칸이 ④ 로 찍히는데 원본은 ⑤ 다.
    const raw = "다음 중 옳은 것은?\n\n1. $가$\n2. $나$\n3. $다$\n5. $마$";
    expect(judge(raw, "①").verdict).toBe("지면번호어긋남");
  });

  it("마커는 다섯인데 하나가 비어 사라지면 «지면번호어긋남»", () => {
    // 라벨 [1,2,3,4] 는 자리가 맞지만 원본 ⑤ 가 지면에서 통째로 없어졌다.
    expect(judge(DROPPED_FIFTH, "②")).toMatchObject({
      verdict: "지면번호어긋남",
      cause: "마커는 있으나 본문이 비었다",
      dropped: [5],
    });
  });

  it("여러 문항이 한 행에 뭉치면 «정답번호중복» 이고 원인이 그렇게 나온다", () => {
    expect(judge(MERGED_TWO, "③")).toMatchObject({
      verdict: "정답번호중복",
      cause: "여러 문항이 한 행에 뭉쳤다",
      fixedByLabelRendering: false,
    });
  });

  it("같은 값이 여러 보기에 있으면 맨숫자로도 안 읽는다", () => {
    const raw = "다음 중 옳은 것은?\n\n1. $2$\n2. $2$\n3. $3$\n4. $4$\n5. $5$";
    expect(judge(raw, "2")).toMatchObject({
      verdict: "정답표기가번호아님",
      ref: { nums: [], basis: "없음" },
    });
  });

  it("번호는 1..n 인데 칸 수가 5가 아니면 «보기수이상»", () => {
    const raw = "다음 중 옳은 것은?\n\n1. $가$\n2. $나$\n3. $다$";
    expect(judge(raw, "②").verdict).toBe("보기수이상");
  });

  it("보기도 없고 정답도 번호가 아니면 «비객관식»", () => {
    expect(judge("넓이를 구하시오.", "$36$").verdict).toBe("비객관식");
  });

  it("보기는 성한데 정답 표기가 번호가 아니면 «정답표기가번호아님»", () => {
    expect(judge(HEALTHY, "모두 정답").verdict).toBe("정답표기가번호아님");
  });

  it("정답이 값으로도 번호로도 읽히고 답이 갈리면 «정답표기가모호»", () => {
    const raw = "다음 중 옳은 것은?\n\n1. $3$\n2. $4$\n3. $5$\n4. $6$\n5. $7$";
    expect(judge(raw, "4")).toMatchObject({
      verdict: "정답표기가모호",
      cause: "정답 표기가 갈린다",
      fixedByLabelRendering: false,
    });
  });

  it("치명 판정은 다섯뿐이고 그 밖은 치명이 아니다", () => {
    expect([...FATAL_VERDICTS].sort()).toEqual(
      [
        "보기0칸",
        "정답번호어긋남",
        "정답번호중복",
        "정답보기없음",
        "정답표기가모호",
      ].sort(),
    );
    for (const v of [
      "정상",
      "비객관식",
      "지면번호어긋남",
      "보기수이상",
    ] as const)
      expect(isFatal(v)).toBe(false);
  });
});

/**
 * 🔴 변이 시험이 찾아낸 구멍 — **「본문 보기 마커를 ①..⑤ 로 좁힌다」가 초록이었다**
 * (2026-08-19, `mutate-answer-choice-rules.sh`).
 *
 * ## 픽스처를 지어내지 않은 이유
 *
 * 실데이터를 먼저 셌다: 분모 47,152건에서 **줄머리 마커가 `⑥`..`⑮` 인 행은 2행**이고,
 * 그 둘도 열어 보니 보기가 아니었다(하나는 `<보기>` 상자에 `1. 2. …`, 다른 하나는
 * 수식 안). 즉 **DB 로는 이 경계를 못 가른다.** 여기서 「⑥ 이 보기인 문항」을
 * 지어내면 없는 데이터를 있다고 말하는 것이다.
 *
 * ## 그래서 **불변식**으로 잠근다
 *
 * 이 자(`choiceLabels`)는 **제품 파서와 같은 마커를 봐야 한다.** 한쪽만 좁히면
 * 판정기가 제품이 자르는 자리를 못 보게 되고, 그 순간 「세는 쪽과 고치는 쪽이
 * 다른 것을 본다」(CLAUDE.md 2026-08-18). 데이터가 없어도 **이 불변식은 참이어야
 * 한다** — 그리고 이건 반증 가능하다.
 */
describe("본문 마커 — 판정기와 **제품 파서가 같은 것**을 본다", () => {
  /** 마커 하나로 만든 최소 본문. 지면 형태가 아니라 **두 구현의 합의**를 본다. */
  const withMarkers = (marks: readonly string[]) =>
    ["다음 중 옳은 것은?", ...marks.map((m, i) => `${m} 보기${i + 1}`)].join(
      "\n",
    );

  it.each(["①", "⑤", "⑩", "⑮"])(
    "`%s` 를 제품이 자르면 자도 같은 수를 센다",
    (mark) => {
      const marks = [
        "①",
        "②",
        "③",
        "④",
        "⑤",
        "⑥",
        "⑦",
        "⑧",
        "⑨",
        "⑩",
        "⑪",
        "⑫",
        "⑬",
        "⑭",
        "⑮",
      ];
      const upto = marks.slice(0, marks.indexOf(mark) + 1);
      if (upto.length < 2) return; // 마커가 하나면 제품이 보기로 안 본다
      const body = withMarkers(upto);
      const product = parseProblemContent(body);
      expect(product.choices).toHaveLength(upto.length);
      // 자가 본 라벨 = 제품이 자른 칸 수. 한쪽만 좁히면 여기서 갈린다.
      const seen = choiceLabels(body);
      expect(seen, "자가 «판정 불가»를 냈다").not.toBeNull();
      expect(seen!.labels).toHaveLength(product.choices.length);
      expect(seen!.labels).toEqual(upto.map((_, i) => i + 1));
    },
  );

  it("🔴 `❶`(U+2776) 은 **양쪽 다** 보기로 안 본다 — 규칙 항목·작도 순서다", () => {
    const body = withMarkers(["❶", "❷", "❸", "❹", "❺"]);
    expect(parseProblemContent(body).choices).toHaveLength(0);
    expect(choiceLabels(body)?.labels ?? []).toHaveLength(0);
  });
});
