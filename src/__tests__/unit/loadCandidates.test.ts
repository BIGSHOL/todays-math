// 트랙 F — 신규 적재 후보의 본문 위생 규칙.
//
// ⚠️ 여기 픽스처는 **전부 실데이터에서 그대로 떼 온 것**이다. 지어낸 모양으로 테스트하면
//    이관 결함이 초록으로 통과한다 — 트랙 C 가 `choiceId`→`id` 오독으로 정답 4,862건을
//    통째로 비우고도 초록이었던 사고가 그것이다(tracks/README "되풀이 금지" 1번).
//
// 각 문자열 옆의 출처는 2026-08-16 `scripts/qa/load-dedupe-check.ts` · `_integrity.ts`
// 전수 스캔에서 실제로 걸린 행이다.
import { describe, expect, it } from "vitest";

import {
  contentDefect,
  hasBinaryBlob,
  sanitizeContent,
} from "../../../scripts/qa/load-candidates";
import { cleanAnswer, unitGrade } from "../../../scripts/qa/load-survey";
import { fileKey } from "../../../scripts/qa/load-dedupe-check";

describe("본문 오염 — base64 덩어리", () => {
  // 실측: 4568-7(경덕여고 2025). 후보 6,174행 중 239행(15편)이 이 꼴이었다.
  const 오염 =
    "닫힌구간 7HmWZvKIj4Fgqftip7R/ReOniozAZ/0ZBqj25K0OMOyHN76QV8r9ZB4fB26C+hxTQCuBUnCFQxJQvGYpJnk8GXmkCOruG/gZIw== $\\le";

  it("실제로 걸린 오염 지문을 잡는다", () => {
    expect(hasBinaryBlob(오염)).toBe(true);
    expect(contentDefect(오염)).toBe("본문오염");
  });

  it("멀쩡한 LaTeX 지문을 오염으로 오인하지 않는다", () => {
    // 실측: 4880-2(수성고 2025) — 적재 대상 표본.
    const 정상 =
      "$\\int _{-1}^{2}\\left| \\,x^{2}+x-2\\,\\right| \\,dx\\,$의 값은?\n\n1. $\\frac{19}{6}$\n2. $\\frac{25}{6}$\n3. $\\frac{31}{6}$";
    expect(hasBinaryBlob(정상)).toBe(false);
    expect(contentDefect(정상)).toBeNull();
  });

  it("긴 영문 단어나 16진 해시는 오염이 아니다 — 대·소·숫자가 다 섞여야 한다", () => {
    expect(hasBinaryBlob("a".repeat(80))).toBe(false);
    expect(hasBinaryBlob("0123456789abcdef".repeat(4))).toBe(false);
  });
});

describe("지울 수 있는 것은 지운다", () => {
  it("줄 가운데 박힌 워터마크를 지운다 — 트랙 D 는 줄 단위라 이걸 놓친다", () => {
    // 실측: 4577-4(경북고 2025). 정규분포표 셀에 붙어 나온다. 후보 5,935행 중 186행.
    const 원본 =
      "$\\mathrm{P}(0\\leq \\mathit{Z}\\leq z)$대구광역시 내신 수학 연구회\n$1.00$\n$0.3413$";
    const 결과 = sanitizeContent(원본);
    expect(결과).not.toContain("대구광역시");
    expect(결과).toContain("$\\mathrm{P}(0\\leq \\mathit{Z}\\leq z)$");
    expect(결과).toContain("$0.3413$");
  });

  it("이름에 공백이 있는 작업자 서명을 지운다", () => {
    // 실측: 4735-20(대륜고 2025). 트랙 D 규칙은 이름을 `\S{0,20}` 로 봐서 놓친다.
    const 원본 = "$g\\left( -1\\right) <g\\left( 6\\right)$이다.\n\n오검:권 보선t";
    const 결과 = sanitizeContent(원본);
    expect(결과).not.toContain("권 보선");
    expect(결과).toContain("$g\\left( -1\\right) <g\\left( 6\\right)$이다.");
  });

  it("문제 본문에 나오는 '완료' 를 서명으로 오인해 지우지 않는다", () => {
    const 원본 = "어떤 일을 완료: 하는 데 걸린 시간을 구하시오. 단, 작업량은 일정하다고 하자.";
    expect(sanitizeContent(원본)).toBe(원본);
  });
});

