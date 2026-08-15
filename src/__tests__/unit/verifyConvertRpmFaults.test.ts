/**
 * 실데이터 회귀 검사(`scripts/qa/verify-convert-rpm.ts`)의 **결함 주입 레시피가 썩지 않았는지** 본다.
 *
 * 그 검사는 지난 결함을 일부러 되돌려 "검사가 정말 빨강이 되는가" 를 증명한다.
 * 되돌리기는 변환기 소스의 문자열 치환으로 하므로, 변환기를 손보면 치환 대상이
 * 사라져 **증명 자체가 조용히 죽는다.** 그러면 다시 "테스트는 초록인데 데이터는
 * 샌다" 로 돌아간다 — 그 사고를 이미 세 번 냈다.
 *
 * 이 테스트는 sumaek 원본이 없어도 돈다. 파일만 읽는다.
 */
import { readFile } from "node:fs/promises";

import { describe, expect, it } from "vitest";

import {
  CONVERTER_PATH,
  DB_FAULTS,
  FAULTS,
} from "../../../scripts/qa/verify-convert-rpm";

/** 저장소 파일이 CRLF 라 그대로 비교하면 여러 줄 치환이 빗나간다. */
async function converterSource(): Promise<string> {
  return (await readFile(CONVERTER_PATH, "utf8")).replace(/\r\n/g, "\n");
}

describe("verify-convert-rpm 결함 주입 레시피", () => {
  it("치환 대상 문자열이 변환기에 그대로 있다", async () => {
    const source = await converterSource();
    for (const [name, fault] of Object.entries(FAULTS)) {
      expect(
        source.includes(fault.from),
        `결함 '${name}' 의 치환 대상이 ${CONVERTER_PATH} 에 없다 — 변환기를 고쳤으면 FAULTS 도 같이 고쳐야 한다.`,
      ).toBe(true);
    }
  });

  it("치환이 실제로 소스를 바꾼다 (from ≠ to)", async () => {
    const source = await converterSource();
    for (const [name, fault] of Object.entries(FAULTS)) {
      expect(fault.from, `결함 '${name}' 의 from/to 가 같다`).not.toBe(fault.to);
      expect(source.replace(fault.from, fault.to)).not.toBe(source);
    }
  });

  it("지난 결함 셋이 모두 레시피로 남아 있다", () => {
    // 10-handoff.md 와 트랙 C 문서가 적은 세 결함 — 하나라도 빠지면 증명이 반쪽이다.
    expect(Object.keys(FAULTS)).toContain("choice-id"); // 정답 4,862건 유실
    expect(Object.keys(FAULTS)).toContain("marker-drop"); // 보기 마커 1,319건 유실
    expect(Object.keys(DB_FAULTS)).toContain("figure-blind"); // 그림 1,014건 미조회
  });

  it("모든 결함이 잡히길 기대하는 검사를 지정한다", () => {
    for (const [name, fault] of Object.entries(FAULTS)) {
      expect(fault.expect.length, `결함 '${name}' 에 기대 검사가 없다`).toBeGreaterThan(0);
    }
    for (const [name, fault] of Object.entries(DB_FAULTS)) {
      expect(fault.expect, `결함 '${name}' 에 기대 검사가 없다`).toBeTruthy();
    }
  });
});
