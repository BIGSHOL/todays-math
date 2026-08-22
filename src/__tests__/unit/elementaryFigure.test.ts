/**
 * 초등 그림 스펙(elem-1) + 기존 FigureSpec v2.
 * 엔진이 실제로 SVG 를 내는지 본다. 모킹하지 않는다 — 없는 축은 변이시킬 수 없다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { CUBE_SCRAPE_ITEMS } from "@/app/dev/cube-scrape/fixtures";
import { CUBE_RANDOM_20 } from "@/app/dev/cube-scrape/random20";
import { renderFigureSpec } from "@/lib/figure/renderFigureSpec";

const ENGINE = process.env.FIGURE_ENGINE_PATH ?? "F:\\시험지변환기";
const VENDOR = path.join(process.cwd(), "vendor", "figure-engine");
const hasEngine = existsSync(VENDOR) || existsSync(ENGINE);

const NUMBER_CARDS = {
  version: "elem-1",
  kind: "numberCards",
  cards: ["2", "9", "4"],
};

describe.skipIf(!hasEngine)("[초등 그림] elem-1", () => {
  it("수 카드 2·9·4 를 SVG 로 그린다", async () => {
    const r = await renderFigureSpec(NUMBER_CARDS);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("<svg");
    expect(r.svg).toContain("2");
    expect(r.svg).toContain("9");
    expect(r.svg).toContain("4");
  });

  it("연산 상자는 숫자만 감싼다 — 넓은 막대가 아니다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "opBox",
      input: "845",
      op: "−369",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const opBox = [
      ...r.svg.matchAll(
        /<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"[^>]*fill="#f3e6e4"/g,
      ),
    ][0];
    expect(opBox).toBeTruthy();
    expect(Number(opBox![3])).toBeLessThanOrEqual(64);
    expect(Number(opBox![4])).toBeLessThanOrEqual(24);
    expect(r.svg).toContain("845");
    expect(r.svg).toContain("−369");
  });

  it("합 상자는 표로 그린다 — 그림 오림이 아니다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "sumBox",
      left: "143",
      right: "532",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("143");
    expect(r.svg).toContain("532");
  });

  it("모르는 종류는 실패한다 — 조용히 빈 SVG 를 만들지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "사진",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/종류|kind|초등/);
  });

  it("상자 연쇄는 엑셀처럼 열이 맞고, 답 칸이 연산 바로 위에 온다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "boxChain",
      start: "219",
      steps: ["+462", "+138"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const boxes = svgRects(r.svg);
    const xs = [...new Set(boxes.map((b) => b.x))].sort((a, b) => a - b);
    const ys = [...new Set(boxes.map((b) => b.y))].sort((a, b) => a - b);
    expect(boxes).toHaveLength(5);
    expect(xs).toHaveLength(3);
    expect(ys).toHaveLength(3);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5);
    expect(ys[1]! - ys[0]!).toBeCloseTo(ys[2]! - ys[1]!, 5);

    const yOf = (label: string) => textPos(r.svg, label)?.y ?? NaN;
    const xOf = (label: string) => textPos(r.svg, label)?.x ?? NaN;
    expect(yOf("+138")).toBeLessThan(yOf("219"));
    expect(yOf("+462")).toBeGreaterThan(yOf("+138"));

    const colOf = (label: string) =>
      boxes.filter((b) => Math.abs(b.cx - xOf(label)) < 1);
    expect(colOf("+462")).toHaveLength(2);
    expect(colOf("+138")).toHaveLength(2);
  });

  it("연산 나무는 세 칸이 한 줄이고 타원이 칸 사이에 앉는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "opTree",
      start: "725",
      ops: ["-513", "+679"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const boxes = svgRects(r.svg);
    expect(boxes).toHaveLength(3);
    expect(boxes[0]!.y).toBe(boxes[1]!.y);
    expect(boxes[1]!.y).toBe(boxes[2]!.y);
    const xs = boxes.map((b) => b.x).sort((a, b) => a - b);
    expect(xs[1]! - xs[0]!).toBeCloseTo(xs[2]! - xs[1]!, 5);

    const ovals = [...r.svg.matchAll(/<ellipse cx="([0-9.]+)"/g)].map((m) =>
      Number(m[1]),
    );
    expect(ovals).toHaveLength(2);
    const centers = boxes.map((b) => b.cx).sort((a, b) => a - b);
    const mid = ovals.slice().sort((a, b) => a - b);
    expect(mid[0]).toBeCloseTo((centers[0]! + centers[1]!) / 2, 0);
    expect(mid[1]).toBeCloseTo((centers[1]! + centers[2]!) / 2, 0);
  });

  it("허용되지 않은 키는 실패한다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "sumBox",
      left: "1",
      right: "2",
      몰래: true,
    });
    expect(r.ok).toBe(false);
  });
});

describe.skipIf(!hasEngine)("[초등 그림] FigureSpec v2 — 각·도형수", () => {
  it("각 ㄱㄴㄷ 을 엔진 A 로 그린다", async () => {
    const item = CUBE_SCRAPE_ITEMS.find((it) => it.id === "eval-07");
    expect(item?.figureSpec).toBeTruthy();
    const r = await renderFigureSpec(item!.figureSpec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("ㄱ");
    expect(r.svg).toContain("ㄴ");
    expect(r.svg).toContain("ㄷ");
  });

  it("원·삼각형 안 수는 엔진 A 로 그린다", async () => {
    const item = CUBE_SCRAPE_ITEMS.find((it) => it.id === "drill-05");
    const r = await renderFigureSpec(item!.figureSpec);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    for (const n of ["207", "385", "469", "437", "543", "118"]) {
      expect(r.svg).toContain(n);
    }
  });
});

describe.skipIf(!hasEngine)(
  "[초등 그림] 큐브 표본 스펙은 전부 그려진다",
  () => {
    it("삽화(오림)를 뺀 그림 스펙이 실패하면 안 된다", async () => {
      const specs = CUBE_SCRAPE_ITEMS.filter((it) => it.figureSpec);
      expect(specs.length).toBeGreaterThan(5);
      const failed: string[] = [];
      for (const it of specs) {
        const r = await renderFigureSpec(it.figureSpec);
        if (!r.ok) failed.push(`${it.id}: ${r.error}`);
      }
      expect(failed).toEqual([]);
    });
  },
);

describe.skipIf(!hasEngine)("[초등 그림] 무작위 20 스펙", () => {
  it("세로셈은 126 과 745 를 그린다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "columnOp",
      top: "126",
      op: "+",
      bottom: "745",
      result: "871",
      highlight: "t0",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain(">1<");
    expect(r.svg).toContain(">2<");
    expect(r.svg).toContain(">6<");
    const hi = r.svg.match(
      /<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"[^>]*stroke="#b45a55"/,
    );
    const digit = r.svg.match(
      /stroke="#b45a55"[^/]*\/>\s*<text x="([0-9.]+)" y="([0-9.]+)"[^>]*>1</,
    );
    expect(hi).toBeTruthy();
    expect(digit).toBeTruthy();
    const cx = Number(hi![1]) + Number(hi![3]) / 2;
    const cy = Number(hi![2]) + Number(hi![4]) / 2;
    expect(Number(digit![1])).toBeCloseTo(cx, 5);
    expect(Number(digit![2])).toBeCloseTo(cy, 5);
  });

  it("테이프 치수 곡선은 막대 바로 위에 붙는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "tape",
      length: 20,
      label: "20cm",
      segments: 5,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toMatch(/stroke-dasharray="6 4"/);
    expect(r.svg).toMatch(/paint-order="stroke"/);
    expect(r.svg).toContain("20cm");
    const bar = r.svg.match(/<rect x="[\d.]+" y="([\d.]+)"/);
    const start = r.svg.match(/<path d="M [\d.]+ ([\d.]+)/);
    expect(bar).toBeTruthy();
    expect(start).toBeTruthy();
    expect(Math.abs(Number(bar![1]) - Number(start![1]))).toBeLessThan(3);
  });

  it("시계는 두 원을 그린다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "clocks",
      items: [
        { hour: 8, minute: 50, second: 10, label: "시작" },
        { hour: 10, minute: 20, second: 30, label: "끝" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.svg.match(/<circle /g) ?? []).length).toBeGreaterThanOrEqual(4);
  });

  it("점격자는 찍힌 점에만 점을 두고 격자 교점마다 찍지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "pointGrid",
      cols: 6,
      rows: 4,
      dots: [
        { c: 1, r: 1, label: "ㄷ", side: "up" },
        { c: 2, r: 3, label: "ㄱ", side: "down" },
      ],
      lines: [
        [
          [2, 3],
          [4, 3],
        ],
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const dots = r.svg.match(/<circle /g) ?? [];
    expect(dots).toHaveLength(2);
    expect(r.svg).toContain("ㄷ");
    expect(r.svg).toContain("ㄱ");
    expect(r.svg).toMatch(/stroke-dasharray="4 3"/);
    expect(
      (r.svg.match(/stroke-dasharray="4 3"/g) ?? []).length,
    ).toBeGreaterThan(8);
    const dashed = [
      ...r.svg.matchAll(
        /stroke="(#[0-9a-fA-F]+)" stroke-width="([0-9.]+)" stroke-dasharray="4 3"/g,
      ),
    ];
    expect(dashed.length).toBeGreaterThan(8);
    for (const hit of dashed) {
      expect(hexMean(hit[1]!)).toBeGreaterThan(180);
      expect(Number(hit[2])).toBeLessThan(0.9);
    }
    expect(r.svg).toMatch(/stroke="#111111" stroke-width="1.6"/);
  });

  it("분수 원은 조각 수만큼 나누고 색이 있는 조각만 채운다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "fracPie",
      n: 8,
      filled: [4, 5, 6, 7],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect((r.svg.match(/<path /g) ?? []).length).toBe(8);
    expect((r.svg.match(/fill="#e2b48a"/g) ?? []).length).toBe(4);
    expect((r.svg.match(/fill="#f4efe6"/g) ?? []).length).toBe(4);
    expect(r.svg).not.toMatch(/fill="#(?:c5d4e8|d4d0e8|e8e4f0)/i);
    expect(r.svg).toMatch(/stroke-dasharray="5 4"/);
  });

  it("사다리꼴 네 삼각형은 넓이가 같다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "trapFour",
      filled: [0, 1, 3],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const tris = [
      ...r.svg.matchAll(/<polygon points="([^"]+)" fill="(#[0-9a-fA-F]+)"/g),
    ].map((m) => ({ pts: m[1]!, fill: m[2]! }));
    expect(tris).toHaveLength(4);
    const areas = tris.map((t) => shoelace(t.pts));
    expect(areas[0]).toBeGreaterThan(0);
    for (const area of areas) {
      expect(area).toBeCloseTo(areas[0]!, 5);
    }
    expect(tris.filter((t) => t.fill === "#d7c2e4")).toHaveLength(3);
    const verts = new Set(tris.flatMap((t) => t.pts.trim().split(/\s+/)));
    expect(verts.size).toBe(6);
    const yCounts = new Map<number, number>();
    for (const v of verts) {
      const y = Number(v.split(",")[1]);
      yCounts.set(y, (yCounts.get(y) ?? 0) + 1);
    }
    expect([...yCounts.values()].sort((a, b) => a - b)).toEqual([2, 4]);
    expect(
      (r.svg.match(/stroke-dasharray="/g) ?? []).length,
    ).toBeGreaterThanOrEqual(3);
  });

  /**
   * 원장님 확정 2026-08-22 — 「원기둥의 반지름도 마찬가지. 문제에 굳이 있는데 라벨로
   * **이중표기**해서 너저분해질 필요가 없을듯」.
   *
   * 가르는 축은 「좁아서」가 아니라 **「발문이 이미 말했는가」**다. 값을 쓰는 갈래의 발문이
   * 「밑면의 반지름이 $2$ cm 인 원기둥의 밑면의 지름은?」이라 **반지름은 발문에 있고 높이는
   * 없다.** 그래서 반지름만 빼고 **높이는 남긴다** — 둘 다 빼면 설명 없는 점선만 남는다.
   */
  it("원기둥은 반지름을 안 적고 높이만 적는다 — 중심 점도 남기지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "cylinder",
      r: 2,
      h: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg, "높이는 적는다").toContain(">3 cm<");
    expect(r.svg, "반지름은 발문에 있으므로 안 적는다").not.toContain(">2 cm<");
    // 반지름 라벨이 없으면 중심 점은 **설명 없는 표시**다 — 같이 뺀다.
    expect(
      [...r.svg.matchAll(/<circle [^>]*r="1\.8"/g)],
      "중심 점",
    ).toHaveLength(0);
    // 높이 치수는 도형 왼쪽 바깥이다.
    const m = r.svg.match(/x="([0-9.-]+)" y="([0-9.-]+)"[^>]*>3 cm</);
    expect(m).toBeTruthy();
    const xs = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((p) =>
      p[1].split(/\s+/).map((q) => Number(q.split(",")[0])),
    );
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    expect(Number(m![1])).toBeLessThan(midX - 8);
  });

  it("쌓기나무 겨냥도와 위 보기는 겹치지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "stackCubes",
      voxels: [
        [0, 0, 0],
        [0, 0, 1],
        [0, 0, 2],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
        [1, 1, 1],
        [1, 1, 2],
      ],
      views: ["iso", "top"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const polyXs = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
      m[1].split(/\s+/).map((p) => Number(p.split(",")[0])),
    );
    const cells = [
      ...r.svg.matchAll(
        /<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g,
      ),
    ].filter((m) => Number(m[3]) === Number(m[4]) && Number(m[3]) >= 16);
    const minCellX = Math.min(...cells.map((m) => Number(m[1])));
    expect(Math.max(...polyXs)).toBeLessThan(minCellX - 4);
    const title = r.svg.match(/y="([0-9.-]+)"[^>]*>위</);
    expect(title).toBeTruthy();
    const minCellY = Math.min(...cells.map((m) => Number(m[2])));
    expect(Number(title![1])).toBeLessThan(minCellY - 4);
  });

  it("쌓기나무 위 보기 숫자는 칸 중앙, 위 글자는 격자 위에 있다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "stackCubes",
      voxels: [
        [0, 0, 0],
        [0, 0, 1],
        [1, 0, 0],
        [0, 1, 0],
        [1, 1, 0],
      ],
      views: ["top"],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const title = r.svg.match(/y="([0-9.-]+)"[^>]*>위</);
    expect(title).toBeTruthy();
    const cells = [
      ...r.svg.matchAll(
        /<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g,
      ),
    ].filter((m) => Number(m[3]) === Number(m[4]) && Number(m[3]) >= 16);
    expect(cells.length).toBeGreaterThan(0);
    const minCellY = Math.min(...cells.map((m) => Number(m[2])));
    expect(Number(title![1])).toBeLessThan(minCellY - 4);
    const nums = [
      ...r.svg.matchAll(/x="([0-9.]+)" y="([0-9.]+)"[^>]*>(\d+)</g),
    ];
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) {
      const nx = Number(n[1]);
      const ny = Number(n[2]);
      const hit = cells.find((c) => {
        const x = Number(c[1]);
        const y = Number(c[2]);
        const s = Number(c[3]);
        return (
          Math.abs(nx - (x + s / 2)) < 0.6 && Math.abs(ny - (y + s / 2)) < 0.6
        );
      });
      expect(hit, `${n[3]} at ${nx},${ny}`).toBeTruthy();
    }
  });

  it("각뿔은 옆면이 한 장으로 납작하지 않고 밑면 각형이 보인다", async () => {
    for (const sides of [3, 4, 5, 6]) {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "pyramid",
        sides,
        h: 3,
      });
      expect(r.ok, `sides=${sides}`).toBe(true);
      if (!r.ok) return;
      const polys = [...r.svg.matchAll(/<polygon points="([^"]+)"/g)].map(
        (m) => m[1].trim().split(/\s+/).length,
      );
      expect(
        polys.some((n) => n === sides),
        `밑면 ${sides}각형`,
      ).toBe(true);
      expect(polys.filter((n) => n === 3).length).toBeGreaterThanOrEqual(2);
    }
  });

  it("원뿔은 밑면 타원 위에 삼각형을 얹지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "cone",
      r: 2,
      h: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const polys = [...r.svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) =>
      m[1]
        .trim()
        .split(/\s+/)
        .map((p) => p.split(",").map(Number) as [number, number]),
    );
    expect(polys.some((pts) => pts.length === 3)).toBe(false);
    const body = polys.reduce((a, b) => (a.length >= b.length ? a : b), []);
    expect(body.length).toBeGreaterThan(10);
    const ys = body.map((p) => p[1]);
    const minY = Math.min(...ys);
    expect(ys.filter((y) => y < minY + 6).length).toBe(1);
    expect(r.svg).toMatch(/stroke-dasharray="/);
    const vb = r.svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
    expect(vb).toBeTruthy();
    const boxW = Number(vb![1]);
    const boxH = Number(vb![2]);
    for (const [x, y] of body) {
      expect(x).toBeGreaterThanOrEqual(-0.5);
      expect(y).toBeGreaterThanOrEqual(-0.5);
      expect(x).toBeLessThanOrEqual(boxW + 0.5);
      expect(y).toBeLessThanOrEqual(boxH + 0.5);
    }
  });

  it("각기둥 겨냥도는 잘리지 않고 밑면 꼭짓점이 보인다", async () => {
    for (const sides of [3, 4, 5, 6]) {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "prism",
        sides,
        h: 3,
      });
      expect(r.ok, `sides=${sides}`).toBe(true);
      if (!r.ok) return;
      const vb = r.svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
      expect(vb).toBeTruthy();
      const boxW = Number(vb![1]);
      const boxH = Number(vb![2]);
      const pts = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
        m[1].split(/\s+/).map((p) => p.split(",").map(Number)),
      );
      expect(pts.length).toBeGreaterThan(sides);
      for (const [x, y] of pts) {
        expect(x).toBeGreaterThanOrEqual(-0.5);
        expect(y).toBeGreaterThanOrEqual(-0.5);
        expect(x).toBeLessThanOrEqual(boxW + 0.5);
        expect(y).toBeLessThanOrEqual(boxH + 0.5);
      }
      const polys = [...r.svg.matchAll(/<polygon points="([^"]+)"/g)];
      const top = polys[polys.length - 1]![1].trim().split(/\s+/);
      expect(top.length).toBe(sides);
    }
  });

  it("원기둥 전개도는 밑면 원이 옆면 직사각형 긴 변에 붙는다", async () => {
    const layouts = ["opp", "oppFlip", "oppMid", "sameTop", "sameBot", "ends"];
    const signatures = new Set<string>();
    for (const layout of layouts) {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "netCylinder",
        r: 2,
        h: 5,
        pi: 3,
        layout,
      });
      expect(r.ok, layout).toBe(true);
      if (!r.ok) return;
      const net = parseCylinderNet(r.svg);
      expect(net.rect, layout).toBeTruthy();
      expect(net.circles, layout).toHaveLength(2);
      const sides = net.circles.map((c) => attachLongSide(c, net.rect!));
      expect(sides.every(Boolean), `${layout} 원이 긴 변에 접해야 함`).toBe(
        true,
      );
      const [a, b] = net.circles;
      expect(Math.hypot(a!.cx - b!.cx, a!.cy - b!.cy)).toBeGreaterThanOrEqual(
        2 * a!.r - 0.8,
      );
      expect(net.rect!.w / (2 * a!.r)).toBeCloseTo(3, 1);
      signatures.add(
        net.circles
          .map((c) => `${c.cx.toFixed(1)},${c.cy.toFixed(1)}`)
          .sort()
          .join("|"),
      );
    }
    expect(signatures.size).toBe(layouts.length);
  });

  it("원기둥 전개도 모르는 배치는 실패한다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "netCylinder",
      r: 2,
      h: 5,
      pi: 3,
      layout: "float",
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error).toMatch(/layout|배치/);
  });

  it("전개도 면 안에 가로×세로 곱셈을 쓰지 않는다", async () => {
    const cube = await renderFigureSpec({
      version: "elem-1",
      kind: "netCuboid",
      w: 1,
      d: 1,
      h: 1,
    });
    const box = await renderFigureSpec({
      version: "elem-1",
      kind: "netCuboid",
      w: 7,
      d: 4,
      h: 5,
    });
    expect(cube.ok && box.ok).toBe(true);
    if (!cube.ok || !box.ok) return;
    expect(cube.svg).not.toMatch(/×|&times;/);
    expect(box.svg).not.toContain("7×4");
    expect(box.svg).toContain("7 cm");
    expect(box.svg).toContain("4 cm");
    expect(box.svg).toContain("5 cm");
  });

  it("직육면체 가로는 아래, 높이는 왼쪽, 세로는 아래-오른쪽에 둔다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "cuboid",
      w: 8,
      d: 2,
      h: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pos = (label: string) => {
      const m = r.svg.match(
        new RegExp(`x="([0-9.-]+)" y="([0-9.-]+)"[^>]*>${label}<`),
      );
      expect(m, label).toBeTruthy();
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const width = pos("8 cm");
    const depth = pos("2 cm");
    const height = pos("4 cm");
    const dist = (p: { x: number; y: number }, q: { x: number; y: number }) =>
      Math.hypot(p.x - q.x, p.y - q.y);
    expect(dist(width, depth)).toBeGreaterThan(28);
    expect(dist(width, height)).toBeGreaterThan(28);
    expect(dist(depth, height)).toBeGreaterThan(28);
    expect(width.y).toBeGreaterThan(height.y);
    expect(height.x).toBeLessThan(width.x);
    expect(depth.x).toBeGreaterThan(width.x);
    expect(depth.y).toBeGreaterThan(height.y);
  });

  it("대칭 윤곽 도형은 격자 칸이 아니라 다각형이다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "symmetry",
      axis: "v",
      motif: "kite",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("<polygon");
    expect((r.svg.match(/<rect /g) ?? []).length).toBe(0);
  });

  it("직사각형 그림 비율은 가로·세로 길이를 따른다", async () => {
    const a = await renderFigureSpec({
      version: "elem-1",
      kind: "areaPoly",
      shape: "rect",
      base: 4,
      height: 5,
    });
    const b = await renderFigureSpec({
      version: "elem-1",
      kind: "areaPoly",
      shape: "rect",
      base: 9,
      height: 8,
    });
    expect(a.ok && b.ok).toBe(true);
    if (!a.ok || !b.ok) return;
    const box = (svg: string) => {
      const m = svg.match(
        /<rect x="[0-9.]+" y="[0-9.]+" width="([0-9.]+)" height="([0-9.]+)"/,
      );
      expect(m).toBeTruthy();
      return { w: Number(m![1]), h: Number(m![2]) };
    };
    const sa = box(a.svg);
    const sb = box(b.svg);
    expect(sa.w / sa.h).toBeCloseTo(4 / 5, 2);
    expect(sb.w / sb.h).toBeCloseTo(9 / 8, 2);
    expect(sb.w).toBeGreaterThan(sa.w);
  });

  /**
   * 원장님 확정 2026-08-22 — 「마름모는 … 내부에는 라벨 표기 안 하는 걸로 하자.
   * 표기하니까 오히려 너저분해지는듯」. 네 안을 다 그려 본 뒤 나온 결정이다.
   * **대각선 점선은 남기고 라벨만 뺀다** — 넓이 규칙이 그 선에서 보인다.
   */
  it("마름모는 대각선 점선만 그리고 길이 라벨은 적지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "areaPoly",
      shape: "rhombus",
      base: 8,
      height: 4,
      d2: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg, "마름모는 라벨을 적지 않는다").not.toMatch(/\d\s*cm/);
    expect(
      [...r.svg.matchAll(/<line [^>]*stroke-dasharray="5 4"/g)],
      "대각선 점선 둘",
    ).toHaveLength(2);
  });

  it("정삼각형은 세 변의 길이가 같다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "namedShapes",
      items: [{ shape: "eqTri", label: "가" }],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const raw = r.svg.match(/points="([^"]+)"/);
    expect(raw).toBeTruthy();
    const pts = raw![1].split(/\s+/).map((p) => p.split(",").map(Number));
    expect(pts).toHaveLength(3);
    const dist = (a: number[], b: number[]) =>
      Math.hypot(a[0]! - b[0]!, a[1]! - b[1]!);
    const ab = dist(pts[0]!, pts[1]!);
    const bc = dist(pts[1]!, pts[2]!);
    const ca = dist(pts[2]!, pts[0]!);
    expect(ab).toBeCloseTo(bc, 1);
    expect(bc).toBeCloseTo(ca, 1);
  });

  it("이름 붙인 도형의 라벨은 같은 행에서 높이가 같다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "namedShapes",
      items: [
        { shape: "square", label: "가" },
        { shape: "rightTri", label: "나" },
        { shape: "isoTri", label: "다" },
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const ys = ["가", "나", "다"].map((lab) => textPos(r.svg, lab)?.y);
    expect(ys[0]).toBeDefined();
    expect(ys[0]).toBe(ys[1]);
    expect(ys[0]).toBe(ys[2]);
  });

  it("열이 많은 표는 viewBox 를 키워 숫자를 줄이지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "table",
      headers: ["×", "3", "4", "5", "6", "7", "8"],
      rows: [["4", "12", "16", "20", "24", "28", "32"]],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const vb = r.svg.match(/viewBox="0 0 ([0-9.]+)/);
    expect(vb).toBeTruthy();
    expect(Number(vb![1])).toBeLessThanOrEqual(240);
    expect(r.svg).toMatch(/font-size="1[23]"/);
  });

  it("소수 수직선은 빈칸 눈금에 상자를 둔다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "numberLine",
      min: 0,
      max: 1,
      step: 0.1,
      tick: 0.1,
      blanks: [0.1, 0.3],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain("0.2");
    expect(r.svg).not.toContain(">0.1<");
    expect(r.svg).toContain("<rect ");
  });

  it("나누기 삼각형은 개수 상자와 점선이 있다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "divideTriangle",
      n: 4,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.svg).toContain(">4</text>");
    expect(r.svg).toMatch(/stroke-dasharray="5 4"/);
  });

  it("그림 스펙이 있는 무작위 문항은 전부 그려진다", async () => {
    const specs = CUBE_RANDOM_20.filter((it) => it.figureSpec);
    expect(specs.length).toBeGreaterThan(10);
    const failed: string[] = [];
    for (const it of specs) {
      const r = await renderFigureSpec(it.figureSpec);
      if (!r.ok) failed.push(`${it.id}: ${r.error}`);
    }
    expect(failed).toEqual([]);
  });
});

