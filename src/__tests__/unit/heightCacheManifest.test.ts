/**
 * 🟢 회귀 가드 — 적대적 리뷰 ④ `[적대④-E]` `[적대④-F]` 승격.
 *
 * ## 왜 이 파일이 있는가
 *
 * 「재현율 96.1%」의 분모는 높이 캐시(`.measure/cont.json`)다. 그 캐시는 지면을
 * Chromium 으로 그려 뜬 것이라, **지면이 바뀌면 통째로 거짓**이 된다.
 * 그런데 채점기가 보던 것은 문항 id 목록과 건수뿐이었다. 실제로 재현했다:
 *
 *   · `TWO_COLUMN_WIDTH_LIMIT` 24 → 40 (보기 열 수가 바뀌어 지면 높이가 진짜로
 *     달라진다) 으로 바꾸고 같은 캐시로 채점 → 아무 말 없이 「재현율 95.2%」.
 *   · `continuationSlot` 484 → 600 (지면과 어긋난 상수) → 「채점기 ↔ 제품 일치
 *     확인 (0건 불일치)」 그대로 초록이고, **재현율이 96.1% → 97.1% 로 올랐다.**
 *     «넘쳤는가»의 참을 **제품 상수**로 갈랐기 때문이다 — 참과 규칙이 같이 움직였다.
 *
 * 그래서 (1) 참은 캐시가 **실측한** 칸(`availPx`)에서 오고, (2) 캐시 옆에 지면
 * 입력의 지문을 남겨 어긋나면 멈춘다.
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  assertHeightCacheFresh,
  buildHeightCacheManifest,
  describeGroundMove,
  heightCacheProblems,
  manifestPathFor,
  measuredRowsHash,
  pageInputsHash,
  stampGround,
} from "../../../scripts/qa/heightCacheManifest";

const NOW = {
  kind: "continuation" as const,
  rows: 3,
  rowsHash: "abc",
  slotPx: 484,
};

const manifest = () =>
  buildHeightCacheManifest({ ...NOW, measuredAt: "2026-08-18T00:00:00.000Z" });

describe("[적대④-F] 캐시 지문", () => {
  it("지면 원문의 지문을 만든다 — 같은 지면이면 같은 값이다", () => {
    const a = pageInputsHash();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(pageInputsHash()).toBe(a);
  });

  /**
   * ⚠️ **본문이 바뀌면 높이가 바뀐다.** 이 저장소는 `apply-*` 스크립트로 본문을
   *    자주 고친다. id 목록만 보면 그 변화가 통째로 안 보인다.
   */
  it("문항 본문이 바뀌면 지문이 바뀐다 — id 목록만으로는 못 본다", () => {
    const rows = [
      { id: "b", content: "둘", figureUrls: [], questionType: null },
      { id: "a", content: "하나", figureUrls: [], questionType: null },
    ];
    const same = [...rows].reverse(); // 순서는 상관없다
    expect(measuredRowsHash(same)).toBe(measuredRowsHash(rows));

    const changed = rows.map((r) =>
      r.id === "a" ? { ...r, content: "하나 고침" } : r,
    );
    expect(measuredRowsHash(changed)).not.toBe(measuredRowsHash(rows));
  });

  it("그림이 붙거나 유형이 바뀌어도 지문이 바뀐다", () => {
    const base = [
      { id: "a", content: "본문", figureUrls: [], questionType: null },
    ];
    expect(
      measuredRowsHash([{ ...base[0]!, figureUrls: ["/f.png"] }]),
    ).not.toBe(measuredRowsHash(base));
    expect(
      measuredRowsHash([{ ...base[0]!, questionType: "서술형" }]),
    ).not.toBe(measuredRowsHash(base));
  });

  it("지문이 없으면 «없다»고 말한다 — 조용히 통과하지 않는다", () => {
    expect(heightCacheProblems(null, NOW)).toHaveLength(1);
  });

  it("장 종류·문항 수·본문·실측 칸이 어긋나면 **전부** 짚는다", () => {
    const problems = heightCacheProblems(manifest(), {
      kind: "first",
      rows: 4,
      rowsHash: "다른값",
      slotPx: 405,
    });
    expect(problems.map((p) => p.what)).toEqual([
      "장 종류",
      "문항 수",
      "문항 본문 지문",
      "실측 문항 칸",
    ]);
  });

  it("같은 지면·같은 문항이면 아무 문제도 없다", () => {
    expect(heightCacheProblems(manifest(), NOW)).toEqual([]);
  });

  it("지문 파일은 캐시 옆에 둔다", () => {
    expect(manifestPathFor(".measure/cont.json")).toBe(
      ".measure/cont.manifest.json",
    );
  });

  it("어긋나면 «다시 재라»를 말하며 멈춘다", () => {
    expect(() => assertHeightCacheFresh(".measure/없는캐시.json", NOW)).toThrow(
      /다시 재라/,
    );
  });
});

