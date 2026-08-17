/**
 * `<보기>` · `<조건>` 상자 파싱 (렌더 수리 B).
 *
 * 규칙을 먼저 못 박는다 (절대 규칙 2). 표본은 전부 DB 실측 문항에서 가져왔고
 * 각 케이스 주석에 문항 id 를 남긴다 — 규칙을 고칠 사람이 원본을 볼 수 있어야 한다.
 *
 * 설계 근거는 `docs/planning/tracks/reports/render-b-box.md` §2.
 * 핵심: **상자 마커는 "상자가 있다"만 알려 준다. 상자의 경계는 항목이 정한다.**
 * 마커가 깨진 문항일수록 마커에 기대면 놓친다 (CLAUDE.md 2026-08-16~17 교훈).
 */
import { describe, expect, it } from "vitest";

import {
  findUnnormalizedBoxMarkers,
  normalizeBoxMarkers,
  splitBoxSegments,
} from "@/lib/math/boxBlock";

/** 편의: 상자 세그먼트만 뽑는다. */
function boxes(text: string) {
  return splitBoxSegments(text).filter((s) => s.kind === "box");
}
/** 편의: 평문 세그먼트만 뽑는다. */
function texts(text: string) {
  return splitBoxSegments(text)
    .filter((s) => s.kind === "text")
    .map((s) => s.text);
}

describe("[상자 1] 마커 정규화 — 15종 이상을 하나로 모은다", () => {
  // DB 전수(47,152건)에서 실제로 센 27가지 모양. 하나로 모으지 않으면 파서가 절반을 놓친다.
  const SHAPES = [
    "<보기>",
    "< 보 기 >",
    "<보 기>",
    "< 보기 >",
    "< 보 기>",
    "< 보기>",
    "[보기]",
    "[보기>",
    "[ 보 기 ]",
    "[보 기]",
    "[ 보기 >",
    "[ 보 기 >",
    "〈보기〉",
    "〈 보 기 〉",
    "〈보기>",
  ];

  it.each(SHAPES)("%s → <보기>", (shape) => {
    expect(normalizeBoxMarkers(`다음 ${shape} 에서`)).toBe("다음 <보기> 에서");
  });

  it("조건·상자도 같은 규칙으로 모은다", () => {
    expect(normalizeBoxMarkers("< 조 건 >")).toBe("<조건>");
    expect(normalizeBoxMarkers("[조건>")).toBe("<조건>");
    expect(normalizeBoxMarkers("〈 조 건 〉")).toBe("<조건>");
    expect(normalizeBoxMarkers("<상자>")).toBe("<상자>");
  });

  it("괄호 짝이 안 맞아도 잡는다 — 실제로 `[보기>` 가 10건 있다", () => {
    expect(normalizeBoxMarkers("고른 것은? [보기>ㄱ.")).toBe(
      "고른 것은? <보기>ㄱ.",
    );
  });

  it("상자 마커가 아닌 것은 건드리지 않는다", () => {
    // 「보기」가 일반 명사로 쓰인 문장, 괄호 없는 것.
    expect(normalizeBoxMarkers("보기 좋은 그래프")).toBe("보기 좋은 그래프");
    expect(normalizeBoxMarkers("조건을 만족한다")).toBe("조건을 만족한다");
    // 부등호는 수식이다 — 절대 마커로 읽지 않는다.
    expect(normalizeBoxMarkers("$a<b$ 이고 $c>d$")).toBe("$a<b$ 이고 $c>d$");
  });

  it("정규화가 못 잡은 잔여를 셀 수 있다 — 못 잡은 것이 침묵하면 안 된다", () => {
    // 실측: 마커가 수식으로 쪼개진 문항(`$<$ 조건 $>$`)·번호가 붙은 `<조건 1>`.
    const residue = findUnnormalizedBoxMarkers("답을 $<$ 조건 $>$ 에 맞게");
    expect(residue.length).toBeGreaterThan(0);

    // 정규형으로 모인 것은 잔여가 아니다.
    expect(findUnnormalizedBoxMarkers("다음 < 보 기 >에서")).toEqual([]);
  });
});