/**
 * 원장님 육안 검수 2026-08-22 (`docs/planning/tracks/elem-engine-review-20260822.md`).
 * 판정의 «참» 은 **화면 좌표**에서 온다 — 제품이 3D 법선으로 정한 것을 여기서 다시
 * 법선으로 재면 동어반복이다(CLAUDE.md 2026-08-18). 실루엣과 앞·뒤 사슬로 따로 센다.
 */
describe.skipIf(!hasEngine)(
  "[초등 그림] 겨냥도 — 숨은 모서리는 점선 (원장님 2026-08-22 ⑪)",
  () => {
    for (const sides of [3, 4, 5, 6, 7, 8]) {
      it(`${sides}각기둥은 숨은 모서리를 면 위에 점선으로 그린다`, async () => {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "prism",
          sides,
          h: 3,
        });
        expect(r.ok, `sides=${sides}`).toBe(true);
        if (!r.ok) return;
        const polys = svgPolygons(r.svg);
        const hidden = dashedLinesAfterPolygons(r.svg);
        // ⑴ 점선이 면 **뒤**에 깔리면 칠에 덮여 막힌 덩어리가 된다.
        expect(hidden.length, "숨은 모서리가 면 뒤에 깔렸다").toBeGreaterThan(
          0,
        );
        // ⑵ 꼭짓점은 밑면 n + 윗면 n. 마지막 폴리곤이 윗면이다.
        const verts = uniquePoints(polys.flat());
        expect(verts).toHaveLength(sides * 2);
        const top = uniquePoints(polys[polys.length - 1]!);
        expect(top).toHaveLength(sides);
        const bottom = verts.filter((p) => !top.some((q) => samePoint(p, q)));
        expect(bottom).toHaveLength(sides);
        // ⑶ 숨은 모서리 수는 화면에서 따로 셀 수 있다 — 옆면 법선이 수평이므로 밑면
        //    고리를 좌·우 끝에서 가르면 위쪽(뒤) 사슬의 변 c 개와 그 안쪽 세로 모서리
        //    c−1 개가 숨는다. 제품은 3D 법선으로 정하니 서로 다른 길로 같은 수에 닿는다.
        const c = backChainEdgeCount(bottom);
        expect(hidden).toHaveLength(2 * c - 1);
        for (const [a, b] of hidden) {
          expect(
            verts.some((p) => samePoint(p, a)),
            `끝점 ${a}`,
          ).toBe(true);
          expect(
            verts.some((p) => samePoint(p, b)),
            `끝점 ${b}`,
          ).toBe(true);
        }
        // ⑷ 세로 모서리가 하나는 점선이어야 «막힌 덩어리»가 아니다.
        const vertical = hidden.filter(([a, b]) => Math.abs(a[0] - b[0]) < 0.6);
        expect(vertical.length, "숨은 세로 모서리").toBe(c - 1);
        const baseHidden = hidden.filter(
          ([a, b]) => Math.abs(a[0] - b[0]) >= 0.6,
        );
        expect(baseHidden).toHaveLength(c);
        expect(isContiguousChain(bottom, baseHidden)).toBe(true);
      });

      it(`${sides}각뿔은 밑면뿐 아니라 **모선**도 점선으로 그린다`, async () => {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "pyramid",
          sides,
          h: 3,
        });
        expect(r.ok, `sides=${sides}`).toBe(true);
        if (!r.ok) return;
        const polys = svgPolygons(r.svg);
        const hidden = dashedLinesAfterPolygons(r.svg);
        const base = uniquePoints(polys[0]!);
        expect(base).toHaveLength(sides);
        const verts = uniquePoints(polys.flat());
        expect(verts).toHaveLength(sides + 1);
        const apex = verts.find((p) => !base.some((q) => samePoint(p, q)))!;
        expect(apex).toBeTruthy();
        const lateral = hidden.filter(
          ([a, b]) => samePoint(a, apex) || samePoint(b, apex),
        );
        const baseHidden = hidden.filter(
          ([a, b]) => !samePoint(a, apex) && !samePoint(b, apex),
        );
        // ⚠️ 각기둥 규칙(뒤쪽 사슬 = 숨은 면)을 각뿔에 그대로 대면 안 된다 — 꼭대기가
        //    옆면 법선을 위로 눕혀 **보이는 옆면이 더 많다**(칠각뿔에서 실제로 갈렸다).
        //    그래서 개수 대신 **구조**를 잰다: 뒤를 보는 옆면이 k 장이면 밑면 점선 k 개와
        //    그 사이 모선 k−1 개가 숨는다. 모선을 빼먹으면 이 등식이 깨진다.
        expect(baseHidden.length, "숨은 밑면 모서리").toBeGreaterThan(0);
        expect(lateral, "숨은 모선").toHaveLength(baseHidden.length - 1);
        // 숨은 밑면 모서리는 고리에서 **이어진 한 토막**이다.
        expect(isContiguousChain(base, baseHidden)).toBe(true);
        const visibleBase = ringEdges(base).filter(
          (e) => !baseHidden.some((h) => sameEdge(h, e)),
        );
        expect(visibleBase.length).toBe(sides - baseHidden.length);
        // 그리고 실루엣 위에 있을 수 없다 — 실루엣 모서리는 앞뒤 면을 하나씩 낀다.
        // ⚠️ 「보이는 모서리보다 화면에서 위」로 재면 안 된다. 뒤를 보는지는 모서리의
        //    **법선 방향**이 정하지 깊이가 정하지 않아, 돌린 오각뿔에서 순서가 뒤집힌다.
        for (const e of hidden) {
          expect(
            insideHull(verts, midPoint(e)),
            `실루엣 위의 숨은 모서리 ${e}`,
          ).toBe(true);
        }
      });
    }

    it("각기둥 세로 모서리는 화면에서 겹치지 않는다 — 점선이 실선에 붙으면 못 센다", async () => {
      for (const sides of [3, 4, 5, 6, 7, 8]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "prism",
          sides,
          h: 3,
        });
        expect(r.ok, `sides=${sides}`).toBe(true);
        if (!r.ok) return;
        const xs = uniquePoints(svgPolygons(r.svg).flat())
          .map((p) => p[0])
          .sort((a, b) => a - b);
        const gaps = xs
          .slice(1)
          .map((x, i) => x - xs[i]!)
          .filter((g) => g > 0.15);
        expect(
          Math.min(...gaps),
          `${sides}각기둥 세로 모서리 간격`,
        ).toBeGreaterThan(6);
      }
    });

    it("각뿔 모선은 꼭대기에서 부챗살로 갈라진다 — 극각이 붙으면 겹쳐 그려진다", async () => {
      for (const sides of [3, 4, 5, 6, 7, 8]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "pyramid",
          sides,
          h: 3,
        });
        expect(r.ok, `sides=${sides}`).toBe(true);
        if (!r.ok) return;
        const polys = svgPolygons(r.svg);
        const base = uniquePoints(polys[0]!);
        const apex = uniquePoints(polys.flat()).find(
          (p) => !base.some((q) => samePoint(p, q)),
        )!;
        const polar = base
          .map(
            (p) => (Math.atan2(p[1] - apex[1], p[0] - apex[0]) * 180) / Math.PI,
          )
          .sort((a, b) => a - b);
        const gaps = polar.slice(1).map((v, i) => v - polar[i]!);
        expect(
          Math.min(...gaps),
          `${sides}각뿔 모선 극각 간격`,
        ).toBeGreaterThan(2.5);
      }
    });

    it("직육면체도 같은 기준 — 뒤 꼭짓점에 닿는 모서리 셋이 점선", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "cuboid",
        w: 8,
        d: 2,
        h: 4,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const hidden = dashedLinesAfterPolygons(r.svg);
      expect(hidden).toHaveLength(3);
      const ends = hidden.flat();
      const shared = ends.filter(
        (p) => ends.filter((q) => samePoint(p, q)).length === 3,
      );
      expect(shared.length, "세 점선이 한 꼭짓점에서 만나야 한다").toBe(3);
    });
  },
);

