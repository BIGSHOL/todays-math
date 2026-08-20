/**
 * 🟢 회귀 가드 — 「DB 는 즉시 최신, 그림 파일은 배포해야 간다」
 *
 * ## 왜 이 검사가 생겼나
 *
 * 2026-08-20, 원장님이 production 에서 `J10201-NG7U`·`J10201-WLBH` 의 그림이
 * 안 보인다고 하셨다. 파일이 없어서가 아니라 **밀지 않아서**였다 — `origin/main`
 * 이 로컬보다 73커밋 뒤라 그림 96장이 배포에 없었다. 걸린 문항 **90건.**
 *
 * 이건 실수가 아니라 **구조**다. 공유 DB(D-31)는 모든 세션이 같이 써서 즉시 최신인데
 * 그림 파일은 git 에 있다. 그러니 문항을 이관하거나 그림을 회수하는 순간 production 의
 * DB 는 그 URL 을 알고 배포본에는 파일이 없다 — **코드를 한 줄도 안 고쳐도 깨진다.**
 * 그리고 이 결함은 스스로 신고하지 않는다. 원장님이 화면에서 찾아 줄 때까지 0이다.
 */
import { describe, expect, it } from "vitest";

import {
  FIGURE_URL_COLUMNS,
  brokenRows,
  figureRepoPath,
  presentFilesFromLsTree,
  treeFigureFiles,
} from "../../../scripts/qa/checkDeployedFigures";

describe("figureRepoPath — DB 의 URL 을 저장소 경로로", () => {
  it("`/figures/…` 는 `public/figures/…` 다", () => {
    expect(figureRepoPath("/figures/3635/pdf-q17.png")).toBe(
      "public/figures/3635/pdf-q17.png",
    );
  });

  it("빗금이 겹쳐도 같은 자리를 가리킨다", () => {
    expect(figureRepoPath("//figures/a/b.png")).toBe("public/figures/a/b.png");
  });

  it("바깥 주소는 **저장소 파일이 아니다** — null 로 갈라 낸다", () => {
    // 여기서 억지로 경로를 만들면 「배포에 없다」로 잘못 잡는다.
    expect(figureRepoPath("https://example.com/a.png")).toBeNull();
    expect(figureRepoPath("data:image/png;base64,AAA")).toBeNull();
  });
});

describe("brokenRows — 배포에 없는 그림을 쓰는 문항", () => {
  const present = new Set(["public/figures/a/1.png", "public/figures/a/2.png"]);

  it("배포에 있는 것만 쓰면 안 걸린다", () => {
    const rows = [{ code: "A", figureUrls: ["/figures/a/1.png"], ok: true }];
    expect(brokenRows(rows, present)).toHaveLength(0);
  });

  it("한 장이라도 없으면 그 문항이 걸린다 — 없는 장만 적는다", () => {
    const rows = [
      {
        code: "A",
        figureUrls: ["/figures/a/1.png", "/figures/b/9.png"],
        ok: true,
      },
    ];
    const [hit] = brokenRows(rows, present);
    expect(hit!.code).toBe("A");
    expect(hit!.missing).toEqual(["/figures/b/9.png"]);
  });

  it("**빈 파일은 없는 것과 같다** — 배포돼도 그림이 안 그려진다", () => {
    const rows = [{ code: "A", figureUrls: ["/figures/a/3.png"], ok: true }];
    // 크기 0인 blob 은 `present` 에 안 넣는다는 규약을 이 테스트가 못 박는다.
    expect(brokenRows(rows, present)[0]!.missing).toEqual(["/figures/a/3.png"]);
  });

  it("바깥 주소는 안 센다", () => {
    const rows = [{ code: "A", figureUrls: ["https://x/y.png"], ok: true }];
    expect(brokenRows(rows, present)).toHaveLength(0);
  });
});

describe("컬럼 목록을 손으로 쓰지 않는다", () => {
  it("그림 URL 을 담는 컬럼이 어디인지 **적어 두고**, DB 에 물어 대조한다", () => {
    // 손으로 쓴 목록은 새 컬럼이 생기면 조용히 눈이 먼다. 그래서 이 상수는
    // «기대값»이고, 스크립트가 DB 를 훑어 실제와 다르면 멈춘다.
    expect(FIGURE_URL_COLUMNS).toEqual([
      { table: "problem", column: "figure_urls" },
    ]);
  });
});

describe("presentFilesFromLsTree — 배포본에 «실제로 있는» 것만", () => {
  const line = (size: number, file: string) =>
    "100644 blob 0123456789abcdef0123456789abcdef01234567 " +
    size +
    "\t" +
    file;

  it("보통 파일은 있는 것으로 센다", () => {
    const got = presentFilesFromLsTree(
      line(7853, "public/figures/3635/pdf-q17.png"),
    );
    expect([...got]).toEqual(["public/figures/3635/pdf-q17.png"]);
  });

  it("🔴 **크기 0인 파일은 없는 것으로 센다** — 배포돼도 그림이 안 그려진다", () => {
    const raw = [
      line(0, "public/figures/a/빈것.png"),
      line(120, "public/figures/a/멀쩡한것.png"),
    ].join("\n");
    expect([...presentFilesFromLsTree(raw)]).toEqual([
      "public/figures/a/멀쩡한것.png",
    ]);
  });

  it("빈 줄·머리글은 조용히 흘린다", () => {
    expect(presentFilesFromLsTree("\n\n").size).toBe(0);
  });
});

describe("어느 디렉터리를 보나 — 미리 정하지 않는다", () => {
  /**
   * 2026-08-20: 다른 트랙이 719문항을 `/figures-svg/…` 벡터로 갈아 끼웠다.
   * 검사가 `public/figures` 만 훑고 있었다면 그 719건이 통째로 **거짓 경고**가 되고,
   * 반대로 새 디렉터리가 진짜로 안 밀린 날에는 아무 말도 못 한다.
   * DB 가 무엇을 가리킬지는 DB 가 정한다 — 검사는 `public` 전체를 본다.
   */
  it("`public/figures` 밖의 그림도 «있는 것»으로 센다", () => {
    const files = treeFigureFiles("HEAD");
    expect([...files].some((f) => f.startsWith("public/figures/"))).toBe(true);
    expect([...files].some((f) => f.startsWith("public/figures-svg/"))).toBe(
      true,
    );
  });

  it("읽을 수 없는 참조는 **멈춘다** — 「확인 못 했다」를 «괜찮다»로 넘기지 않는다", () => {
    expect(() => treeFigureFiles("없는참조-zzz")).toThrow(/읽을 수 없다/);
  });
});
