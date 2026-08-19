/**
 * 🔴 드리프트 가드 — **JSON 산출물이 모듈과 어긋나면 빨개진다.**
 *
 * Python 과 `.mjs` 는 TS 모듈을 못 읽는다. 그래서 `circled-glyphs.json` 을 커밋해
 * 그쪽이 읽게 한다. 그런데 커밋된 산출물은 **낡는다** — 모듈에 계열을 하나 더해도
 * JSON 은 그대로고, 그러면 언어마다 다른 목록을 보게 된다. 목록이 둘이 되는 순간
 * 세는 쪽과 고치는 쪽이 같이 눈이 먼다(CLAUDE.md 2026-08-18).
 *
 * 이 검사는 **파일을 다시 만들어 비교하지 않는다** — 모듈에서 payload 를 만들고
 * 디스크의 JSON 과 견준다. 어긋나면 `npx tsx scripts/qa/emit-circled-glyphs.ts`.
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { OUT, buildPayload } from "../../../scripts/qa/emit-circled-glyphs";

const REPO = path.resolve(__dirname, "../../..");
const read = (rel: string) => readFileSync(path.resolve(REPO, rel), "utf8");

/** 원문자를 읽는 파이썬 자리. 늘어나면 여기에 적고 아래 두 검사를 통과시켜라. */
const PY_READERS = [
  "scripts/figure/crop-rpm-from-pdf.py",
  "scripts/figure/crop-pdf-by-stem.py",
];

describe("circled-glyphs.json 이 모듈과 같다", () => {
  it("다시 만들어도 같은 내용이다 — 다르면 emit 스크립트를 돌려라", () => {
    const onDisk = JSON.parse(read(OUT));
    expect(onDisk).toEqual(buildPayload());
  });

  it("정답 판독 목록이 본문 마커보다 **넓다** — 좁아지면 43행을 다시 못 본다", () => {
    const p = buildPayload();
    for (const ch of p.본문마커) expect(p.정답판독_전체글자).toContain(ch);
    expect(p.정답판독_전체글자.length).toBeGreaterThan(p.본문마커.length);
  });

  it("본문 마커는 `❶`·`➊` 을 **안 넣는다** — 넣으면 규칙 항목이 보기로 잘린다", () => {
    const p = buildPayload();
    expect(p.본문마커).not.toContain(String.fromCodePoint(0x2776));
    expect(p.본문마커).not.toContain(String.fromCodePoint(0x278a));
  });

  /**
   * 손으로 나열한 목록이 되살아나는 것을 막는다. 이 파일들은 원문자를 **문자 범위로
   * 직접** 쓰고 있었고(`[①-⑤]`), 그래서 `➀`(U+2780) 계열 43행을 아무도 못 봤다.
   *
   * ⚠️ 검사기 자신도 손으로 나열하지 않는다 — 무엇이 원문자인지는 **payload 에서
   * 가져온다.** 그래야 계열을 하나 더했을 때 이 검사가 같이 넓어진다.
   * 범위 표기(`①-⑤`)만 막고 낱글자 나열은 세지 않는다 — JSON 이 실어 나르는
   * 값 자체가 낱글자 나열이므로, 그것까지 막으면 무엇을 막는지 흐려진다.
   */
  it("오려내기 스크립트가 원문자 범위를 **손으로 쓰지 않는다**", () => {
    const cls = `[${buildPayload().정답판독_전체글자}]`;
    const range = new RegExp(`${cls}-${cls}`, "u");
    const offenders: string[] = [];
    for (const rel of PY_READERS) {
      read(rel)
        .split("\n")
        .forEach((line, i) => {
          if (line.trimStart().startsWith("#")) return; // 주석은 설명이다
          if (range.test(line))
            offenders.push(`${rel}:${i + 1} ${line.trim()}`);
        });
    }
    expect(offenders).toEqual([]);
  });

  /**
   * 로더는 **한 벌**이어야 한다. `crop-pdf-by-stem.py` 는 `crop-rpm-from-pdf.py` 를
   * 통째로 import 하므로 `croprpm.CIRCLED_ANSWER` 를 빌려 쓴다 — 각자 JSON 을 읽으면
   * 경로가 갈라져도, 키 이름이 갈라져도 한쪽만 조용히 낡는다.
   */
  it("`circled-glyphs.json` 을 읽는 파이썬 자리는 하나뿐이다", () => {
    const readers = PY_READERS.filter((rel) =>
      read(rel).includes(path.basename(OUT)),
    );
    expect(readers).toEqual(["scripts/figure/crop-rpm-from-pdf.py"]);
  });

  /** 빌려 쓰는 쪽이 실제로 **같은 값**을 보는지 — 이름만 같고 값이 다르면 소용없다. */
  it("빌려 쓰는 쪽은 `croprpm.CIRCLED_ANSWER` 를 쓴다", () => {
    expect(read("scripts/figure/crop-pdf-by-stem.py")).toContain(
      "CIRCLED_ANSWER = croprpm.CIRCLED_ANSWER",
    );
  });
});