describe.skipIf(!hasEngine)(
  "[초등 그림] 원기둥·원뿔 밑면은 타원기둥이 아니다 (원장님 2026-08-22 ②)",
  () => {
    // ⚠️ 납작한 **정도**는 여기서 안 잰다 — 「밑면 타원의 납작한 정도」 검사가
    //    눈금을 맞춰 **정확히** 잡는다(0.15). 두 곳이 같은 것을 재면 값을 바꿀 때
    //    한쪽만 고치고 다른 쪽이 낡는다. 여기 몫은 **기울기**뿐이다 —
    //    사방투영(45°)은 납작한 정도가 범위 안이어도 **기울어** 있다(09 §4-15).

    it("원기둥 윗면 타원은 **축에 나란**하다 — 사방투영처럼 기울지 않는다", async () => {
      for (const [rr, hh] of [
        [2, 3],
        [3, 8],
        [5, 2],
      ]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "cylinder",
          r: rr,
          h: hh,
        });
        expect(r.ok, `${rr}/${hh}`).toBe(true);
        if (!r.ok) return;
        const top = polygonsByFill(r.svg, "#f2e6d4")[0]!;
        expect(top, `r=${rr} h=${hh} 윗면`).toBeTruthy();
        expect(axisTilt(top), `r=${rr} h=${hh} 기울기`).toBeLessThan(1.0);
      }
    });

    it("원기둥 밑면 뒤쪽 호는 점선이고, 옆면을 곧은 선으로 가로막지 않는다", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "cylinder",
        r: 2,
        h: 3,
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const far = [
        ...r.svg.matchAll(/<polyline points="([^"]+)"[^>]*stroke-dasharray/g),
      ].map((m) => parsePoints(m[1]!));
      expect(far, "밑면 숨은 호").toHaveLength(1);
      expect(far[0]!.length).toBeGreaterThan(10);
      // 옆면은 위·아래 앞쪽 호를 그대로 잇는다 — 네 점 사각형이면 밑면을 가로지르는
      // 실선이 남아 「밑면이 잘린 배」처럼 보인다.
      const body = polygonsByFill(r.svg, "#e4d3b8")[0];
      expect(body).toBeTruthy();
      expect(body!.length).toBeGreaterThan(20);
    });

    /**
     * **구도 같은 자로 잰다.** 이 검사에 구가 빠져 있어서 구만 `0.32` 인 것을 아무도
     * 못 봤다 — 그때는 `ROUND_RATIO` 를 원기둥·원뿔만 쓰고 구는 **날 리터럴**이라
     * 상수를 조여도 구는 그대로 남았다(2026-08-18 「배선이 한쪽만」).
     * 지금은 **셋이 한 상수를 쓴다.** 이 검사가 그 배선을 지킨다 — 누가 다시 갈라놓으면
     * 구 칸이 혼자 빨개진다.
     *
     * ⚠️ 셋이 서로 다른 «요소»로 그려진다 — 원기둥·원뿔은 **폴리곤**, 구만 `<ellipse>` 다.
     *    `<ellipse>` 만 찾는 자를 쓰면 앞의 둘은 **구조적으로 0**이 된다(못 재는 것이
     *    깨끗한 것으로 보인다). 그래서 kind 마다 재는 자리를 따로 적는다.
     */
    /**
     * **밑면 타원의 납작한 정도를 «눈금 맞춘» 자로 잰다.**
     *
     * ⚠️ 「수가 나오나」도 「값이 변하나」도 자를 지켜 주지 못한다 — 엉뚱한 요소를 재도
     *    **값이 같이 움직인다.** 실측(elem_advanced 기준): 비율을 0.30 → 0.15 로 바꾸면
     *    원기둥 **몸통**이 0.900 → 0.825 로 따라 움직이고, 원뿔 **실루엣**도 그렇다.
     *    그걸 재면 비율을 잠가 놓고 몸통을 지키는 **동어반복**이 된다.
     *
     * 그래서 눈금은 **「그 수가 비율과 같은가」**로 맞춘다. 그리고 **`r·h` 가 다른 두 점**을
     *    쓴다 — 밑면 타원의 비는 `r·h` 와 무관하게 일정하지만(0.300 · 0.300),
     *    몸통·실루엣은 `r·h` 에 따라 **0.900 / 0.550** 으로 갈린다. 엉뚱한 요소를 재면
     *    두 점에서 같은 값이 나올 수 없다.
     *
     * ⚠️ 셋이 서로 다른 «요소»로 그려진다 — 원기둥·원뿔은 **폴리곤**, 구만 `<ellipse>` 다.
     *    `<ellipse>` 만 찾는 자를 쓰면 앞의 둘은 **구조적으로 0**이 된다.
     *
     * ⚠️ 기대값은 **여기 적힌 리터럴**이다. 제품 상수를 읽으면 상수를 바꿀 때 기대값이
     *    따라가서 영원히 초록이다. 상수를 바꾸면 이 줄도 **일부러** 같이 고쳐야 한다.
     */
    it("밑면 타원의 납작한 정도 — 자가 «비율 그 자체»를 재는지 눈금까지 맞춘다", async () => {
      // 원장님 확정 2026-08-22 — 「절대 … 타원이 그려지지 않도록」. **셋이 한 숫자를 쓴다.**
      // 예전엔 구만 `0.32` 라 상수를 조여도 안 따라왔다(배선이 한쪽만).
      // 눈금 실측 12/12: p ∈ {0.30, 0.20, 0.15, 0.12} × r2h3·r5h4 에서 잰 값 = p (오차 <0.002).
      const RATIO = 0.15;

      for (const [rr, hh] of [
        [2, 3],
        [5, 4],
      ]) {
        const cyl = await renderFigureSpec({
          version: "elem-1",
          kind: "cylinder",
          r: rr,
          h: hh,
        });
        expect(cyl.ok, `원기둥 r${rr}h${hh}`).toBe(true);
        if (!cyl.ok) return;
        const top = polygonsByFill(cyl.svg, "#f2e6d4")[0]!;
        expect(top, "원기둥 윗면").toBeTruthy();
        expect(ellipseFlatness(top), `원기둥 r${rr}h${hh} 밑면 비`).toBeCloseTo(
          RATIO,
          3,
        );

        const cone = await renderFigureSpec({
          version: "elem-1",
          kind: "cone",
          r: rr,
          h: hh,
        });
        expect(cone.ok, `원뿔 r${rr}h${hh}`).toBe(true);
        if (!cone.ok) return;
        // 원뿔은 밑면 다각형이 따로 없다 — 실루엣에서 꼭대기를 뺀 앞쪽 호 + 뒤쪽 점선 호.
        const body = polygonsByFill(cone.svg, "#e4d3b8")[0]!;
        const far = parsePoints(
          cone.svg.match(
            /<polyline points="([^"]+)"[^>]*stroke-dasharray/,
          )![1]!,
        );
        expect(
          ellipseFlatness([...body.slice(1), ...far]),
          `원뿔 r${rr}h${hh} 밑면 비`,
        ).toBeCloseTo(RATIO, 3);
      }

      const ball = await renderFigureSpec({
        version: "elem-1",
        kind: "sphere",
        r: 3,
      });
      expect(ball.ok).toBe(true);
      if (!ball.ok) return;
      const m = ball.svg.match(/<ellipse[^>]*rx="([\d.]+)" ry="([\d.]+)"/);
      expect(m, "구 적도 타원").toBeTruthy();
      expect(Number(m![2]) / Number(m![1]), "구 적도 비").toBeCloseTo(RATIO, 3);
    });

    it("원뿔 밑면 타원도 **축에 나란**하다", async () => {
      for (const [rr, hh] of [
        [2, 4],
        [4, 3],
      ]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "cone",
          r: rr,
          h: hh,
        });
        expect(r.ok, `${rr}/${hh}`).toBe(true);
        if (!r.ok) return;
        const near = polygonsByFill(r.svg, "#e4d3b8")[0]!;
        expect(near, `r=${rr} h=${hh} 옆면`).toBeTruthy();
        const far = parsePoints(
          r.svg.match(/<polyline points="([^"]+)"[^>]*stroke-dasharray/)![1]!,
        );
        expect(axisTilt(far), `r=${rr} h=${hh} 기울기`).toBeLessThan(1.0);
      }
    });
  },
);

