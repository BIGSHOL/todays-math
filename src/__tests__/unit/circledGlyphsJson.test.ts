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

describe("circled-glyphs.json 이 모듈과 같다", () => {
  it("다시 만들어도 같은 내용이다 — 다르면 emit 스크립트를 돌려라", () => {
    const onDisk = JSON.parse(
      readFileSync(path.resolve(__dirname, "../../..", OUT), "utf8"),
    );
    expect(onDisk).toEqual(buildPayload());
  });

  it("정답 판독 목록이 본문 마커보다 **넓다** — 좁아지면 43행을 다시 못 본다", () => {
    const p = buildPayload();
    for (const ch of p.본문마커) expect(p.정답판독_전체글자).toContain(ch);
    expect(p.정답판독_전체글자.length).toBeGreaterThan(p.본문마커.length);
  });

  it("본문 마커는 `❶`·`➊` 을 **안 넣는다** — 넣으면 규칙 항목이 보기로 잘린다", () => {
    const p = buildPayload();
    expect(p.본문마커).not.toContain("\u2776");
    expect(p.본문마커).not.toContain("\u278a");
  });
});
