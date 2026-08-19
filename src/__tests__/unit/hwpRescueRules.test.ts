/**
 * 「HWP 원본으로 되찾으면 몇 건이 사는가」 판정기 회귀 가드.
 *
 * 픽스처는 **줄이지 않은 실제 행**이다(`__fixtures__/hwpRescueRows.json`, 전량 눈으로 봤다).
 * 기대값은 규칙에서 유도하지 않고 **확인한 사실**을 리터럴로 박는다 —
 * 규칙에서 기대값을 만들면 규칙이 틀릴 때 같이 틀린다.
 *
 * 이 파일이 지키는 것은 넷이고, 넷 다 **실측에서 한 번씩 틀렸던 자리**다:
 *   ㉠ 짝 확인의 축은 **포함도**여야 한다 (Dice 는 크기가 다르면 벌한다)
 *   ㉡ 「보기가 가짜」의 열쇠는 **연속 런**이어야 한다 (원문자 하나면 참조를 잡는다)
 *   ㉢ 「HWP 에 보기 글자가 있는가」는 **마커 + 내용** 둘 다여야 한다
 *   ㉣ 회복은 «치명 아님»이 아니라 **«정상»** 이어야 한다
 *
 * 변이 시험: `bash scripts/qa/mutate-hwp-rescue-rules.sh`
 */
import { describe, expect, it } from "vitest";

import {
  containment,
  dice,
  sigKo,
  type HwpQ,
} from "../../../scripts/qa/hwpJudgeRules";
import {
  choicesLookFake,
  judgeRescue,
  maxCircledRun,
  pairCheck,
  familyOf,
  type RescueInput,
} from "../../../scripts/qa/hwpRescueRules";

/* ────────────────────────────────────────────────────────────────────────────
 * 픽스처 — **줄이지 않은 실제 행**이다.
 *
 * 처음엔 손으로 줄여 썼다가 두 검사가 헛돌았다: 뭉친 행을 짧게 줄이니
 * 라벨이 5개로 «정상» 이 돼 뭉침을 재현하지 못했고, Dice 도 0.36 이라
 * 「Dice 로는 다른 문제로 몰린다」는 사실이 안 나왔다. 결함이 드러나는 조건은
 * **데이터의 크기**였다(CLAUDE.md 2026-08-19 «시안은 가장 큰 실데이터로 세워라»).
 * 그래서 공유 DB 와 HWP 추출본에서 그대로 떠 온 행을 쓴다.
 *
 *   src/__tests__/unit/__fixtures__/hwpRescueRows.json
 * ──────────────────────────────────────────────────────────────────────────── */
import ROWS from "./__fixtures__/hwpRescueRows.json";

interface FixtureRow {
  id: string;
  school: string | null;
  n: number | null;
  content: string;
  answer: string;
  score: number | null;
  figureUrls: string[];
  hwp: HwpQ;
}
const rows = ROWS as unknown as Record<string, FixtureRow>;
const 뭉친행 = rows["뭉친행"]!;
const 다른문항 = rows["다른문항"]!;
const 참조보기 = rows["참조보기"]!;
const 표보기 = rows["표보기"]!;
const 줄중간 = rows["줄중간"]!;

const allOf = (q: HwpQ): string =>
  [q.stem ?? "", ...(q.choices ?? [])].join(" ");

/** 보기가 **그림**인 문항 — 마커는 있으나 칸이 비었다 (학남중 17 부류). */
const IMAGE_CHOICE_HWP: HwpQ = { ...표보기.hwp, choices: ["", "", "", "", ""] };

const base = (over: Partial<RescueInput>): RescueInput => ({
  content: 뭉친행.content,
  answer: 뭉친행.answer,
  figureUrls: 뭉친행.figureUrls,
  score: 뭉친행.score,
  hwp: 뭉친행.hwp,
  alignGrade: "확정",
  ...over,
});

/* ────────────────────────────────────────────────────────────────────────────
 * ㉠ 짝 확인 — 축은 포함도다
 * ──────────────────────────────────────────────────────────────────────────── */