describe.skipIf(!hasEngine)(
  "[초등 그림] 치수 라벨은 measured() 하나로 (원장님 2026-08-22 ⑧)",
  () => {
    const WITH_DIMS = [
      {
        version: "elem-1",
        kind: "areaPoly",
        shape: "rect",
        base: 4,
        height: 5,
      },
      { version: "elem-1", kind: "areaPoly", shape: "tri", base: 8, height: 5 },
      {
        version: "elem-1",
        kind: "areaPoly",
        shape: "para",
        base: 7,
        height: 4,
      },
      {
        version: "elem-1",
        kind: "areaPoly",
        shape: "trap",
        base: 8,
        height: 4,
        top: 5,
      },
      // ⚠️ `rhombus`·`sphere` 는 일부러 뺐다 — 원장님이 라벨을 안 적기로 확정하셨다
      //    (2026-08-22, 이중표기). 「라벨이 있으면 halo 여야 한다」는 규칙은 그대로다.
      { version: "elem-1", kind: "cuboid", w: 8, d: 2, h: 4 },
      { version: "elem-1", kind: "cylinder", r: 2, h: 3 },
      { version: "elem-1", kind: "netCuboid", w: 7, d: 4, h: 5 },
      { version: "elem-1", kind: "tape", length: 20, label: "20cm" },
    ];

    /**
     * 「받은 치수를 전부 적는가」는 「라벨이 measured() 인가」와 **다른 축**이다.
     * 사다리꼴은 뒤 검사가 초록인 채로 높이 점선에 값이 없었다 — 지면에 설명 없는
     * 점선 하나가 남는다. 원장님 ⑭「어디를 가리키는지 모르겠다」와 같은 부류다.
     */
    it("areaPoly 는 스펙이 준 치수를 하나도 빠뜨리지 않는다", async () => {
      const cases: { spec: Record<string, unknown>; want: number[] }[] = [
        { spec: { shape: "rect", base: 9, height: 5 }, want: [9, 5] },
        { spec: { shape: "tri", base: 10, height: 6 }, want: [10, 6] },
        { spec: { shape: "para", base: 11, height: 7 }, want: [11, 7] },
        {
          spec: { shape: "trap", base: 10, height: 6, top: 4 },
          want: [10, 6, 4],
        },
        // 마름모는 `want: []` 다 — 원장님 확정으로 **라벨을 안 적는다**(2026-08-22).
        // 「하나도 빠뜨리지 않는다」와 「안 적는다」가 부딪히므로 여기서 빼고,
        // 대신 「비율대로 그려지는가」로 잰다. 다만 **설명 없는 점선** 검사(아래)는
        // 마름모에도 그대로 대야 한다 — 대각선 둘이 라벨 없이 남기 때문이다.
        { spec: { shape: "rhombus", base: 12, height: 8, d2: 8 }, want: [] },
      ];
      const missing: string[] = [];
      for (const c of cases) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "areaPoly",
          ...c.spec,
        });
        expect(r.ok, String(c.spec.shape)).toBe(true);
        if (!r.ok) return;
        const shown = new Set(
          [...r.svg.matchAll(/<text[^>]*>([\d.]+) cm<\/text>/g)].map((m) =>
            Number(m[1]),
          ),
        );
        for (const v of c.want) {
          if (!shown.has(v))
            missing.push(`${c.spec.shape}: ${v} cm 가 지면에 없다`);
        }
        // 설명 없는 점선이 남지 않는가 — 안내선은 치수 곡선과 **짝**이어야 한다.
        //
        // ⚠️ 마름모는 **일부러 예외**다. 원장님이 라벨을 안 적기로 확정하셔서(2026-08-22)
        //    대각선 점선 둘이 설명 없이 남는다 — 그건 결함이 아니라 결정이다. 규칙을
        //    조용히 약하게 만들지 않고 **예외라고 적는다.** 대신 마름모가 잃은 조명은
        //    「비율대로 그려지는가」가 대신 켠다(바로 위 시험).
        if (c.want.length > 0) {
          const guides = (r.svg.match(/stroke-dasharray="5 4"/g) ?? []).length;
          const dims = (r.svg.match(/stroke-dasharray="6 4"/g) ?? []).length;
          expect(dims, `${c.spec.shape} 치수 곡선`).toBeGreaterThanOrEqual(
            guides,
          );
        } else {
          expect(shown.size, `${c.spec.shape} 는 라벨이 없어야 한다`).toBe(0);
        }
      }
      expect(missing).toEqual([]);
    });

    /**
     * **지면에서 끈 조명을 여기로 옮긴 것이다.**
     *
     * 원장님이 마름모 라벨을 빼기로 하셨으므로(2026-08-22) §4-20 의 「값이 곧 조명」이
     * 지면에서 사라진다 — 그리고 §4-21(`height` 로 그리고 `d2` 로 적던 자리)을 지면에서
     * 잡아 줄 근거가 **그 라벨이었다.** 원장님 결정은 **지면**에 대한 것이지 **검사**에
     * 대한 것이 아니다. 그래서 라벨이 하던 일을 시험이 대신 한다 —
     * 「그린 가로:세로가 스펙의 `d1:d2` 와 맞는가」를 SVG 에서 **직접** 잰다.
     *
     * ⚠️ `height != d2` 인 입력이 이 검사의 핵심이다. 같은 값만 넣으면 무엇으로 그리든
     *    비가 같아서 §4-21 자리가 구조적으로 안 갈린다.
     */
    it("마름모는 라벨이 없어도 스펙의 대각선 비율대로 그려진다", async () => {
      for (const [d1, d2, height] of [
        [12, 8, 4], // height != d2 — §4-21 자리. height 로 그리면 비가 3.0 이 된다
        [18, 6, 6],
        [6, 11, 11],
      ]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "areaPoly",
          shape: "rhombus",
          base: d1,
          height,
          d2,
        });
        expect(r.ok, `${d1}x${d2}`).toBe(true);
        if (!r.ok) return;
        const pts = parsePoints(r.svg.match(/<polygon points="([^"]+)"/)![1]!);
        const xs = pts.map((p) => p[0]);
        const ys = pts.map((p) => p[1]);
        const w = Math.max(...xs) - Math.min(...xs);
        const h = Math.max(...ys) - Math.min(...ys);
        expect(w / h, `가로:세로 = ${d1}:${d2}`).toBeCloseTo(d1 / d2, 1);
      }
    });

    /**
     * **전 kind 를 훑는다.** 예전엔 `WITH_DIMS` 라는 손 목록만 봤고, 거기 `sphere` 가
     * 없어서 「반지름 3 cm」 **날 텍스트**를 구조적으로 못 봤다 — 09 §4-22 에 「손 목록은
     * 샌다」를 적어 놓고 **내 시험이 바로 그 모양**이었다. 라벨이 있어야 한다고 요구하지
     * 않고, **있으면 halo 여야 한다**만 본다. 그래야 라벨을 뺀 kind 도 같이 훑을 수 있다.
     */
    /**
     * 원기둥도 마름모와 같다 — 반지름 라벨을 뺐으니(원장님 확정 2026-08-22, 이중표기)
     * **그린 비가 스펙과 맞는지 아무도 안 본다.** 그 조명을 여기로 옮긴다.
     *
     * 절대 크기는 원래 안 지킨다(`scale = 70/max(2r,h)` 라 `2r ≥ h` 면 반지름이 늘 35px).
     * 지키는 것은 **`r:h` 비**뿐이고, 그것만은 정확하다 — 둘 다 같은 `scale` 을 곱하니까.
     */
    it("원기둥은 라벨이 없어도 스펙의 r:h 비율대로 그려진다", async () => {
      for (const [rr, hh] of [
        [2, 3],
        [5, 4],
        [3, 8],
      ]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "cylinder",
          r: rr,
          h: hh,
        });
        expect(r.ok, `r=${rr} h=${hh}`).toBe(true);
        if (!r.ok) return;
        const top = polygonsByFill(r.svg, "#f2e6d4")[0]!;
        const body = polygonsByFill(r.svg, "#e4d3b8")[0]!;
        const rpx =
          (Math.max(...top.map((p) => p[0])) -
            Math.min(...top.map((p) => p[0]))) /
          2;
        // 높이 = 왼쪽 모선. 옆면 폴리곤의 최좌점 둘(위·아래)의 y 차이다.
        const xmin = Math.min(...body.map((p) => p[0]));
        const leftYs = body.filter((p) => p[0] - xmin < 0.3).map((p) => p[1]);
        const hpx = Math.max(...leftYs) - Math.min(...leftYs);
        expect(rpx / hpx, `r:h = ${rr}:${hh}`).toBeCloseTo(rr / hh, 1);
      }
    });

    /**
     * **구는 `r` 을 그림에 안 담는다** — `pr = 36.0` 리터럴이라 `r=1` 과 `r=20` 이 같은 원이다.
     * 지금 구 문항은 길이를 그림에서 읽지 않으므로(전부 「어떤 도형인가」류) 성립하지만,
     * 「그림을 보고 반지름을 구하시오」가 생기면 **그 순간 못 쓴다.**
     *
     * 이 시험은 고치라는 것이 아니라 **지금이 어떤 상태인지 적어 두는 것**이다 —
     * 어디에도 안 적혀 있어서 의도인지 결함인지 다음 사람이 알 수 없었다.
     * 누가 `r` 을 반영하게 고치면 여기가 빨개지고, 그때 이 주석을 지우면 된다.
     */
    it("구는 반지름을 그림 크기에 반영하지 않는다 (알려진 상태)", async () => {
      const sizes: number[] = [];
      for (const rr of [1, 3, 20]) {
        const r = await renderFigureSpec({
          version: "elem-1",
          kind: "sphere",
          r: rr,
        });
        expect(r.ok, `r=${rr}`).toBe(true);
        if (!r.ok) return;
        sizes.push(
          Number(
            r.svg.match(/<circle cx="[\d.]+" cy="[\d.]+" r="([\d.]+)"/)![1],
          ),
        );
      }
      expect(new Set(sizes).size, "r 이 달라도 원 크기는 같다").toBe(1);
    });

    it("어느 kind 든 cm 라벨은 halo 치수 글자다 — 날 텍스트가 없다", async () => {
      const bare: string[] = [];
      for (const spec of [
        ...WITH_DIMS,
        { version: "elem-1", kind: "sphere", r: 3 },
        { version: "elem-1", kind: "cone", r: 4, h: 3 },
        {
          version: "elem-1",
          kind: "areaPoly",
          shape: "rhombus",
          base: 8,
          height: 4,
          d2: 4,
        },
        { version: "elem-1", kind: "prism", sides: 5, h: 3 },
        { version: "elem-1", kind: "pyramid", sides: 5, h: 3 },
        {
          version: "elem-1",
          kind: "netCylinder",
          r: 2,
          h: 5,
          pi: 3,
          layout: "opp",
        },
        {
          version: "elem-1",
          kind: "stackCubes",
          voxels: [[0, 0, 0]],
          views: ["iso"],
        },
      ]) {
        const r = await renderFigureSpec(spec);
        expect(r.ok, String(spec.kind)).toBe(true);
        if (!r.ok) return;
        for (const m of r.svg.matchAll(
          /<text\b([^>]*)>([^<]*\d\s*cm[^<]*)<\/text>/g,
        )) {
          if (!m[1]!.includes('paint-order="stroke"')) {
            bare.push(`${spec.kind}: ${m[2]}`);
          }
        }
      }
      expect(bare, "날 텍스트 치수").toEqual([]);
    });

    it("치수를 적기로 한 kind 는 실제로 적는다 — 검사가 빈 껍데기가 아니다", async () => {
      const bare: string[] = [];
      for (const spec of WITH_DIMS) {
        const r = await renderFigureSpec(spec);
        expect(r.ok, `${spec.kind}/${spec.shape ?? ""}`).toBe(true);
        if (!r.ok) return;
        const labels = [
          ...r.svg.matchAll(/<text\b([^>]*)>([^<]*cm[^<]*)<\/text>/g),
        ];
        expect(
          labels.length,
          `${spec.kind}/${spec.shape ?? ""} cm 라벨`,
        ).toBeGreaterThan(0);
        for (const m of labels) {
          if (!m[1]!.includes('paint-order="stroke"')) {
            bare.push(`${spec.kind}/${spec.shape ?? ""}: ${m[2]}`);
          }
        }
        const curves = (r.svg.match(/stroke-dasharray="6 4"/g) ?? []).length;
        expect(
          curves,
          `${spec.kind}/${spec.shape ?? ""} 치수 점선`,
        ).toBeGreaterThanOrEqual(labels.length);
      }
      expect(bare).toEqual([]);
    });
  },
);