/**
 * 🟢 `[적대④-E]` — 채점기가 **제품 상수가 아니라 실측 칸**으로 «넘쳤는가»를 가른다.
 * 그리고 상수가 실측과 어긋나면 멈춘다 — 그게 «지면 ↔ 상수» 검산이다.
 */
describe("[적대④-E] 채점기의 참이 제품 상수에서 나오지 않는다", () => {
  const read = (file: string) =>
    readFileSync(path.join(process.cwd(), file), "utf8");

  it("«넘쳤는가»를 캐시의 실측 칸으로 가른다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toMatch(
      /overflows:\s*h\.neededPx\s*>\s*h\.availPx/,
    );
  });

  it("실측 칸과 제품 상수가 다르면 멈춘다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toMatch(
      /slot !== constant/,
    );
  });

  it("채점기가 캐시 지문을 대조한다", () => {
    expect(read("scripts/qa/eval-overflow-rules.ts")).toContain(
      "assertHeightCacheFresh",
    );
  });

  it("측정 스크립트가 캐시와 함께 지문을 남긴다", () => {
    expect(read("scripts/qa/measure-print-overflow.tsx")).toContain(
      "writeHeightCacheManifest",
    );
  });

  /** 전수 30분을 다시 안 쓰고 캐시를 되살리는 길 — 손이 아니라 도구가 말하게 한다. */
  it("표본으로 캐시를 대조해 지문을 다시 찍는 길이 있다", () => {
    expect(read("scripts/qa/measure-print-overflow.tsx")).toContain("--verify");
  });
});

/**
 * 검수(2026-08-18)가 찾은 구멍 — **지문이 DB 컬럼만 봤다.**
 *
 * main 이 그림 파일 3,365장을 `public/figures/` 에 새로 넣었다. `figureUrls` 는
 * 한 글자도 안 바뀌었는데(원래부터 그 경로를 가리키고 있었다) **그림이 실제로
 * 그려지기 시작해** 지면이 최대 380.95px 높아졌다. 표본 3,000건 중 33건.
 *
 * 그런데 `assertHeightCacheFresh` 는 **조용히 통과했다.** 낡은 캐시로 잰
 * 재현율·정밀도가 그대로 보고될 뻔했다. 「캐시가 거짓이 되는 걸 캐시 자신이 모른다」는
 * 결함을 한 층 위에서 다시 낸 것이다.
 *
 * 지문은 **높이를 바꾸는 모든 것**을 봐야 한다 — URL 문자열이 아니라 «그 URL 뒤에
 * 파일이 있는가, 몇 바이트인가».
 */
/**
 * 🔴 **`rmSync` 는 경로에 한글이 있으면 노드를 죽인다.** `unlinkSync` 를 쓴다.
 *
 * Node v24.13.0 · Windows. 종료 코드 `0xC0000409`(STATUS_STACK_BUFFER_OVERRUN) 로
 * **메시지 하나 없이** 프로세스가 사라진다. 파일이 있든 없든 똑같고,
 * **상대 경로여도 cwd 에 한글이 있으면 죽는다.**
 *
 * | API | 한글 경로 |
 * | --- | --- |
 * | `rmSync` | 🔴 죽음 |
 * | `unlinkSync` | ✓ |
 * | `fs/promises` 의 `rm` | ✓ |
 *
 * ASCII 경로에서는 멀쩡하다. 그래서 **메인 워크트리(`C:/Creative/testautocreator`)에서는
 * 안 보이고**, 오르카가 만드는 한글 이름 워크트리에서만 이 파일이 통째로 죽었다 —
 * 그리고 vitest 요약은 「119 통과」라고만 적어 **한 파일이 안 돌았다는 말을 안 했다**
 * (2026-08-19 에 실제로 그렇게 지나갔다). 재현: `node scripts/qa/probe-rmsync-crash.mjs`.
 *
 * 노드 버그라 우리가 고칠 수 없다. **밟지 않는다.**
 */