describe("[상자 2] 상자가 없는 문항은 한 글자도 건드리지 않는다", () => {
  it("마커가 없으면 통짜 평문 한 조각", () => {
    const text = "다음 중 유한소수로 나타낼 수 없는 것은?\n① $\\frac{3}{8}$";
    expect(splitBoxSegments(text)).toEqual([{ kind: "text", text }]);
  });

  it("`ㄱ. ㄴ.` 이 있어도 마커가 없으면 상자로 보지 않는다", () => {
    // 마커는 "상자가 있다"는 유일한 근거다. 없으면 손대지 않는다.
    const text = "설명으로 옳은 것은?\nㄱ. 참이다.\nㄴ. 거짓이다.";
    expect(boxes(text)).toEqual([]);
  });
});

describe("[상자 3] 항목 분해 — 어떤 신호로 나누는가", () => {
  it("헤더 뒤에 붙어 흐르는 항목을 자모 마커로 나눈다 (id 0302dd6e)", () => {
    const text =
      "<보기>에서 일차부등식만을 있는 대로 고른 것은? < 보기 >ㄱ. $x>1$\n\nㄴ. $x<2$\n\nㄷ. $x=3$";
    const [box] = boxes(text);
    expect(box.label).toBe("보기");
    expect(box.items).toEqual(["ㄱ. $x>1$", "ㄴ. $x<2$", "ㄷ. $x=3$"]);
  });

  it("줄로 나뉜 항목도 같은 결과 (id 00ecbba4)", () => {
    const text =
      "다음 <보기>의 내용 중 옳은 것의 개수는?\n< 보 기 >\nㄱ. 수렴한다.\nㄴ. 발산한다.";
    const [box] = boxes(text);
    expect(box.items).toEqual(["ㄱ. 수렴한다.", "ㄴ. 발산한다."]);
  });

  it("`(가) (나)` 조건 항목 (id 3e133565)", () => {
    const text = "다음 <조건>을 만족하는? <조건>(가) 곡선이다.(나) 직선이다.";
    const [box] = boxes(text);
    expect(box.label).toBe("조건");
    expect(box.items).toEqual(["(가) 곡선이다.", "(나) 직선이다."]);
  });

  it("`∘` 불릿 항목 (id 08118963)", () => {
    const text =
      "다음 <조건>을 만족하는 일차함수는? < 조건 >∘평행하다.∘점을 지난다.";
    expect(boxes(text)[0].items).toEqual(["∘평행하다.", "∘점을 지난다."]);
  });

  it("`㈎ ㈏` 원문자 항목 (id 0404f439)", () => {
    const text = "다음 조건을 만족시킨다. <조 건>㈎ 존재한다.㈏ 성립한다.";
    expect(boxes(text)[0].items).toEqual(["㈎ 존재한다.", "㈏ 성립한다."]);
  });

  it("문장 끝 `~이다.` 를 `다.` 항목으로 오인하지 않는다 (id 6aac75ec)", () => {
    // 가나다 계열은 **오름차순**이라야 항목이다. `다.`만 반복되는 것은 문장 끝이다.
    // 이 가드가 없으면 지문 한복판이 토막 난다 — 실제로 프로토타입에서 났다.
    const text =
      "<보기>의 내용이다. 나는 결심했다. 그 후 교사가 되었다. 그리고 퇴직했다.";
    expect(boxes(text)).toEqual([]);
  });

  it("항목이 하나뿐인 조건 상자도 상자로 그린다 (id 07802304)", () => {
    const text =
      "[서술형] <조건>을 이용하여 구하시오. < 조건 >소인수분해를 이용할 것.";
    const [box] = boxes(text);
    expect(box.label).toBe("조건");
    expect(box.items).toEqual(["소인수분해를 이용할 것."]);
  });

  it("항목을 못 나누면 통짜로 둔다 — 억지로 쪼개지 않는다 (id fd4082c7)", () => {
    // 원장님 스크린샷 2번. 항목 마커가 통째로 유실돼 문장만 남았다.
    // 문장 단위로 쪼개면 「옳은 것의 개수」가 달라 보인다 → 한 덩어리로 상자에만 넣는다.
    const text =
      "<보기>에서 옳은 것의 개수는? < 보 기 > 무한소수는 무리수이다. 수 $a$의 제곱근은 2개이다.";
    const [box] = boxes(text);
    expect(box.items).toHaveLength(1);
    expect(box.items[0]).toContain("무한소수는 무리수이다.");
    expect(box.items[0]).toContain("제곱근은 2개이다.");
  });

  it("내용이 그림 자리표시자뿐이면 상자로 그리지 않는다 (id fcd7a971)", () => {
    // `[그림]` 은 ProblemContent 가 따로 그린다. 빈 상자를 지면에 내보내지 않는다.
    expect(boxes("옳은 것은? <보기> [그림]")).toEqual([]);
  });
});

