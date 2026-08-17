/**
 * 꼬리 중복 제거(`dropDuplicatedTail`)의 **판정 결과** 잠금.
 *
 * 이 함수는 렌더 본문 경로(ProblemContent → parseProblemContent,
 * MathText → normalizeOcrText)에서 매번 돈다. 원래 구현이 O(n^2)(해설 2,000자면
 * 호출당 약 100만 문자 복사)라 O(n) 으로 바꾸는데, **판정이 한 건이라도 달라지면
 * 지면이 달라진다**. 그래서 알고리즘을 바꾸기 **전에** 현재 판정을 잠근다.
 *
 * 여기 있는 케이스는 `normalizeOcrText` 를 통해 본다 — 입력에 공백·개행·`$` 를 두지
 * 않으면 `collapseWhitespace`/마스킹이 항등이라 꼬리 중복 판정만 남는다.
 * (공백이 섞인 실데이터 케이스는 `parseProblemContent.test.ts` 가 이미 덮는다.)
 */
import { describe, expect, it } from "vitest";

import { normalizeOcrText } from "@/lib/problem/parseProblemContent";

/** 원래 구현 그대로의 참조 판정기 — 새 구현과 결과를 맞대기 위한 정본. */
function naiveDropDuplicatedTail(text: string): string {
  const n = text.length;
  for (let len = Math.floor(n / 2); len >= 24; len -= 1) {
    if (text.slice(n - 2 * len, n - len) === text.slice(n - len)) {
      return text.slice(0, n - len).trimEnd();
    }
  }
  return text;
}

const A24 = "abcdefghijklmnopqrstuvwx"; // 24자 — 최소 반복 길이와 같다
const A23 = "abcdefghijklmnopqrstuvw"; // 23자 — 한 글자 모자란다

describe("[dropDuplicatedTail] 경계와 최장 우선", () => {
  it("꼬리가 정확히 24자로 반복되면 잘라 낸다 (경계 포함)", () => {
    expect(normalizeOcrText(`머리말${A24}${A24}`)).toBe(`머리말${A24}`);
  });

  it("꼬리 반복이 23자면 건드리지 않는다 (경계 미만)", () => {
    const raw = `머리말${A23}${A23}`;
    expect(normalizeOcrText(raw)).toBe(raw);
  });

  it("반복이 겹칠 때는 가장 긴 꼬리를 잘라 낸다", () => {
    // "…UU" 도 "…U" 도 반복이지만 원래 구현은 len 을 내려오며 첫 매치(=최장)를 택한다.
    const unit = "abcdefghijklmnopqrstuvwxyz";
    expect(normalizeOcrText(unit.repeat(4))).toBe(unit.repeat(2));
  });

  it("반복이 없으면 원문 그대로", () => {
    const raw = "가나다라마바사아자차카타파하가나다라마바사아자차";
    expect(normalizeOcrText(raw)).toBe(raw);
  });

  it("최소 반복 길이에 못 미치는 짧은 입력은 그대로 둔다", () => {
    expect(normalizeOcrText("abab")).toBe("abab");
  });

  it("빈 문자열", () => {
    expect(normalizeOcrText("")).toBe("");
  });
});

describe("[dropDuplicatedTail] 무작위 입력 차등 검증", () => {
  it("2,000건의 무작위 입력에서 참조 판정기와 결과가 완전히 같다", () => {
    // 재현 가능한 의사난수 (Math.random 을 쓰면 실패를 다시 못 만든다).
    let seed = 20260817;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    // 반복이 자연스럽게 생기도록 좁은 알파벳. 공백·`$` 는 넣지 않는다
    // (넣으면 collapseWhitespace/수식 마스킹이 끼어들어 꼬리 판정만 못 본다).
    const alphabet = "ab가";

    for (let round = 0; round < 2000; round += 1) {
      const length = 30 + Math.floor(next() * 90);
      let input = "";
      for (let i = 0; i < length; i += 1) {
        input += alphabet[Math.floor(next() * alphabet.length)];
      }
      expect(normalizeOcrText(input)).toBe(naiveDropDuplicatedTail(input));
    }
  });

  it("일부러 꼬리를 복제한 입력에서도 참조 판정기와 같다", () => {
    let seed = 777;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const alphabet = "abcde가나다";

    for (let round = 0; round < 500; round += 1) {
      const headLength = Math.floor(next() * 40);
      const tailLength = 18 + Math.floor(next() * 20); // 경계 24 를 앞뒤로 넘나든다
      let head = "";
      for (let i = 0; i < headLength; i += 1) {
        head += alphabet[Math.floor(next() * alphabet.length)];
      }
      let tail = "";
      for (let i = 0; i < tailLength; i += 1) {
        tail += alphabet[Math.floor(next() * alphabet.length)];
      }
      const input = `${head}${tail}${tail}`;
      expect(normalizeOcrText(input)).toBe(naiveDropDuplicatedTail(input));
    }
  });
});