describe.skipIf(!hasEngine)(
  "[초등 그림] 그린 것은 viewBox 안에 있다 (원장님 2026-08-22 ⑫)",
  () => {
    const ALL = [
      { version: "elem-1", kind: "prism", sides: 3, h: 3, net: true },
      { version: "elem-1", kind: "prism", sides: 5, h: 3, net: true },
      { version: "elem-1", kind: "prism", sides: 6, h: 3, net: true },
      { version: "elem-1", kind: "prism", sides: 8, h: 3, net: true },
      { version: "elem-1", kind: "prism", sides: 5, h: 3 },
      { version: "elem-1", kind: "pyramid", sides: 6, h: 3 },
      { version: "elem-1", kind: "cuboid", w: 8, d: 2, h: 4 },
      { version: "elem-1", kind: "cylinder", r: 2, h: 3 },
      { version: "elem-1", kind: "cone", r: 4, h: 3 },
      { version: "elem-1", kind: "netCuboid", w: 7, d: 4, h: 5 },
      {
        version: "elem-1",
        kind: "netCylinder",
        r: 2,
        h: 5,
        pi: 3,
        layout: "opp",
      },
      {
        version: "elem-1",
        kind: "areaPoly",
        shape: "rhombus",
        base: 8,
        height: 4,
        d2: 4,
      },
      { version: "elem-1", kind: "fracPie", n: 8, filled: 3 },
      {
        version: "elem-1",
        kind: "pieChart",
        slices: [
          { label: "가", pct: 60 },
          { label: "나", pct: 40 },
        ],
      },
      { version: "elem-1", kind: "protractor", deg: 55 },
      { version: "elem-1", kind: "trapFour", filled: [0, 2] },
    ];

    it("각 전개도·겨냥도의 모든 점이 viewBox 안이다", async () => {
      const out: string[] = [];
      for (const spec of ALL) {
        const r = await renderFigureSpec(spec);
        expect(r.ok, `${spec.kind}`).toBe(true);
        if (!r.ok) return;
        const vb = r.svg.match(/viewBox="0 0 ([0-9.]+) ([0-9.]+)"/);
        expect(vb, `${spec.kind} viewBox`).toBeTruthy();
        const w = Number(vb![1]);
        const h = Number(vb![2]);
        for (const [x, y] of drawnPoints(r.svg)) {
          if (x < -0.01 || y < -0.01 || x > w + 0.01 || y > h + 0.01) {
            out.push(
              `${spec.kind}${spec.sides ?? ""}${spec.net ? "-전개도" : ""}: (${x}, ${y}) ∉ ${w}×${h}`,
            );
          }
        }
      }
      expect(out).toEqual([]);
    });

    it("표는 그래도 viewBox 240 을 넘지 않는다 — 맞춤이 이 불변식을 깨면 안 된다", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "table",
        headers: ["×", "3", "4", "5", "6", "7", "8"],
        rows: [["4", "12", "16", "20", "24", "28", "32"]],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(
        Number(r.svg.match(/viewBox="0 0 ([0-9.]+)/)![1]),
      ).toBeLessThanOrEqual(240);
    });
  },
);

describe.skipIf(!hasEngine)(
  "[초등 그림] 묻는 것을 그림이 답하지 않는다 (원장님 2026-08-22 ⑤)",
  () => {
    it("정삼각형 등변 tick 은 기본으로 그리지 않는다", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape: "eqTri", label: "가" }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.svg.match(/<line /g) ?? []).toHaveLength(0);
    });

    it("marks 를 켜면 등변 tick 셋이 나온다", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape: "eqTri", label: "가", marks: true }],
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(r.svg.match(/<line /g) ?? []).toHaveLength(3);
    });

    it("직각 기호도 같은 옵션으로 켜고 끈다", async () => {
      const off = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape: "rightTri", label: "가" }],
      });
      const on = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape: "rightTri", label: "가", marks: true }],
      });
      expect(off.ok && on.ok).toBe(true);
      if (!off.ok || !on.ok) return;
      expect(off.svg.match(/<polyline /g) ?? []).toHaveLength(0);
      expect(on.svg.match(/<polyline /g) ?? []).toHaveLength(1);
    });

    /**
     * 등변 tick 을 옵트인으로 돌리자 **세 세션이 같은 자리에서 막혔다** — g3 은 `rightTri` 를
     * 피해 점격자를 쓰고, g4 는 「가·나를 눈으로 가를 수 있나」를 물었고, g5 는 합동 풀에서
     * `eqTri` 를 뺐다(실측 3.93px). 표시가 사라지면 **도형 자체가 갈라야** 한다.
     *
     * 「이 중에서 고르시오」가 성립하려면 서로 다른 kind 의 윤곽이 눈에 띄게 달라야 한다.
     * 실측 바닥은 `para↔rect` 7.92px 이고 결함이던 `eqTri↔isoTri` 는 3.93px 이었다 —
     * 두 무리 사이가 훤히 비어 있어 6px 문턱은 그 틈에 놓인다.
     */
    it("서로 다른 도형은 표시 없이도 윤곽으로 갈린다", async () => {
      const kinds = [
        "square",
        "rect",
        "rightTri",
        "isoTri",
        "wideTri",
        "eqTri",
        "diamond",
        "tallDiamond",
        "trap",
        "para",
        "irregQuad",
      ];
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: kinds.map((shape) => ({ shape })),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const outlines = shapeOutlines(r.svg);
      expect(outlines, "도형 하나에 윤곽 하나").toHaveLength(kinds.length);
      const close: string[] = [];
      let floor = Infinity;
      for (let i = 0; i < kinds.length; i++) {
        for (let j = i + 1; j < kinds.length; j++) {
          const d = hausdorff(outlines[i]!, outlines[j]!);
          floor = Math.min(floor, d);
          if (d < 6) close.push(`${kinds[i]} ↔ ${kinds[j]} ${d.toFixed(2)}px`);
        }
      }
      // 음성 대조군 겸 자가 검사 — 재는 자가 죽어 있으면 「0건」이 아무것도 증명하지
      // 않는다. 실측 바닥은 `para↔rect` 7.92px(눈으로는 갈리는 짝)이라 6~10px 사이여야
      // 「문턱이 멀쩡한 짝을 안 죽이면서 실제 px 를 읽고 있다」가 같이 잠긴다.
      expect(floor, "가장 닮은 짝을 재지 못했다").toBeGreaterThan(6);
      expect(floor, "재는 자가 실제 px 를 읽고 있지 않다").toBeLessThan(10);
      expect(close).toEqual([]);
    });

    /**
     * elem-g5 가 짚은 **두 번째 축**. 위 검사(하우스도르프)는 그려진 자세에서 재므로
     * 「멀리 떨어져 보이지만 **돌리면 포개지는**」 짝을 구조적으로 못 본다. 합동 문항
     * (초5 `2-3-1`)은 그 짝이 생기면 **정답이 둘**이 되는데 거리 가드는 초록이다.
     * 하나가 다른 하나를 갈음하지 못한다 — 「없는 축은 변이시킬 수 없다」 그 자리다.
     */
    it("돌리거나 뒤집어도 포개지는 두 도형은 없다", async () => {
      const kinds = [
        "square",
        "rect",
        "rightTri",
        "isoTri",
        "wideTri",
        "eqTri",
        "diamond",
        "tallDiamond",
        "trap",
        "para",
        "irregQuad",
      ];
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: kinds.map((shape) => ({ shape })),
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      const sigs = shapeCorners(r.svg).map(rigidSignature);
      expect(sigs).toHaveLength(kinds.length);

      // 음성 대조군 — `eqTri`(44·44·44)와 `square`(44·44·44·44)는 **변 길이 값이 같다.**
      // 변만 보면 같아 보이므로, 이 둘이 안 걸려야 「꼭짓점 수까지 본다」가 잠긴다.
      const tri = sigs[kinds.indexOf("eqTri")]!;
      const sq = sigs[kinds.indexOf("square")]!;
      expect(tri.sides[0]).toBeCloseTo(sq.sides[0]!, 1);
      expect(rigidlySame(tri, sq), "변 길이만 보고 같다고 하면 안 된다").toBe(
        false,
      );

      const same: string[] = [];
      for (let i = 0; i < kinds.length; i++) {
        for (let j = i + 1; j < kinds.length; j++) {
          if (rigidlySame(sigs[i]!, sigs[j]!))
            same.push(`${kinds[i]} ↔ ${kinds[j]}`);
        }
      }
      expect(same).toEqual([]);
    });

    it("도형 항목의 오타 키는 조용히 무시되지 않는다", async () => {
      const r = await renderFigureSpec({
        version: "elem-1",
        kind: "namedShapes",
        items: [{ shape: "eqTri", label: "가", mark: true }],
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/허용|키/);
    });
  },
);

