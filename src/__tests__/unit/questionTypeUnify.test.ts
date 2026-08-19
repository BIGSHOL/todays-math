/**
 * 「서답형 → 서술형」 통일 (D-57) — **고칠지 말지**를 가르는 규칙.
 *
 * 판정 근거가 셋이다: 시험지 머리표 · 지면 보기 칸 수 · 기록된 정답.
 * 하나라도 어긋나면 안 고친다 — 머리표는 **묶음 제목**일 수 있고, 그때 보기가
 * 남아 있으면 그 문항은 객관식이다.
 */
import { describe, expect, it } from "vitest";

import {
  decideUnify,
  isChoiceAnswer,
  readMark,
  revertUnify,
  type DbRow,
  type HwpQuestion,
  type UnifiedRow,
} from "../../../scripts/qa/apply-question-type-unify";

const hwp = (over: Partial<HwpQuestion> = {}): HwpQuestion => ({
  number: 20,
  label: "[서답형 $2$]",
  type: "단답형",
  choices: [],
  ...over,
});

const db = (over: Partial<DbRow> = {}): DbRow => ({
  id: "a",
  questionType: "단답형",
  answer: "(정답 없음)",
  school: "남산고",
  questionNumber: 20,
  ...over,
});

describe("readMark — 원본 어휘는 셋이다", () => {
  it.each([
    ["[서답형 $2$]", "서답형"],
    ["[단답형]", "단답형"],
    ["[서술형 4]", "서술형"],
    ["", ""],
    [null, ""],
  ])("«%s» → «%s»", (label, expected) => {
    expect(readMark(label)).toBe(expected);
  });
});

describe("decideUnify", () => {
  it("머리표가 서답형이고 보기가 없고 정답이 번호가 아니면 고친다", () => {
    expect(decideUnify("서답형", hwp(), db())).toEqual({ fix: true });
  });

  // 원장님: 「단답형은 그대로」. 그 값만 우리 어휘와 이름이 같다.
  it.each(["단답형", ""])("머리표가 «%s» 면 안 고친다", (mark) => {
    const d = decideUnify(mark, hwp(), db());
    expect(d.fix).toBe(false);
  });

  // 2차 확정(2026-08-19): 머리표가 «서술형» 인데 DB 가 객관식인 4건도 고친다.
  // 보기 0칸 · 정답이 번호 아님이라 객관식일 수 없다.
  it("머리표가 «서술형» 인데 DB 가 객관식이면 고친다", () => {
    expect(
      decideUnify(
        "서술형",
        hwp({ label: "[서술형 $3$]" }),
        db({ questionType: "객관식", answer: "x=33, y=27" }),
      ),
    ).toEqual({ fix: true });
  });

  // 같은 머리표라도 보기가 남아 있으면 진짜 객관식이다 — 가드는 그대로 산다.
  it("머리표가 «서술형» 이어도 보기가 있으면 안 고친다", () => {
    const d = decideUnify(
      "서술형",
      hwp({ label: "[서술형 $3$]", choices: ["①", "②"] }),
      db({ questionType: "객관식", answer: "x=33" }),
    );
    expect(d.fix).toBe(false);
  });

  // 🔴 머리표가 묶음 제목이면 그 아래 객관식까지 서술형이 된다.
  it("지면에 보기가 남아 있으면 안 고친다", () => {
    const d = decideUnify("서답형", hwp({ choices: ["①", "②"] }), db());
    expect(d.fix).toBe(false);
    expect(d.fix === false && d.reason).toContain("보기가 있다");
  });

  // 정답 모양이 «객관식인가» 를 가르는 열쇠다 — `questionType` 이 아니다.
  it("정답이 보기 번호면 안 고친다", () => {
    const d = decideUnify("서답형", hwp(), db({ answer: "③" }));
    expect(d.fix).toBe(false);
    expect(d.fix === false && d.reason).toContain("객관식");
  });

  it("이미 서술형이면 그대로 둔다 (멱등)", () => {
    const d = decideUnify("서답형", hwp(), db({ questionType: "서술형" }));
    expect(d.fix).toBe(false);
    expect(d.fix === false && d.reason).toContain("멱등");
  });

  it("DB 나 HWP 문항이 없으면 안 고친다", () => {
    expect(decideUnify("서답형", hwp(), undefined).fix).toBe(false);
    expect(decideUnify("서답형", undefined, db()).fix).toBe(false);
  });
});

describe("isChoiceAnswer", () => {
  it.each(["③", "①, ④", "3", " ⑤ "])("«%s» 는 보기 번호다", (a) => {
    expect(isChoiceAnswer(a)).toBe(true);
  });
  it.each(["(정답 없음)", "x=33, y=27", "$1)$ 평균$=4$", ""])(
    "«%s» 는 보기 번호가 아니다",
    (a) => {
      expect(isChoiceAnswer(a)).toBe(false);
    },
  );
});

describe("되돌리기는 우리가 쓴 값일 때만", () => {
  const locked: UnifiedRow = {
    id: "a",
    questionType: "단답형",
    school: null,
    questionNumber: null,
    머리표: "[서답형 $2$]",
    exam: "1580",
  };

  it("지금 서술형이면 옛 값으로 되돌린다", () => {
    expect(revertUnify(locked, { questionType: "서술형" })).toEqual({
      restore: true,
      to: "단답형",
    });
  });

  it("그 사이 남이 바꿨으면 건드리지 않는다", () => {
    const d = revertUnify(locked, { questionType: "객관식" });
    expect(d.restore).toBe(false);
    expect(d.restore === false && d.reason).toContain("남의 변경");
  });
});