describe("[상자 4] 상자의 경계 — 마커가 아니라 항목이 정한다", () => {
  it("마커가 발문 안 참조로만 있고 항목이 뒤따르면 항목만 상자로 (id 08bfae09)", () => {
    const text =
      "자연수의 성질로 옳은 것만을 <보기>에서 있는 대로 고른 것은? ㄱ. $31$은 소수이다. ㄴ. 소수는 홀수다.";
    const [box] = boxes(text);
    expect(box.items).toEqual(["ㄱ. $31$은 소수이다.", "ㄴ. 소수는 홀수다."]);
    // 발문은 상자 밖에 그대로 남는다 — 마커도 지우지 않는다.
    expect(texts(text)[0]).toContain("<보기>에서 있는 대로 고른 것은?");
  });

  it("마커가 항목 **뒤**에 붙은 OCR 결함도 상자로 (id 13028d11)", () => {
    // 실측 93건. 라벨이 뒤로 밀렸다고 상자가 아닌 것은 아니다.
    const text =
      "지나는 사분면만을 <보기>에서 고른 것은? ㄱ. 제1사분면ㄴ. 제2사분면<보기>";
    const [box] = boxes(text);
    expect(box.label).toBe("보기");
    expect(box.items).toEqual(["ㄱ. 제1사분면", "ㄴ. 제2사분면"]);
    // 뒤로 밀린 라벨은 상자가 흡수한다 — 본문에 `<보기>` 가 떠돌면 안 된다.
    expect(texts(text).join("")).not.toContain("사분면<보기>");
  });

  it("상자 뒤에 붙은 발문 꼬리를 상자 밖으로 되돌린다 (id 00beea4c)", () => {
    // 조건 상자 뒤에 「…의 값은?」이 붙어 오는 문항이 실측 38건.
    const text =
      "다음 <조건>을 만족한다. <조건>(가) $p$는 확률이다.(나) $q$는 확률이다.이 때 $p+q$의 값은?";
    const [box] = boxes(text);
    expect(box.items[1]).toBe("(나) $q$는 확률이다.");
    expect(texts(text).at(-1)).toBe("이 때 $p+q$의 값은?");
  });

  it("소문항 번호 `⑴` 에서 상자를 끊는다 (id 4408cc31)", () => {
    const text =
      "다음 <조건>을 보고 답하시오. <조건>∘첫째 조건이다.∘둘째 조건이다.⑴ $x$의 값을 구하시오.";
    const [box] = boxes(text);
    expect(box.items).toEqual(["∘첫째 조건이다.", "∘둘째 조건이다."]);
    expect(texts(text).at(-1)).toContain("⑴ $x$의 값을 구하시오.");
  });

  it("보기 상자와 조건 상자가 함께 오면 둘 다 그린다 (id 0161a16c)", () => {
    const text =
      "<보기> 중에서 고르시오. < 보 기 >ㄱ. 첫째다.ㄴ. 둘째다.< 조 건 >Ÿ식으로 나타낼 것Ÿ꼴로 나타낼 것";
    const found = boxes(text);
    expect(found).toHaveLength(2);
    expect(found[0].label).toBe("보기");
    expect(found[1].label).toBe("조건");
    expect(found[1].items).toEqual(["Ÿ식으로 나타낼 것", "Ÿ꼴로 나타낼 것"]);
  });
});

describe("[상자 5] 수식 안의 기호를 항목 마커로 읽지 않는다", () => {
  it("합성함수 `∘` 는 불릿이 아니다", () => {
    // `$h(x)=(g∘g)(x)$` 처럼 수식 안에 있는 `∘` 로 상자를 만들면 문제가 망가진다.
    const text = "<조건>을 만족한다. <조건>$h(x)=(g∘g)(x)$ 이고 $f∘f=x$ 이다.";
    const [box] = boxes(text);
    // 수식 안 `∘` 두 개로 항목을 쪼개면 안 된다 → 통짜 한 항목.
    expect(box.items).toHaveLength(1);
  });
});