function removeIfExists(file: string): void {
  if (existsSync(file)) unlinkSync(file);
}

describe("[검수] 지문이 그림 파일 자체를 본다", () => {
  const row = {
    id: "a",
    content: "본문",
    figureUrls: ["/figures/__fingerprint_probe__.png"],
    questionType: null,
  };

  it("URL 이 같아도 파일이 생기면 지문이 달라진다", () => {
    const dir = path.join(process.cwd(), "public/figures");
    const file = path.join(dir, "__fingerprint_probe__.png");
    mkdirSync(dir, { recursive: true });
    removeIfExists(file);

    const before = measuredRowsHash([row]);
    writeFileSync(file, Buffer.alloc(64, 7));
    try {
      // 🔴 파일만 생겼다 — DB 는 한 글자도 안 바뀌었다.
      expect(measuredRowsHash([row])).not.toBe(before);
    } finally {
      removeIfExists(file);
    }
  });

  it("파일 크기가 바뀌어도 지문이 달라진다 — 그림이 바뀌면 높이가 바뀐다", () => {
    const dir = path.join(process.cwd(), "public/figures");
    const file = path.join(dir, "__fingerprint_probe__.png");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, Buffer.alloc(64, 7));
    const small = measuredRowsHash([row]);
    writeFileSync(file, Buffer.alloc(4096, 7));
    try {
      expect(measuredRowsHash([row])).not.toBe(small);
    } finally {
      removeIfExists(file);
    }
  });
});

/**
 * 🟢 `[d-affordable]` — **덧입힌 배치**(그림 폭 상한·문항번호 서식)도 지문에 들어간다.
 *
 * 왜: 검토용 측정은 제품을 안 고치고 탐침 문서에 `<style>` 을 덧붙여 **다른 지면**을
 * 그린다. 그러면 「45mm 로 잰 캐시」와 「70mm 로 잰 캐시」가 `inputsHash` 도 `rowsHash` 도
 * **똑같다** — 조건을 바꿔 놓고 옛 캐시로 채점해도 아무 말이 없다.
 * 이 저장소가 여러 번 당한 자리(「지표가 그 실패를 셀 수 없는 형태」)라 지문에 넣는다.
 */
describe("[d-affordable] 덧입힌 배치도 지문이 본다", () => {
  const overlaid = () =>
    buildHeightCacheManifest({
      ...NOW,
      measuredAt: "2026-08-18T00:00:00.000Z",
      overlay: "cap=cap45;layout=base",
    });

  it("덧칠이 없으면 지문에 그 항목을 안 남긴다 — 기존 캐시와 그대로 호환된다", () => {
    expect(manifest().overlay).toBeUndefined();
    expect(heightCacheProblems(manifest(), NOW)).toEqual([]);
  });

  it("다른 조건으로 잰 캐시로 채점하면 멈춘다", () => {
    const problems = heightCacheProblems(overlaid(), {
      ...NOW,
      overlay: "cap=cap29;layout=base",
    });
    expect(problems.map((p) => p.what)).toEqual(["덧입힌 배치"]);
  });

  it("덧칠로 잰 캐시를 «제품 그대로»에 쓰면 멈춘다 — 반대 방향도 막는다", () => {
    expect(heightCacheProblems(overlaid(), NOW).map((p) => p.what)).toEqual([
      "덧입힌 배치",
    ]);
  });

  it("같은 조건이면 아무 문제도 없다", () => {
    expect(
      heightCacheProblems(overlaid(), {
        ...NOW,
        overlay: "cap=cap45;layout=base",
      }),
    ).toEqual([]);
  });
});

