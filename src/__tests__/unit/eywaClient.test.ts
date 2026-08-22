/**
 * eywa 접속의 **읽기 전용 통로**를 지킨다.
 *
 * 여기는 원장님 **운영 DB** 다. 실제로 쓰기가 막히는지는 DB 를 붙어야 알 수 있고
 * 그건 `scripts/qa/probe-eywa-readonly.ts` 가 한다(실제로 `update` 를 던져
 * `25006` 을 받는다. 양성·음성 대조군 둘 다 본다).
 *
 * 이 파일이 지키는 것은 **그 통로를 우회하는 코드가 새로 생기지 않는 것**이다.
 * `eywaQuery` 를 안 거치고 `client.$queryRaw` 를 부르면 `SET TRANSACTION READ ONLY`
 * 밖이라 가드가 없다 — 그리고 그건 **아무 오류도 안 내고** 그냥 지나간다.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  EywaNotConfiguredError,
  createEywaClient,
  READ_ONLY_STATEMENT,
} from "@/lib/eywa/client";

describe("[eywa client] 설정이 없으면 조용히 지나가지 않는다", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  /**
   * 🔴 환경변수를 **명시적으로 비우고** 본다. 이 검사를 처음 쓸 때 그냥
   *    `createEywaClient(undefined)` 를 불렀더니 초록이었는데, 시험 환경이
   *    `.env` 를 읽어 `EYWA_DATABASE_URL` 이 **실제로 들어 있었기** 때문이다 —
   *    「없을 때 던지나」를 물었는데 없지가 않았다.
   */
  it("EYWA_DATABASE_URL 이 없으면 **던진다** — 빈 결과로 내려가지 않는다", () => {
    vi.stubEnv("EYWA_DATABASE_URL", "");
    expect(() => createEywaClient()).toThrow(EywaNotConfiguredError);
    expect(() => createEywaClient("")).toThrow(EywaNotConfiguredError);
  });

  it("무엇을 넣어야 하는지 오류 문구가 말해 준다", () => {
    vi.stubEnv("EYWA_DATABASE_URL", "");
    expect(() => createEywaClient()).toThrow(/EYWA_DATABASE_URL/);
  });
});

/** 이 저장소에서 eywa 를 읽는 파일들. 늘어나면 여기 적는다. */
const EYWA_DIR = path.join(process.cwd(), "src/lib/eywa");
const SCRIPT_DIR = path.join(process.cwd(), "scripts/qa");

function 파일들(dir: string, filter: (name: string) => boolean): string[] {
  return readdirSync(dir)
    .filter(filter)
    .map((name) => path.join(dir, name))
    .filter((full) => statSync(full).isFile());
}

describe("[eywa client] 읽기 전용 통로를 우회하는 코드가 없다", () => {
  /**
   * 🔴 가드를 **텍스트로** 쓸 때는 그 낱말이 파일 안 다른 곳에도 있는지 먼저
   *    봐야 한다(2026-08-18 `LOOP` 사건). 그래서 「`$queryRaw` 라는 글자가 있나」가
   *    아니라 **`client.$queryRaw…(` 호출 모양**을 찾는다.
   */
  const 직접호출 =
    /\b(?:client|eywa|prisma)\.\$(?:queryRaw|executeRaw)(?:Unsafe)?\s*[(<`]/;

  it("`src/lib/eywa/client.ts` 안에서만 raw 를 부른다", () => {
    const 새는것: string[] = [];
    for (const full of 파일들(EYWA_DIR, (n) => n.endsWith(".ts"))) {
      if (path.basename(full) === "client.ts") continue;
      if (직접호출.test(readFileSync(full, "utf8")))
        새는것.push(path.basename(full));
    }
    expect(새는것).toEqual([]);
  });

  it("eywa 를 쓰는 스크립트도 `eywaQuery` 를 거친다", () => {
    const 새는것: string[] = [];
    for (const full of 파일들(
      SCRIPT_DIR,
      (n) => n.startsWith("measure-eywa") || n.startsWith("sync-eywa"),
    )) {
      const text = readFileSync(full, "utf8");
      if (!text.includes("createEywaClient")) continue;
      if (직접호출.test(text)) 새는것.push(path.basename(full));
    }
    expect(새는것).toEqual([]);
  });

  /**
   * 🔴 **이 검사가 실제로 무언가를 잡을 수 있는지** 확인한다. 정규식이 아무것도
   *    못 잡는 모양이면 위 두 시험은 영원히 초록이고 아무것도 안 지킨다
   *    (「가드가 0을 내면 «없다»가 아니라 «못 센다»일 수 있다」 — 2026-08-21).
   */
  it("[가드의 가드] 그 정규식이 우회 코드를 실제로 잡는다", () => {
    expect(직접호출.test("const r = await eywa.$queryRawUnsafe(sql);")).toBe(
      true,
    );
    expect(직접호출.test("await client.$executeRaw`update x set y = 1`;")).toBe(
      true,
    );
    expect(직접호출.test("return prisma.$queryRaw<Row[]>`select 1`;")).toBe(
      true,
    );
    // 통로 자체와 우리 Prisma(우리 DB)는 안 잡는다.
    expect(직접호출.test("await eywaQuery(client, sql);")).toBe(false);
    expect(
      직접호출.test("await tx.$executeRawUnsafe(READ_ONLY_STATEMENT);"),
    ).toBe(false);
  });

  it("통로가 거는 문장이 그대로다 — 바뀌면 probe 도 같이 고쳐야 한다", () => {
    expect(READ_ONLY_STATEMENT).toBe("set transaction read only");
    const source = readFileSync(path.join(EYWA_DIR, "client.ts"), "utf8");
    // `eywaQuery` 가 그 문장을 **먼저** 실행한 뒤에 질의한다.
    const at문장 = source.indexOf("tx.$executeRawUnsafe(READ_ONLY_STATEMENT)");
    const at질의 = source.indexOf("tx.$queryRawUnsafe<T[]>(sql");
    expect(at문장).toBeGreaterThan(0);
    expect(at질의).toBeGreaterThan(at문장);
  });
});
