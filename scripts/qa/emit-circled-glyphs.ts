/**
 * `src/lib/math/circledNumber.ts` → `scripts/qa/circled-glyphs.json`.
 *
 * ## 왜 파일로 내보내나
 *
 * 원문자 목록을 쓰는 자리가 TS 만 있는 게 아니다 — Python(`extract-official-answers.py`,
 * `crop-*.py`)과 `.mjs`(`ocr-audit.mjs`)도 각자 손으로 적고 있었다. 언어가 다르다고
 * 목록이 둘이 되면 **세는 쪽과 고치는 쪽이 같이 눈이 먼다**(CLAUDE.md 2026-08-18).
 *
 * 이 저장소엔 이미 같은 해법이 있다 — `build-hwp-vocab.py` 가 정본에서 `hwp-vocab.json`
 * 을 뽑고 양쪽이 그 **파일 하나**를 읽는다. 같은 방식을 쓴다.
 *
 * ⚠️ 산출물은 **커밋한다**(Python 이 TS 를 못 읽으므로). 그래서 드리프트가 생길 수
 * 있고, `src/__tests__/unit/circledGlyphsJson.test.ts` 가 그것을 막는다 —
 * 모듈과 JSON 이 어긋나면 **빨개진다.**
 *
 *   npx tsx scripts/qa/emit-circled-glyphs.ts
 */
import { writeFileSync } from "node:fs";
import path from "node:path";

import {
  ANSWER_CIRCLED_CLASS,
  BODY_CHOICE_MARKS,
  CHOICE_MARKS,
  CIRCLED_FAMILIES,
  knownCircledGlyphs,
} from "../../src/lib/math/circledNumber";

export const OUT = path.join("scripts", "qa", "circled-glyphs.json");

export function buildPayload() {
  return {
    설명:
      "«둘러싼 숫자» 목록 한 곳. 손으로 고치지 말 것 — " +
      "`npx tsx scripts/qa/emit-circled-glyphs.ts` 가 " +
      "`src/lib/math/circledNumber.ts` 에서 생성한다.",
    계열: CIRCLED_FAMILIES.map((f) => ({
      이름: f.name,
      시작: `U+${f.base.toString(16).toUpperCase().padStart(4, "0")}`,
      개수: f.size,
    })),
    /** 정답 판독용 — **넓다.** 비표준 계열 43행이 진짜 정답 번호다. */
    정답판독_문자클래스: ANSWER_CIRCLED_CLASS,
    정답판독_전체글자: knownCircledGlyphs().join(""),
    /** 본문 보기 마커 — **일부러 좁다.** 넓히면 «규칙» 항목·작도 순서가 보기로 잘린다. */
    본문마커: BODY_CHOICE_MARKS,
    /** 지면에 찍는 글자. */
    지면마커: CHOICE_MARKS.join(""),
  };
}

if (process.argv[1]?.endsWith("emit-circled-glyphs.ts")) {
  writeFileSync(OUT, JSON.stringify(buildPayload(), null, 2) + "\n", "utf8");
  console.log(`${OUT} 생성`);
}