describe("[2026-08-20] 재는 **동안** 발밑이 바뀌면 멈춘다", () => {
  /**
   * 왜 이게 따로 필요한가: 지문은 지금까지 **끝난 뒤 한 번**만 찍었다. 전수 측정은
   * 28분이 걸리는데, 그 사이 다른 세션이 main 에 병합하면 앞부분은 옛 그림으로,
   * 뒷부분은 새 그림으로 그려진다. 그런데 지문은 **끝난 뒤**에 찍히므로 «새 그림
   * 상태»만 적히고 캐시는 조용히 «싱싱함»으로 통과한다.
   *
   * 2026-08-20 에 실제로 그랬다 — 측정 13:37~14:05 중 13:54 에 그림 1,344장이
   * 병합으로 바뀌었고(796장은 **가로세로 비율까지** 달라졌다), 1,218문항이 걸렸다.
   * 그때의 캐시는 섞인 것인데 지문은 아무 말도 안 했다.
   */
  const rows = [
    { id: "a", content: "가", figureUrls: [], questionType: null },
    { id: "b", content: "나", figureUrls: [], questionType: null },
  ];

  it("아무것도 안 바뀌면 «안 움직였다»", () => {
    const before = stampGround(rows);
    expect(describeGroundMove(before, stampGround(rows))).toBeNull();
  });

  it("문항 본문이 바뀌면 어느 문항인지까지 말한다", () => {
    const before = stampGround(rows);
    const after = stampGround([rows[0]!, { ...rows[1]!, content: "다" }]);
    const moved = describeGroundMove(before, after);
    expect(moved).toMatch(/본문·그림/);
    expect(moved).toContain("b");
  });

  it("그림 **파일의 바이트**가 바뀌어도 잡는다 — URL 은 한 글자도 안 바뀐다", () => {
    const dir = path.join(process.cwd(), "public", "figures", "__ground__");
    const file = path.join(dir, "g.png");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "작은 그림");
    const withFigure = [
      {
        id: "a",
        content: "가",
        figureUrls: ["/figures/__ground__/g.png"],
        questionType: null,
      },
    ];
    const before = stampGround(withFigure);
    writeFileSync(file, "훨씬 더 큰 300dpi 그림으로 바꿔치기");
    try {
      expect(describeGroundMove(before, stampGround(withFigure))).toMatch(
        /본문·그림/,
      );
    } finally {
      unlinkSync(file);
    }
  });

  it("문항이 늘거나 줄어도 잡는다", () => {
    const before = stampGround(rows);
    expect(describeGroundMove(before, stampGround([rows[0]!]))).toMatch(
      /사라졌다/,
    );
    expect(
      describeGroundMove(
        before,
        stampGround([
          ...rows,
          { id: "c", content: "다", figureUrls: [], questionType: null },
        ]),
      ),
    ).toMatch(/새로 생겼다/);
  });

  it("지면 원문이 바뀌면 잡는다", () => {
    const before = stampGround(rows);
    const after = { ...stampGround(rows), inputsHash: "다른-지면" };
    expect(describeGroundMove(before, after)).toMatch(/지면 원문/);
  });
});

describe("[2026-08-20] 지문이 **그림 크기 근거**도 본다", () => {
  /**
   * 제품 지면은 `figureSourceMm` 으로 그림 폭을 mm 로 못 박고, `figureDims` 로 비율을
   * 잡는다. 둘 중 하나만 바뀌어도 **지면 높이가 바뀐다.** 그런데 지문은 본문·그림
   * 파일·유형만 봤다 — DB 의 mm 를 다시 적재하면 캐시는 거짓이 되는데 아무 말도 안 한다.
   * 그림 파일은 한 바이트도 안 바뀌므로 파일 지문으로도 못 잡는다.
   */
  const base = {
    id: "a",
    content: "본문",
    figureUrls: ["/figures/없는것.png"],
    questionType: null,
  };

  it("mm 가 바뀌면 지문이 바뀐다", () => {
    const before = measuredRowsHash([{ ...base, figureSourceMm: [40] }]);
    expect(measuredRowsHash([{ ...base, figureSourceMm: [55] }])).not.toBe(
      before,
    );
  });

  it("원본 픽셀 치수가 바뀌면 지문이 바뀐다 — 비율이 곧 높이다", () => {
    const before = measuredRowsHash([{ ...base, figureDims: [400, 300] }]);
    expect(measuredRowsHash([{ ...base, figureDims: [400, 900] }])).not.toBe(
      before,
    );
  });

  it("문항별 지문도 같이 본다 — 어느 문항인지 집어낼 수 있어야 한다", () => {
    const rows = [{ ...base, figureSourceMm: [40] }];
    const before = stampGround(rows);
    const after = stampGround([{ ...base, figureSourceMm: [41] }]);
    expect(describeGroundMove(before, after)).toMatch(/본문·그림/);
  });
});
