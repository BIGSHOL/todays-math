/**
 * AI 대체 문항 적재 관문 — **269건을 잡아낸 그 판정기**를 새 문항에도 댄다.
 *
 * 뺀 이유가 「학생이 정답을 고를 수 없다」였다. 새로 만든 것이 같은 결함을 가지면
 * 아무것도 고친 게 아니다. 그래서 관문을 **일부러 망가뜨린 입력으로** 시험한다 —
 * 「막힘 0건」은 관문이 좋다는 뜻일 수도, 관문이 장식이라는 뜻일 수도 있다.
 */
import { describe, expect, it } from "vitest";

import {
  checkDraft,
  renderFails,
  type Draft,
} from "../../../scripts/qa/load-ai-replacements";

const 온전한: Draft = {
  unitId: "c1fe36b6-8f97-46e5-be13-f022636211f8",
  difficulty: "mid",
  questionType: "객관식",
  problemType: "개념",
  content:
    "일차부등식 $3x-5 \\le x+7$을 만족시키는 자연수 $x$의 개수는?\n① $4$\n② $5$\n③ $6$\n④ $7$\n⑤ $8$",
  answer: "③",
  solution: "$2x \\le 12$이므로 $x \\le 6$이다.",
};

const 고쳐 = (over: Partial<Draft>): Draft => ({ ...온전한, ...over });

describe("checkDraft — 온전한 것은 통과한다", () => {
  it("대조군", () => {
    expect(checkDraft(온전한, 0)).toBeNull();
  });
});

describe("checkDraft — 망가진 것은 막는다", () => {
  it("정답이 보기에 없는 번호면 막는다", () => {
    // `judgeAnswerChoice` 가 내는 판정 그대로다 — 여기서 다시 판정하지 않는다.
    expect(checkDraft(고쳐({ answer: "⑥" }), 0)?.reason).toContain(
      "학생이 정답을 고를 수 없다",
    );
  });

  it("객관식인데 보기가 다섯이 아니면 막는다", () => {
    const 넷 = 온전한.content.split("\n").slice(0, 5).join("\n");
    expect(checkDraft(고쳐({ content: 넷 }), 0)?.reason).toContain(
      "보기가 4칸",
    );
  });

  it("객관식인데 정답이 원문자 하나가 아니면 막는다", () => {
    expect(checkDraft(고쳐({ answer: "6개" }), 0)?.reason).toContain(
      "원문자 하나여야 한다",
    );
  });

  it("서술형인데 본문에 보기가 있으면 막는다", () => {
    expect(
      checkDraft(고쳐({ questionType: "서술형", answer: "6" }), 0)?.reason,
    ).toContain("본문에 보기가 5칸 있다");
  });

  it("보기를 **제품 파서로** 센다 — `1.` 마커도 같은 보기다", () => {
    // 🔴 말뭉치는 `1.` 이 99.97% 인데 우리는 원문자를 썼다. **둘 다 같은 화면으로
    //    그려진다**(파서가 마커를 떼고 렌더러가 ①②③ 를 붙인다). 여기서 정규식으로
    //    원문자만 세면 `1.` 로 쓴 순간 「보기 0칸」이 되어 멀쩡한 문항이 막힌다.
    const 말뭉치꼴 = 온전한.content.replace(
      /\n([①②③④⑤])/g,
      (_a, m: string) => `\n${"①②③④⑤".indexOf(m) + 1}. `,
    );
    expect(말뭉치꼴).not.toContain("①");
    expect(checkDraft(고쳐({ content: 말뭉치꼴 }), 0)).toBeNull();
  });

  it("빈 칸이 있으면 막는다", () => {
    expect(checkDraft(고쳐({ solution: "" }), 0)?.reason).toContain("빈 칸");
  });
});

describe("renderFails — 지면에서 실제로 깨지는가", () => {
  it("알 수 없는 명령은 math-raw 로 떨어진다", () => {
    // 🔴 KaTeX 는 이것을 `katex-error` 로 내지 않는다(CLAUDE.md 2026-08-14).
    //    클래스 이름만 믿으면 붉은 날 명령이 지면에 나간다.
    expect(renderFails("$3x \\notacommand 4$")).toBe("math-raw 폴백");
  });

  it("수식 밖에 남은 명령을 잡는다", () => {
    // `renderMathHtml` 은 `$` 밖 백슬래시를 글자 그대로 이스케이프한다 —
    // 렌더는 «성공»하는데 지면에는 `\frac{1}{2}` 가 날것으로 나간다.
    expect(renderFails("상대도수는 \\dfrac{6}{40} 이다.")).toBe(
      "수식 밖에 명령이 남았다",
    );
  });

  it("멀쩡한 수식은 통과한다", () => {
    expect(renderFails("$\\dfrac{6}{40}=0.15$ 이다.")).toBeNull();
    expect(renderFails("")).toBeNull();
  });
});