describe("짝 확인 (pairCheck)", () => {
  it("DB 한 행에 문항이 뭉쳐 크기가 달라도 **같은 문항**으로 본다", () => {
    const hwpAll = allOf(뭉친행.hwp);
    const p = pairCheck(뭉친행.content, hwpAll);
    expect(p.mismatched).toBe(false);
    expect(p.contain).toBeGreaterThan(0.9);
    // 🔴 이 자리가 실측에서 틀렸다: Dice 로 보면 0.3 아래로 떨어져 «다른 문제»가 된다.
    expect(dice(sigKo(뭉친행.content), sigKo(hwpAll))).toBeLessThan(0.3);
  });

  it("**아예 다른 문제**는 잡아낸다", () => {
    const p = pairCheck(다른문항.content, allOf(다른문항.hwp));
    expect(p.mismatched).toBe(true);
    expect(p.contain).toBeLessThan(0.3);
  });

  it("한쪽 한글이 짧으면 **판단하지 않는다** (손상된 DB 를 «다른 문제»로 몰지 않는다)", () => {
    const p = pairCheck("정답", "다음 중 옳은 것을 모두 고르시오 그림과 같이");
    expect(p.undecidable).toBe(true);
    expect(p.mismatched).toBe(false);
  });

  it("포함도는 **비대칭**이다 — 큰 쪽이 작은 쪽을 품으면 1 이다", () => {
    const small = "가나다라마바사";
    const big = `앞말${small}뒷말`;
    expect(containment(big, small)).toBe(1);
    expect(containment(small, big)).toBeLessThan(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ㉡ 「보기가 가짜」 — 열쇠는 연속 런이다
 * ──────────────────────────────────────────────────────────────────────────── */
describe("보기가 보기인가 (choicesLookFake)", () => {
  it("「①과 ②의 …」 **참조**는 가짜가 아니다", () => {
    expect(참조보기.hwp.choices[2]).toContain("①과 ②의");
    expect(maxCircledRun(참조보기.hwp.choices[2]!)).toBe(2);
    const content = [
      참조보기.hwp.stem,
      "",
      ...참조보기.hwp.choices.map((c, i) => `${i + 1}. ${c}`),
    ].join("\n");
    expect(choicesLookFake(content)).toBe(false);
  });

  it("보기 **목록**을 통째로 삼킨 칸은 가짜다", () => {
    const swallowed = "$)이 된다.①소거②$y=3-x$③$5$④$2$⑤$1$";
    expect(maxCircledRun(swallowed)).toBe(5);
    const content = [
      "설명문이다.",
      "",
      "1. 가",
      "2. 나",
      "3. 다",
      "4. 라",
      `5. ${swallowed}`,
    ].join("\n");
    expect(choicesLookFake(content)).toBe(true);
  });

  it("런은 **떨어져 있어도** 순서면 이어 센다", () => {
    expect(maxCircledRun("①가나②다라③마바")).toBe(3);
    expect(maxCircledRun("③가나①다라")).toBe(1);
  });
});

/* ────────────────────────────────────────────────────────────────────────────
 * ㉢㉣ 회복 판정
 * ──────────────────────────────────────────────────────────────────────────── */
describe("회복 판정 (judgeRescue)", () => {
  it("보기 다섯이 서고 정답이 그 자리면 **완전회복**", () => {
    const r = judgeRescue(base({}));
    expect(r.arms.HWP?.verdict).toBe("정상");
    expect(r.rescue).toBe("완전회복");
    expect(r.evidence.정답일치).toBe(true);
    expect(r.evidence.배점일치).toBe(true);
  });

  it("맞댄 문항이 다르면 **정상이 나와도** 회복이 아니다", () => {
    const r = judgeRescue(
      base({
        content: 다른문항.content,
        answer: 다른문항.answer,
        hwp: 다른문항.hwp,
      }),
    );
    expect(r.arms.HWP?.verdict).toBe("정상");
    expect(r.rescue).toBe("문항불일치");
  });

  it("보기가 **그림**이면 (마커는 있고 칸이 빔) HWP 도 못 살린다", () => {
    const r = judgeRescue(
      base({
        content: 표보기.content,
        answer: 표보기.answer,
        hwp: IMAGE_CHOICE_HWP,
      }),
    );
    // 마커는 다섯이지만 칸이 다 비었다 — «보기 글자가 있다» 로 세면 안 된다.
    expect(r.hwpChoices).toBe(5);
    expect(r.rescue).toBe("HWP도못살림");
  });

  it("칸에 **글자가 있으면** 여전히 치명이어도 부분이다", () => {
    const filled: HwpQ = {
      ...IMAGE_CHOICE_HWP,
      choices: ["$1$", "$2$", "$3$", "$4$", ""],
    };
    const r = judgeRescue(
      base({ content: 표보기.content, answer: 표보기.answer, hwp: filled }),
    );
    expect(r.rescue).toBe("부분");
  });

  it("**«치명 아님» 을 회복으로 세지 않는다** — 보기를 통째로 잃어 서술형처럼 보이는 것", () => {
    const noChoices: HwpQ = { ...뭉친행.hwp, choices: [] };
    // 정답이 값이라 번호로 안 읽힌다 → 판정은 `비객관식`(치명 아님).
    const r = judgeRescue(base({ answer: "$12$", hwp: noChoices }));
    expect(r.arms.HWP?.verdict).toBe("비객관식");
    expect(r.rescue).not.toBe("완전회복");
    expect(r.rescue).toBe("치명탈출");
  });

  it("칸이 **한둘만** 차 있으면 «보기 한 벌»이 아니다 — 못 살린다", () => {
    // 하한 4 의 경계. 이 검사가 없으면 `CHOICE_BLOCK_MIN` 을 1 로 낮춰도 안 빨개진다.
    const half: HwpQ = {
      ...IMAGE_CHOICE_HWP,
      choices: ["$1$", "$2$", "", "", ""],
    };
    const r = judgeRescue(
      base({ content: 표보기.content, answer: 표보기.answer, hwp: half }),
    );
    expect(r.rescue).toBe("HWP도못살림");
  });

  it("**제품이 R2 를 이미 건다** — DB 팔이 곧 현행이다 (D-58)", () => {
    // R2 가 제품 파서에 들어가기 전에는 이 행의 DB 팔이 «보기0칸» 이었다.
    const r = judgeRescue(
      base({ content: 줄중간.content, answer: 줄중간.answer, hwp: 줄중간.hwp }),
    );
    expect(r.arms.DB?.verdict).toBe("정상");
    expect(r.slots.DB).toBe(5);
  });

  it("HWP 미주 정답이 **다르면** 근거가 «불일치» 여야 한다", () => {
    // 이 검사가 없으면 「정답 근거를 늘 참으로」 변이가 초록이다.
    const 다른답: HwpQ = { ...뭉친행.hwp, answer: "④" };
    const r = judgeRescue(base({ hwp: 다른답 }));
    expect(뭉친행.answer).toBe("②");
    expect(r.evidence.정답일치).toBe(false);
    expect(r.evidence.정답불일치).toBe(true);
  });

  it("정렬 근거가 없으면 **대응실패** — 억지로 맞대지 않는다", () => {
    expect(judgeRescue(base({ alignGrade: "근거없음" })).rescue).toBe(
      "대응실패",
    );
    expect(judgeRescue(base({ hwp: null, alignGrade: "편없음" })).rescue).toBe(
      "대응실패",
    );
  });

  it("R2 는 **HWP 로 지은 본문에도** 걸린다 — 원본도 똑같이 붙어 있다", () => {
    const r = judgeRescue(
      base({ content: 줄중간.content, answer: 줄중간.answer, hwp: 줄중간.hwp }),
    );
    expect(r.arms.HWP?.verdict).toBe("정상");
    expect(r.slots.HWP).toBe(5);
    expect(r.rescue).toBe("완전회복");
  });

  it("팔 넷이 **서로 다른 질문**이다 — DB 팔은 늘 교체 전이다", () => {
    const r = judgeRescue(base({}));
    expect(r.arms.DB?.verdict).toBe("정답번호중복");
    expect(r.slots.DB).toBeGreaterThan(5);
    expect(r.slots.HWP).toBe(5);
  });
});

describe("부류 (familyOf)", () => {
  it("브리프 §1 의 축 그대로", () => {
    expect(familyOf("마커가 본문에 아예 없다")).toBe("본문");
    expect(familyOf("마커가 줄 중간에 붙었다")).toBe("본문");
    expect(familyOf("여러 문항이 한 행에 뭉쳤다")).toBe("본문");
    expect(familyOf("보기 그림 (figref 부류)")).toBe("그림");
    expect(familyOf("마커는 있으나 본문이 비었다")).toBe("그림");
    expect(familyOf("정답 표기가 갈린다")).toBe("정답데이터");
    expect(familyOf("번호 순서가 뒤집혔다")).toBe("지면");
  });
});