/* ── 그래프 세로축 ───────────────────────────────────────────────────────────
 * 「눈금이 231줄」과 「제일 높은 점이 맨 위 눈금선 위로 떴다」는 **한 뿌리**다 —
 * `yMax` 는 TS 가 정하고 걸음은 파이썬이 정하는데, 서로 상대가 무엇을 할지 모른다.
 * 아래 검사는 전부 **그려진 SVG 의 눈금 글자와 도형 좌표**만 본다. 파이썬 상수를
 * 읽지 않는다 — 참이 제품에서 오면 제품이 틀릴수록 좋은 점수가 나온다.
 * (09 §4-23)
 */
const NICE_STEPS = [
  1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000,
];
const TICK_CAP = 9;

/** 세로 눈금 글자 — 14pt·오른쪽 정렬. 단위(13pt)·막대 숫자(16pt·가운데)와 갈린다. */
function yTicks(svg: string): { v: number; y: number }[] {
  return [
    ...svg.matchAll(
      /<text x="[0-9.]+" y="([0-9.]+)"[^>]*font-size="14"[^>]*text-anchor="end"[^>]*>(-?[0-9.]+)<\/text>/g,
    ),
  ]
    .map((m) => ({ v: Number(m[2]), y: Number(m[1]) }))
    .sort((a, b) => a.v - b.v);
}

/** 그려진 데이터의 «맨 위» — 막대는 rect 의 윗변, 꺾은선은 점의 중심. */
function dataTopY(svg: string): number {
  const rects = [...svg.matchAll(/<rect x="[0-9.]+" y="([0-9.]+)"/g)].map((m) =>
    Number(m[1]),
  );
  const dots = [
    ...svg.matchAll(/<circle cx="[0-9.]+" cy="([0-9.]+)" r="2.4"/g),
  ].map((m) => Number(m[1]));
  return Math.min(...[...rects, ...dots]);
}

/**
 * 그려진 마크의 y — 막대는 rect 윗변, 꺾은선은 점 중심. **스펙에 준 순서 그대로**다.
 * `dataTopY` 와 달리 «제일 위» 하나가 아니라 전부 돌려준다.
 */
function markYs(svg: string): number[] {
  const rects = [...svg.matchAll(/<rect x="[0-9.]+" y="([0-9.]+)"/g)].map((m) =>
    Number(m[1]),
  );
  const dots = [
    ...svg.matchAll(/<circle cx="[0-9.]+" cy="([0-9.]+)" r="2.4"/g),
  ].map((m) => Number(m[1]));
  return rects.length ? rects : dots;
}

/**
 * **눈금이 말하는 자리**에 그 값이 있는가 — 눈금 둘로 선형보간해 y 를 구한다.
 *
 * ⚠️ 이것이 「데이터가 맨 위 눈금선보다 아래인가」를 **대신**한다. 그 검사로는
 * 「눈금은 새 축, 막대는 옛 `yMax`」인 배선을 **못 잡는다** — 축을 올리면 맨 위
 * 눈금 아래로 여유가 생기고, 그 여유 안에서는 틀린 자로 그려도 여전히 «아래»다.
 * 실측(변이 ㉕, `yMax 19` · 값 16): 막대 윗변 54.63 · 맨 위 눈금 36 → 옛 검사 통과.
 * 그런데 눈금이 말하는 자리는 59.60 이라 **5.0px 어긋나 있었다**(막대가 16이 아니라
 * 16.8쯤을 가리킨다). 변이 시험이 이 문장을 반증해서 알았다 (09 §4-23).
 */
function scaleMismatch(svg: string, values: number[]): number {
  const ticks = yTicks(svg);
  const [lo, hi] = [ticks[0]!, ticks[ticks.length - 1]!];
  const marks = markYs(svg);
  let worst = 0;
  for (const [i, v] of values.entries()) {
    const want = lo.y + ((v - lo.v) * (hi.y - lo.y)) / (hi.v - lo.v);
    worst = Math.max(worst, Math.abs(want - marks[i]!));
  }
  return worst;
}

/**
 * 가로형의 값 눈금 — 아래로 누웠으므로 **가운데 정렬**이고 x 를 읽는다.
 * 제목도 14pt·가운데라 **숫자인 것만** 고른다(제목은 숫자가 아니다).
 */
function xTicks(svg: string): { v: number; x: number }[] {
  return [
    ...svg.matchAll(
      /<text x="([0-9.]+)" y="[0-9.]+"[^>]*font-size="14"[^>]*text-anchor="middle"[^>]*>(-?[0-9.]+)<\/text>/g,
    ),
  ]
    .map((m) => ({ v: Number(m[2]), x: Number(m[1]) }))
    .sort((a, b) => a.v - b.v);
}

/** 가로 막대의 오른쪽 끝 x — 스펙에 준 순서 그대로. */
function barRightXs(svg: string): number[] {
  return [
    ...svg.matchAll(/<rect x="([0-9.]+)" y="[0-9.]+" width="([0-9.]+)"/g),
  ].map((m) => Number(m[1]) + Number(m[2]));
}

/**
 * 가로형 픽셀 결합 — 막대 끝이 **눈금이 말하는 x** 에 있는가.
 * 세로형 `scaleMismatch` 와 같은 질문이고 축만 눕는다.
 */
function scaleMismatchX(svg: string, values: number[]): number {
  const ticks = xTicks(svg);
  const [lo, hi] = [ticks[0]!, ticks[ticks.length - 1]!];
  const ends = barRightXs(svg);
  let worst = 0;
  for (const [i, v] of values.entries()) {
    const want = lo.x + ((v - lo.v) * (hi.x - lo.x)) / (hi.v - lo.v);
    worst = Math.max(worst, Math.abs(want - ends[i]!));
  }
  return worst;
}

/** 눈금 간격 — 고르지 않으면 그 자체가 결함이라 «서로 다른 간격»을 다 돌려준다. */
function tickGaps(svg: string): number[] {
  const vs = yTicks(svg).map((t) => t.v);
  return [...new Set(vs.slice(1).map((v, i) => v - vs[i]!))];
}

function chartSpec(
  kind: "barChart" | "lineChart",
  yMax: number,
  values: number[],
  yStep?: number,
) {
  return {
    version: "elem-1",
    kind,
    values: values.map((v, i) => ({ label: `${i + 1}월`, value: v })),
    yMax,
    ...(yStep === undefined ? {} : { yStep }),
    yLabel: "명",
  };
}

/** 「지금 잘 나오는 장」의 눈금 — 고치기 **전에** 실제로 그려 본 값을 그대로 못 박는다. */
const KEEP_AS_IS: [number, number[], number[]][] = [
  [8, [3, 7, 5, 6], [0, 1, 2, 3, 4, 5, 6, 7, 8]],
  [11, [4, 10, 7, 9], [0, 2, 4, 6, 8, 10]],
  [12, [5, 12, 8, 9], [0, 2, 4, 6, 8, 10, 12]],
  [15, [9, 12, 10, 11], [0, 5, 10, 15]],
  [37, [30, 34, 31, 33], [0, 5, 10, 15, 20, 25, 30, 35]],
  [41, [33, 38, 35, 36], [0, 5, 10, 15, 20, 25, 30, 35, 40]],
  [43, [34, 40, 37, 38], [0, 5, 10, 15, 20, 25, 30, 35, 40]],
];