describe("못 자르는 결함은 행째로 뺀다", () => {
  it("지면 머리말 덩어리 — 사람 이름이 학생 시험지에 찍힌다", () => {
    // 실측: 4567-1(경덕여고 2025). 다섯 줄 덩어리라 경계를 못 자른다. 35행.
    const 원본 =
      "2025년 1학기 기말고사\n사인법칙 ~ 수학적 귀납법\n경덕여고 2학년 수학1\n학원로고 \n강민구";
    expect(contentDefect(원본)).toBe("지면머리말");
  });

  it("PUA 잔재 — 집합 기호가 사용자영역 글리프로 남았다", () => {
    // 실측: 3358-13(중앙고). `P(B^c ∩ A^c)` 의 ∩ 가 U+E0xx 로 남아 뜻이 바뀐다.
    const 원본 = "$\\mathrm{P}\\left( B^{c}\uE0A1A^{c}\\right)$의 값은?";
    expect(contentDefect(원본)).toBe("PUA잔재");
  });

  it("같은 보기가 두 번 나오는 객관식", () => {
    // 실측: 4988-14(정화여고 2025) — 원본 hwp-latex 부터 이렇다. 9행(0.2%).
    const 원본 = "다음 중 옳은 것은?\n\n1. $18$\n2. $19$\n3. $19$\n4. $21$\n5. $22$";
    expect(contentDefect(원본)).toBe("보기중복");
  });

  it("보기가 다 다르면 통과한다", () => {
    const 원본 = "다음 중 옳은 것은?\n\n1. $18$\n2. $19$\n3. $20$\n4. $21$\n5. $22$";
    expect(contentDefect(원본)).toBeNull();
  });

  it("보기가 아예 없는 서술형은 보기중복으로 걸리지 않는다", () => {
    const 원본 = "[서술형 $3$] 두 집합 $A,~B$ 에 대하여 $n(A)=17$ 일 때 값을 구하시오.";
    expect(contentDefect(원본)).toBeNull();
  });
});

describe("학년 힌트 — final_meta.py unit_grade 와 같은 규칙", () => {
  it("중등은 grade 로, 과목칸에 학년이 오면 그쪽이 우선", () => {
    expect(unitGrade("중", 2, "수학")).toBe("중2");
    expect(unitGrade("중", 1, "중3-1")).toBe("중3");
    expect(unitGrade("중", null, "수학")).toBeNull();
  });

  it("고등은 HIGH_SUBJECT 로만 잡는다 — 실측으로 못 잡히는 세 조합", () => {
    expect(unitGrade("고", 1, "수하")).toBe("공통수학2");
    expect(unitGrade("고", 2, "확통")).toBe("확률과 통계");
    // 브리프 §5 가 세라고 한 조합. 잡히면 안 된다 — 잡히면 규칙이 바뀐 것이다.
    expect(unitGrade("고", 1, "수학")).toBeNull();
    expect(unitGrade("고", 1, null)).toBeNull();
    expect(unitGrade("고", 2, null)).toBeNull();
  });
});

describe("정답 접두어", () => {
  it("`정답 ④` 꼴에서 접두어만 뗀다", () => {
    expect(cleanAnswer("정답 ④")).toBe("④");
    expect(cleanAnswer("[정답] 3")).toBe("3");
    expect(cleanAnswer(null)).toBe("");
    // 본문이 '정답'으로 시작하는 값을 통째로 먹지 않는다.
    expect(cleanAnswer("④")).toBe("④");
  });
});

describe("원본 파일 열쇠 — 편 단위 중복 대조", () => {
  it("확장자·드라이브 표기가 달라도 같은 열쇠가 된다", () => {
    const hwp = "N:\\개인\\기출\\2024 기출모음\\#워드\\고1\\[효성여고][1][공수2][24-2-중간][천재이] (완료).hwp";
    const pdf = "N:/개인/기출/HWP 2 PDF/기출/24 기출/2학기 중간/고1/[효성여고][1][공수2][24-2-중간][천재이] (완료).PDF";
    expect(fileKey(hwp)).toBe(fileKey(pdf));
    expect(fileKey(null)).toBe("");
  });
});