describe.skipIf(!hasEngine)(
  "[초등 그림] 그래프 세로축 (원장님 2026-08-22)",
  () => {
    it.each(KEEP_AS_IS)(
      "yMax %i — 지금 맞게 나오는 장은 눈금이 한 줄도 안 바뀐다",
      async (yMax, values, ticks) => {
        for (const kind of ["barChart", "lineChart"] as const) {
          const r = await renderFigureSpec(chartSpec(kind, yMax, values));
          expect(r.ok).toBe(true);
          if (!r.ok) return;
          expect(yTicks(r.svg).map((t) => t.v)).toEqual(ticks);
        }
      },
    );

    // 사다리를 못 올라가면 `yMax` 가 커질수록 눈금이 무한정 늘어난다 —
    // 실측으로 「박물관 관람객」 소재에서 231줄이 나왔다.
    it.each([45, 60, 63, 150, 400, 1153, 1600, 9999])(
      "yMax %i — 눈금은 아홉 줄을 넘지 않는다",
      async (yMax) => {
        const r = await renderFigureSpec(
          chartSpec("lineChart", yMax, [
            Math.round(yMax * 0.4),
            yMax - 3,
            Math.round(yMax * 0.6),
          ]),
        );
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ticks = yTicks(r.svg);
        expect(ticks.length).toBeGreaterThanOrEqual(2);
        expect(ticks.length).toBeLessThanOrEqual(TICK_CAP);
      },
    );

    it("눈금 한 칸은 1·2·5 를 열 배씩 한 것뿐이다 — 3칸·7칸은 암산이 안 된다", async () => {
      for (const yMax of [8, 12, 19, 41, 45, 63, 150, 400, 1153, 9999]) {
        const r = await renderFigureSpec(
          chartSpec("lineChart", yMax, [1, yMax - 3, 2]),
        );
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const vs = yTicks(r.svg).map((t) => t.v);
        const gaps = new Set(vs.slice(1).map((v, i) => v - vs[i]!));
        expect([...gaps]).toHaveLength(1);
        expect(NICE_STEPS).toContain([...gaps][0]);
      }
    });

    // ⚠️ 이것이 이 묶음의 핵심이다. 「몇 줄인가」만 재면 **눈금이 데이터보다 낮은 장**은
    //    구조적으로 안 보인다 — 실측 2,400장 중 214장이 그랬고, 하필 그 점이
    //    「가장 많은 때는 언제인가」의 답이다.
    it.each([
      [13, [12, 5, 9]],
      [19, [16, 7, 12]],
      [24, [21, 9, 15]],
      [39, [36, 20, 28]],
      [44, [44, 20, 30]],
      [49, [46, 21, 33]],
      [59, [56, 25, 40]],
    ])("yMax %i — 제일 높은 값 위에 눈금선이 있다", async (yMax, values) => {
      for (const kind of ["barChart", "lineChart"] as const) {
        const r = await renderFigureSpec(
          chartSpec(kind, yMax, values as number[]),
        );
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        const ticks = yTicks(r.svg);
        const top = ticks[ticks.length - 1]!;
        // ⑴ 값으로 — 맨 위 눈금 값이 데이터 최댓값 이상
        expect(top.v).toBeGreaterThanOrEqual(Math.max(...(values as number[])));
        // ⑵ 픽셀로 — 그려진 것 중 제일 위가 맨 위 눈금선보다 아래(y 가 큼)
        expect(dataTopY(r.svg)).toBeGreaterThanOrEqual(top.y - 0.5);
        // ⑶ **눈금이 말하는 자리에 있는가.** ⑴·⑵ 로는 「눈금은 새 축, 막대는 옛 yMax」
        //    배선을 못 잡는다 — 축을 올리면 생기는 여유 안에 숨는다(변이 ㉕·㉖).
        expect(scaleMismatch(r.svg, values as number[])).toBeLessThan(0.5);
      }
    });

    // 이 셋은 **축이 올라가는** 장이다 — 여유가 커서 ⑵ 가 가장 무력해지는 자리다.
    it.each([
      ["barChart", 19, [16, 7, 12]],
      ["lineChart", 49, [46, 21, 33]],
      ["barChart", 44, [44, 20, 30]],
      ["lineChart", 1153, [1150, 400, 880]],
    ] as ["barChart" | "lineChart", number, number[]][])(
      "%s yMax %i — 막대·점은 **눈금이 말하는 자리**에 그려진다 (눈금과 같은 자)",
      async (kind, yMax, values) => {
        const r = await renderFigureSpec(chartSpec(kind, yMax, values));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(markYs(r.svg)).toHaveLength(values.length);
        expect(scaleMismatch(r.svg, values)).toBeLessThan(0.5);
      },
    );

    /* ── yStep — 「눈금 한 칸은 몇」 (D-70) ───────────────────────────────────
     * 발문이 걸음을 말하는 유형이라, 파이썬이 걸음을 **다시 고르면 발문이 그림과 다른
     * 말을 한다.** D-67 이 이 유형을 통째로 뺐던 이유가 그것이었다.
     *
     * ⚠️ 여기 쓰는 `yStep 3` 은 **사다리(1·2·5×10ⁿ)에 없는 수**다. 기본값 계산은
     * 3을 절대 못 고르므로, 간격이 3으로 나오면 **스펙 값이 실제로 쓰였다는 증거**가
     * 된다 — 「우연히 같은 값」으로는 통과할 수 없다.
     */
    it.each([
      ["barChart", 15, [14, 6, 9], 3, 3],
      ["lineChart", 15, [14, 6, 9], 3, 3],
      ["barChart", 41, [38, 20, 30], 5, 5],
      ["lineChart", 63, [60, 30, 40], 10, 10],
      // 축이 올라가는 자리 — 걸음은 그대로 두고 **눈금 수만** 는다 (19 → 20)
      ["barChart", 19, [16, 7, 12], 5, 5],
      ["lineChart", 49, [46, 21, 33], 10, 10],
    ] as ["barChart" | "lineChart", number, number[], number, number][])(
      "%s yMax %i yStep %i — 스펙이 실어 온 걸음 그대로 긋는다",
      async (kind, yMax, values, yStep, want) => {
        const r = await renderFigureSpec(chartSpec(kind, yMax, values, yStep));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(tickGaps(r.svg)).toEqual([want]);
        // 걸음만 맞고 데이터가 딴 자로 그려지면 발문은 여전히 거짓말이 된다.
        expect(scaleMismatch(r.svg, values)).toBeLessThan(0.5);
        const ticks = yTicks(r.svg);
        expect(ticks[ticks.length - 1]!.v).toBeGreaterThanOrEqual(
          Math.max(...values),
        );
        expect(ticks.length).toBeLessThanOrEqual(TICK_CAP);
      },
    );

    it("yStep 은 기본값을 **이긴다** — 같은 스펙에서 뺐다 넣으면 간격이 달라진다", async () => {
      const off = await renderFigureSpec(chartSpec("barChart", 15, [14, 6, 9]));
      const on = await renderFigureSpec(
        chartSpec("barChart", 15, [14, 6, 9], 3),
      );
      expect(off.ok && on.ok).toBe(true);
      if (!off.ok || !on.ok) return;
      expect(tickGaps(off.svg)).toEqual([5]); // 기본값(사다리)
      expect(tickGaps(on.svg)).toEqual([3]); // 스펙 값
    });

    it("yStep 을 안 주면 지금 지면이 **한 픽셀도 안 바뀐다**", async () => {
      // 전수(2,400장)는 `scripts/qa/measure-elem-charts.py` 가 본다. 여기서는
      // 「yStep 필드를 넣은 것만으로 없던 장이 달라지지 않는가」를 못 박는다.
      for (const [yMax, values, ticks] of KEEP_AS_IS) {
        const r = await renderFigureSpec(chartSpec("barChart", yMax, values));
        expect(r.ok).toBe(true);
        if (!r.ok) return;
        expect(yTicks(r.svg).map((t) => t.v)).toEqual(ticks);
      }
    });

    // 조용히 다른 걸음으로 그리면 「한 칸 5명」 발문 옆에 10명 간격이 나간다 —
    // 에러도 안 나고 학생만 틀린다. **방어는 침묵이 아니라 던짐이다.**
    it.each([
      [41, [38, 20, 30], 1, /눈금이 .*줄/],
      [19, [16, 7, 12], 2, /눈금이 .*줄/],
      [8, [7, 3, 5], 100, /yMax/],
    ] as [number, number[], number, RegExp][])(
      "yMax %i 에 yStep %i — 그 걸음으로 못 그리면 **던진다**",
      async (yMax, values, yStep, why) => {
        const r = await renderFigureSpec(
          chartSpec("barChart", yMax, values, yStep),
        );
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(why);
      },
    );

    it.each([
      ["소문자 오타", { ystep: 1 }, /허용|키/],
      ["0", { yStep: 0 }, /1 이상/],
      ["정수 아님", { yStep: 2.5 }, /정수/],
    ] as [string, Record<string, number>, RegExp][])(
      "yStep %s 은 조용히 무시되지 않는다",
      async (_why, extra, want) => {
        const r = await renderFigureSpec({
          ...chartSpec("barChart", 8, [7, 3, 5]),
          ...extra,
        });
        expect(r.ok).toBe(false);
        if (r.ok) return;
        expect(r.error).toMatch(want);
      },
    );

    /* ── 가로 막대 (orient) ──────────────────────────────────────────────────
     * 값 축이 아래로 눕을 뿐, **축 규칙은 한 벌**이다. 방향마다 규칙이 갈리면
     * 한쪽만 고쳐진다(2026-08-18). 그래서 눈금 «값»은 두 방향이 같아야 한다.
     */
    const ICE = [30, 40, 20, 35];

    it("가로형은 값 축이 아래로 눕는다 — 막대 끝이 **눈금이 말하는 x** 에 있다", async () => {
      const r = await renderFigureSpec({
        ...chartSpec("barChart", 45, ICE, 20),
        orient: "horizontal",
      });
      expect(r.ok).toBe(true);
      if (!r.ok) return;
      expect(xTicks(r.svg).map((t) => t.v)).toEqual([0, 20, 40]);
      expect(barRightXs(r.svg)).toHaveLength(ICE.length);
      // 세로 눈금(오른쪽 정렬 14pt)은 하나도 없어야 한다 — 축이 누웠으므로.
      expect(yTicks(r.svg)).toHaveLength(0);
      expect(scaleMismatchX(r.svg, ICE)).toBeLessThan(0.5);
    });

    it("축 규칙은 **방향과 무관하게 한 벌**이다 — 눈금 값이 두 방향에서 같다", async () => {
      for (const [yMax, values, yStep] of [
        [45, ICE, 20],
        [41, [38, 20, 30], 5],
        [19, [16, 7, 12], undefined],
        [1153, [1150, 400, 880], undefined],
      ] as [number, number[], number | undefined][]) {
        const v = await renderFigureSpec(
          chartSpec("barChart", yMax, values, yStep),
        );
        const h = await renderFigureSpec({
          ...chartSpec("barChart", yMax, values, yStep),
          orient: "horizontal",
        });
        expect(v.ok && h.ok).toBe(true);
        if (!v.ok || !h.ok) return;
        expect(xTicks(h.svg).map((t) => t.v)).toEqual(
          yTicks(v.svg).map((t) => t.v),
        );
      }
    });

    it("가로형도 못 그리는 yStep 은 던진다 — 방향이 규칙을 비켜 가지 않는다", async () => {
      const r = await renderFigureSpec({
        ...chartSpec("barChart", 41, [38, 20, 30], 1),
        orient: "horizontal",
      });
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.error).toMatch(/눈금이 .*줄/);
    });

    it("orient 를 안 주면 세로형이고, 모르는 값은 조용히 무시되지 않는다", async () => {
      const plain = await renderFigureSpec(chartSpec("barChart", 45, ICE, 20));
      const explicit = await renderFigureSpec({
        ...chartSpec("barChart", 45, ICE, 20),
        orient: "vertical",
      });
      expect(plain.ok && explicit.ok).toBe(true);
      if (!plain.ok || !explicit.ok) return;
      expect(explicit.svg).toBe(plain.svg); // 기본값을 적어 내도 지면이 같다
      const bad = await renderFigureSpec({
        ...chartSpec("barChart", 45, ICE, 20),
        orient: "가로",
      });
      expect(bad.ok).toBe(false);
      if (bad.ok) return;
      expect(bad.error).toMatch(/orient/);
    });

    // 제목과 단위 라벨이 같은 줄에 앉으면 긴 제목에서 겹친다 — 실측으로 둘 사이가
    // 30px 뿐이었다. 제목이 **없을 때는** 지면이 한 픽셀도 안 바뀌어야 한다.
    it("제목은 단위 라벨과 **다른 줄**에 앉고, 없으면 지면이 안 바뀐다", async () => {
      const TITLE = "아이스크림 한 개의 가격은 얼마인가";
      const none = await renderFigureSpec(chartSpec("barChart", 45, ICE, 20));
      const titled = await renderFigureSpec({
        ...chartSpec("barChart", 45, ICE, 20),
        title: TITLE,
      });
      expect(none.ok && titled.ok).toBe(true);
      if (!none.ok || !titled.ok) return;

      expect(none.svg).not.toContain(TITLE);
      // 제목 없는 장은 KEEP_AS_IS 와 같은 눈금 — 제목 필드를 더한 것만으로 안 바뀐다.
      expect(yTicks(none.svg).map((t) => t.v)).toEqual([0, 20, 40]);

      const titleY = Number(
        titled.svg.match(
          new RegExp(`<text x="[0-9.]+" y="([0-9.]+)"[^>]*>${TITLE}<`),
        )![1],
      );
      // 단위 라벨 — 13pt·오른쪽 정렬
      const unitY = Number(
        titled.svg.match(
          /<text x="[0-9.]+" y="([0-9.]+)"[^>]*font-size="13"[^>]*text-anchor="end"/,
        )![1],
      );
      expect(Math.abs(titleY - unitY)).toBeGreaterThanOrEqual(14);
    });

    it("막대와 꺾은선은 **같은 자**를 쓴다 — 한쪽만 배선하면 그쪽 지표만 좋아진다", async () => {
      for (const [yMax, values] of [
        [19, [16, 7, 12]],
        [49, [46, 21, 33]],
        [1153, [1150, 400, 800]],
      ] as [number, number[]][]) {
        const bar = await renderFigureSpec(chartSpec("barChart", yMax, values));
        const line = await renderFigureSpec(
          chartSpec("lineChart", yMax, values),
        );
        expect(bar.ok && line.ok).toBe(true);
        if (!bar.ok || !line.ok) return;
        expect(yTicks(bar.svg).map((t) => t.v)).toEqual(
          yTicks(line.svg).map((t) => t.v),
        );
      }
    });
  },
);

describe("[초등 그림] 무작위 20 스펙 계약", () => {
  it("이름 붙은 도형·분수 사다리꼴·곱셈표는 초등 kind 다", () => {
    const byId = new Map(
      CUBE_RANDOM_20.map((it) => [
        it.id,
        it.figureSpec as Record<string, unknown>,
      ]),
    );
    expect(byId.get("cube-concept-3-1-p049-q1")).toMatchObject({
      version: "elem-1",
      kind: "namedShapes",
    });
    expect(byId.get("cube-concept-3-1-p050-q07")).toMatchObject({
      version: "elem-1",
      kind: "namedShapes",
    });
    expect(byId.get("cube-concept-3-1-p145-q08")).toMatchObject({
      version: "elem-1",
      kind: "trapFour",
      filled: [0, 1, 3],
    });
    expect(byId.get("cube-concept-3-1-p069-q49")).toMatchObject({
      version: "elem-1",
      kind: "table",
    });
  });
});

type Pt = [number, number];

function parsePoints(raw: string): Pt[] {
  return [...raw.matchAll(/(-?[0-9.]+),(-?[0-9.]+)/g)].map(
    (m) => [Number(m[1]), Number(m[2])] as Pt,
  );
}

function svgPolygons(svg: string): Pt[][] {
  return [...svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) =>
    parsePoints(m[1]!),
  );
}

/** 칠 색으로 면을 고른다 — 점 개수로 고르면 옆면과 윗면이 뒤바뀐다. */
function polygonsByFill(svg: string, fill: string): Pt[][] {
  return [...svg.matchAll(/<polygon points="([^"]+)"[^>]*fill="([^"]+)"/g)]
    .filter((m) => m[2] === fill)
    .map((m) => parsePoints(m[1]!));
}

function samePoint(a: Pt, b: Pt) {
  return Math.abs(a[0] - b[0]) < 0.15 && Math.abs(a[1] - b[1]) < 0.15;
}

function uniquePoints(pts: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of pts) if (!out.some((q) => samePoint(p, q))) out.push(p);
  return out;
}

/** 폴리곤을 모두 그린 **뒤에** 오는 점선 `<line>` — 겨냥도의 숨은 모서리다. */
function dashedLinesAfterPolygons(svg: string): [Pt, Pt][] {
  const lastPoly = svg.lastIndexOf("<polygon");
  const out: [Pt, Pt][] = [];
  for (const m of svg.matchAll(
    /<line x1="(-?[0-9.]+)" y1="(-?[0-9.]+)" x2="(-?[0-9.]+)" y2="(-?[0-9.]+)"([^>]*)>/g,
  )) {
    if (!m[5]!.includes("stroke-dasharray")) continue;
    if (m.index! < lastPoly) continue;
    out.push([
      [Number(m[1]), Number(m[2])],
      [Number(m[3]), Number(m[4])],
    ]);
  }
  return out;
}

/**
 * 밑면 고리를 화면 좌·우 끝에서 갈라 **뒤쪽(위) 사슬의 변 수**를 센다.
 * 볼록 입체에서 숨은 모서리는 이 사슬이 정한다 — 제품의 법선 판정과 **다른 길**로
 * 같은 수에 닿아야 판정이 서로를 베끼지 않는다.
 */
function backChainEdgeCount(ring: Pt[]): number {
  const ordered = [...ring].sort(
    (a, b) =>
      Math.atan2(a[1] - mean(ring, 1), a[0] - mean(ring, 0)) -
      Math.atan2(b[1] - mean(ring, 1), b[0] - mean(ring, 0)),
  );
  const n = ordered.length;
  let iL = 0;
  let iR = 0;
  for (let i = 1; i < n; i++) {
    if (ordered[i]![0] < ordered[iL]![0]) iL = i;
    if (ordered[i]![0] > ordered[iR]![0]) iR = i;
  }
  const walk = (from: number, to: number) => {
    const out = [ordered[from]!];
    for (let i = from; i !== to;) {
      i = (i + 1) % n;
      out.push(ordered[i]!);
    }
    return out;
  };
  const a = walk(iL, iR);
  const b = walk(iR, iL);
  const meanY = (c: Pt[]) => c.reduce((s, p) => s + p[1], 0) / c.length;
  const back = meanY(a) < meanY(b) ? a : b;
  return back.length - 1;
}

function mean(pts: Pt[], axis: 0 | 1) {
  return pts.reduce((s, p) => s + p[axis], 0) / pts.length;
}

/**
 * `namedShapes` 가 그린 도형들의 윤곽을 **그린 순서대로**. 표시가 꺼져 있으면 항목마다
 * `<rect>` 또는 `<polygon>` 이 정확히 하나다. 무게중심을 맞추고 변을 따라 촘촘히 뿌린다 —
 * 꼭짓점만 보면 「변 하나가 통째로 다른」 짝을 못 본다.
 */
/** `namedShapes` 도형들의 **꼭짓점**을 그린 순서대로. */
function shapeCorners(svg: string): Pt[][] {
  const out: Pt[][] = [];
  for (const m of svg.matchAll(
    /<rect x="(-?[\d.]+)" y="(-?[\d.]+)" width="([\d.]+)" height="([\d.]+)"|<polygon points="([^"]+)"/g,
  )) {
    if (m[5] !== undefined) {
      out.push(parsePoints(m[5]));
    } else {
      const x = Number(m[1]);
      const y = Number(m[2]);
      const w = Number(m[3]);
      const h = Number(m[4]);
      out.push([
        [x, y],
        [x + w, y],
        [x + w, y + h],
        [x, y + h],
      ]);
    }
  }
  return out;
}

/**
 * **회전에 안 흔들리는 지문** — 꼭짓점 수 · 정렬한 변 길이 · 정렬한 내각.
 *
 * 하우스도르프는 «그려진 자세»에서 재므로 **돌리면 포개지는 두 도형을 구조적으로
 * 못 본다.** 합동 문항이 묻는 것은 「**포개었을 때** 겹치는가」이고 학생은 종이를
 * 돌리고 뒤집어도 된다 — 그런 짝이 생기면 정답이 둘이 되는데 거리 가드는 초록이다.
 * 실제로 `diamond` 는 이미 **45° 돌린 정사각형**이고, `square` 와 갈리는 이유는
 * 모양이 아니라 **크기뿐**이다(변 31.1 vs 44.0). 다른 축이라 서로를 갈음하지 못한다.
 */
function rigidSignature(corners: Pt[]) {
  const n = corners.length;
  const at = (i: number) => corners[((i % n) + n) % n]!;
  const sides = corners
    .map((_p, i) =>
      Math.hypot(at(i)[0] - at(i + 1)[0], at(i)[1] - at(i + 1)[1]),
    )
    .sort((a, b) => a - b);
  const angles = corners
    .map((_p, i) => {
      const [ax, ay] = at(i - 1);
      const [bx, by] = at(i);
      const [cx, cy] = at(i + 1);
      const u: Pt = [ax - bx, ay - by];
      const v: Pt = [cx - bx, cy - by];
      const cos =
        (u[0] * v[0] + u[1] * v[1]) / (Math.hypot(...u) * Math.hypot(...v));
      return (Math.acos(Math.max(-1, Math.min(1, cos))) * 180) / Math.PI;
    })
    .sort((a, b) => a - b);
  return { n, sides, angles };
}

function rigidlySame(
  a: ReturnType<typeof rigidSignature>,
  b: ReturnType<typeof rigidSignature>,
) {
  return (
    a.n === b.n &&
    a.sides.every((v, i) => Math.abs(v - b.sides[i]!) < 0.5) &&
    a.angles.every((v, i) => Math.abs(v - b.angles[i]!) < 1)
  );
}

function shapeOutlines(svg: string): Pt[][] {
  const out: Pt[][] = [];
  for (const corners of shapeCorners(svg)) {
    const dense: Pt[] = [];
    for (let i = 0; i < corners.length; i++) {
      const a = corners[i]!;
      const b = corners[(i + 1) % corners.length]!;
      for (let t = 0; t < 24; t++) {
        const u = t / 24;
        dense.push([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
      }
    }
    const cx = mean(dense, 0);
    const cy = mean(dense, 1);
    out.push(dense.map(([x, y]) => [x - cx, y - cy] as Pt));
  }
  return out;
}

function hausdorff(a: Pt[], b: Pt[]): number {
  const oneWay = (p: Pt[], q: Pt[]) =>
    Math.max(
      ...p.map(([x0, y0]) =>
        Math.min(...q.map(([x1, y1]) => Math.hypot(x0 - x1, y0 - y1))),
      ),
    );
  return Math.max(oneWay(a, b), oneWay(b, a));
}

function midPoint([a, b]: [Pt, Pt]): Pt {
  return [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
}

function convexHull(pts: Pt[]): Pt[] {
  const s = [...pts].sort((p, q) => p[0] - q[0] || p[1] - q[1]);
  const cross = (o: Pt, a: Pt, b: Pt) =>
    (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const half = (src: Pt[]) => {
    const out: Pt[] = [];
    for (const p of src) {
      while (
        out.length >= 2 &&
        cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0
      ) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(s), ...half(s.reverse())];
}

/** 실루엣(볼록 껍질) 안쪽인가 — 껍질 위에 놓이면 거짓. 숨은 모서리는 안쪽에만 있다. */
function insideHull(pts: Pt[], p: Pt, eps = 0.5): boolean {
  const hull = convexHull(pts);
  for (let i = 0; i < hull.length; i++) {
    const a = hull[i]!;
    const b = hull[(i + 1) % hull.length]!;
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]) || 1;
    const d =
      ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) / len;
    if (d <= eps) return false;
  }
  return true;
}

function ringEdges(ring: Pt[]): [Pt, Pt][] {
  const o = ringOrder(ring);
  return o.map((p, i) => [p, o[(i + 1) % o.length]!] as [Pt, Pt]);
}

function sameEdge(a: [Pt, Pt], b: [Pt, Pt]) {
  return (
    (samePoint(a[0], b[0]) && samePoint(a[1], b[1])) ||
    (samePoint(a[0], b[1]) && samePoint(a[1], b[0]))
  );
}

function ringOrder(ring: Pt[]): Pt[] {
  const cx = mean(ring, 0);
  const cy = mean(ring, 1);
  return [...ring].sort(
    (a, b) =>
      Math.atan2(a[1] - cy, a[0] - cx) - Math.atan2(b[1] - cy, b[0] - cx),
  );
}

/** 숨은 밑면 모서리는 고리에서 **끊기지 않은 한 토막**이어야 한다 — 볼록 입체이므로. */
function isContiguousChain(ring: Pt[], edges: [Pt, Pt][]): boolean {
  const ordered = ringOrder(ring);
  const n = ordered.length;
  const at = (p: Pt) => ordered.findIndex((q) => samePoint(p, q));
  const idx = new Set<number>();
  for (const [a, b] of edges) {
    const i = at(a);
    const j = at(b);
    if (i < 0 || j < 0) return false;
    if ((i + 1) % n === j) idx.add(i);
    else if ((j + 1) % n === i) idx.add(j);
    else return false;
  }
  if (idx.size !== edges.length) return false;
  const sorted = [...idx].sort((x, y) => x - y);
  return sorted.some((start) =>
    sorted.every((_v, k) => idx.has((start + k) % n)),
  );
}

/** 타원의 납작한 정도(짧은 지름 / 긴 지름). 축에 나란하면 그냥 높이/너비다. */
function ellipseFlatness(pts: Pt[]) {
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  return (
    (Math.max(...ys) - Math.min(...ys)) / (Math.max(...xs) - Math.min(...xs))
  );
}

/** 좌·우 끝점의 높이 차 — 축에 나란한 타원이면 0 이다(사방투영은 크게 벌어진다). */
function axisTilt(pts: Pt[]) {
  const left = pts.reduce((a, b) => (a[0] <= b[0] ? a : b));
  const right = pts.reduce((a, b) => (a[0] >= b[0] ? a : b));
  return Math.abs(left[1] - right[1]);
}

/** 그려진 점 — 폴리곤·선·상자·원·글자 닻점·경로의 끝점. 잘림 검사의 표본이다. */
function drawnPoints(svg: string): Pt[] {
  const out: Pt[] = [];
  for (const m of svg.matchAll(/<(?:polygon|polyline) points="([^"]+)"/g)) {
    out.push(...parsePoints(m[1]!));
  }
  for (const m of svg.matchAll(
    /<line x1="(-?[0-9.]+)" y1="(-?[0-9.]+)" x2="(-?[0-9.]+)" y2="(-?[0-9.]+)"/g,
  )) {
    out.push([Number(m[1]), Number(m[2])], [Number(m[3]), Number(m[4])]);
  }
  for (const m of svg.matchAll(
    /<rect x="(-?[0-9.]+)" y="(-?[0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g,
  )) {
    const x = Number(m[1]);
    const y = Number(m[2]);
    out.push([x, y], [x + Number(m[3]), y + Number(m[4])]);
  }
  for (const m of svg.matchAll(
    /<circle cx="(-?[0-9.]+)" cy="(-?[0-9.]+)" r="([0-9.]+)"/g,
  )) {
    const cx = Number(m[1]);
    const cy = Number(m[2]);
    const rr = Number(m[3]);
    out.push([cx - rr, cy - rr], [cx + rr, cy + rr]);
  }
  for (const m of svg.matchAll(/<text x="(-?[0-9.]+)" y="(-?[0-9.]+)"/g)) {
    out.push([Number(m[1]), Number(m[2])]);
  }
  for (const m of svg.matchAll(/ d="([^"]+)"/g)) {
    // 경로는 **끝점만** 본다. 제어점은 곡선이 닿지 않는 자리라 세면 헛되이 부푼다.
    const tokens = m[1]!.match(/[A-Za-z]|-?[0-9.]+/g) ?? [];
    let i = 0;
    let cmd = "";
    const argc: Record<string, number> = {
      M: 2,
      L: 2,
      T: 2,
      H: 1,
      V: 1,
      C: 6,
      S: 4,
      Q: 4,
      A: 7,
      Z: 0,
    };
    while (i < tokens.length) {
      const before = i;
      if (/[A-Za-z]/.test(tokens[i]!)) cmd = tokens[i++]!;
      const n = argc[cmd] ?? 0;
      const args = tokens.slice(i, i + n).map(Number);
      i += n;
      if (n >= 2) out.push([args[n - 2]!, args[n - 1]!]);
      if (cmd === "M") cmd = "L";
      if (i === before) break; // 모르는 토큰에서 멈춘다 — 무한 고리 방지
    }
  }
  return out;
}

function parseCylinderNet(svg: string) {
  const rects = svgRects(svg);
  const circles = [
    ...svg.matchAll(/<circle cx="([0-9.-]+)" cy="([0-9.-]+)" r="([0-9.]+)"/g),
  ].map((m) => ({ cx: Number(m[1]), cy: Number(m[2]), r: Number(m[3]) }));
  const rect = [...rects].sort((a, b) => b.w * b.h - a.w * a.h)[0] ?? null;
  return { rect, circles };
}

function attachLongSide(
  c: { cx: number; cy: number; r: number },
  rect: { x: number; y: number; w: number; h: number },
) {
  const tol = 1.2;
  const onLong = c.cx >= rect.x - tol && c.cx <= rect.x + rect.w + tol;
  if (onLong && Math.abs(c.cy + c.r - rect.y) < tol) return "top";
  if (onLong && Math.abs(c.cy - c.r - (rect.y + rect.h)) < tol) return "bot";
  return null;
}

function svgRects(svg: string) {
  return [
    ...svg.matchAll(
      /<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g,
    ),
  ].map((m) => {
    const x = Number(m[1]);
    const y = Number(m[2]);
    const w = Number(m[3]);
    const h = Number(m[4]);
    return { x, y, w, h, cx: x + w / 2 };
  });
}

function textPos(svg: string, label: string) {
  const esc = label.replace(/[+\-]/g, "\\$&");
  const m = svg.match(new RegExp(`x="([0-9.]+)" y="([0-9.]+)"[^>]*>${esc}<`));
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

function hexMean(hex: string) {
  const n = hex.replace("#", "");
  const r = Number.parseInt(n.slice(0, 2), 16);
  const g = Number.parseInt(n.slice(2, 4), 16);
  const b = Number.parseInt(n.slice(4, 6), 16);
  return (r + g + b) / 3;
}

function shoelace(pts: string) {
  const pairs = [...pts.matchAll(/([0-9.]+),([0-9.]+)/g)].map((m) => [
    Number(m[1]),
    Number(m[2]),
  ]);
  let area = 0;
  for (let i = 0; i < pairs.length; i++) {
    const [x1, y1] = pairs[i]!;
    const [x2, y2] = pairs[(i + 1) % pairs.length]!;
    area += x1 * y2 - x2 * y1;
  }
  return Math.abs(area) / 2;
}
