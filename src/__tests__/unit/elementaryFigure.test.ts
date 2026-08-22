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

    const ovals = [
      ...r.svg.matchAll(/<ellipse cx="([0-9.]+)"/g),
    ].map((m) => Number(m[1]));
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

describe.skipIf(!hasEngine)("[초등 그림] 큐브 표본 스펙은 전부 그려진다", () => {
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
});

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
    expect((r.svg.match(/stroke-dasharray="4 3"/g) ?? []).length).toBeGreaterThan(8);
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
    expect((r.svg.match(/stroke-dasharray="/g) ?? []).length).toBeGreaterThanOrEqual(
      3,
    );
  });

  it("원기둥 높이·반지름 치수는 서로 떨어지고 도형 한가운데에 앉지 않는다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "cylinder",
      r: 2,
      h: 3,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const pos = (label: string) => {
      const m = r.svg.match(new RegExp(`x="([0-9.-]+)" y="([0-9.-]+)"[^>]*>${label}<`));
      expect(m, label).toBeTruthy();
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const height = pos("3 cm");
    const radius = pos("2 cm");
    expect(Math.hypot(height.x - radius.x, height.y - radius.y)).toBeGreaterThan(28);
    const xs = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
      m[1].split(/\s+/).map((p) => Number(p.split(",")[0])),
    );
    const ys = [...r.svg.matchAll(/points="([^"]+)"/g)].flatMap((m) =>
      m[1].split(/\s+/).map((p) => Number(p.split(",")[1])),
    );
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    expect(height.x).toBeLessThan(midX - 8);
    expect(radius.x > midX || radius.y < midY - 8).toBe(true);
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
    const cells = [...r.svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].filter(
      (m) => Number(m[3]) === Number(m[4]) && Number(m[3]) >= 16,
    );
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
    const cells = [...r.svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].filter(
      (m) => Number(m[3]) === Number(m[4]) && Number(m[3]) >= 16,
    );
    expect(cells.length).toBeGreaterThan(0);
    const minCellY = Math.min(...cells.map((m) => Number(m[2])));
    expect(Number(title![1])).toBeLessThan(minCellY - 4);
    const nums = [...r.svg.matchAll(/x="([0-9.]+)" y="([0-9.]+)"[^>]*>(\d+)</g)];
    expect(nums.length).toBeGreaterThan(0);
    for (const n of nums) {
      const nx = Number(n[1]);
      const ny = Number(n[2]);
      const hit = cells.find((c) => {
        const x = Number(c[1]);
        const y = Number(c[2]);
        const s = Number(c[3]);
        return Math.abs(nx - (x + s / 2)) < 0.6 && Math.abs(ny - (y + s / 2)) < 0.6;
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
      const polys = [...r.svg.matchAll(/<polygon points="([^"]+)"/g)].map((m) =>
        m[1].trim().split(/\s+/).length,
      );
      expect(polys.some((n) => n === sides), `밑면 ${sides}각형`).toBe(true);
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
      expect(sides.every(Boolean), `${layout} 원이 긴 변에 접해야 함`).toBe(true);
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
      const m = r.svg.match(new RegExp(`x="([0-9.-]+)" y="([0-9.-]+)"[^>]*>${label}<`));
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

  it("마름모 대각선 길이는 교차점을 피하고 바깥 치수 곡선을 쓰지 않는다", async () => {
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
    const poly = r.svg.match(/<polygon points="([^"]+)"/);
    expect(poly).toBeTruthy();
    const pts = poly![1].split(/\s+/).map((p) => p.split(",").map(Number));
    const xs = pts.map((p) => p[0]!);
    const ys = pts.map((p) => p[1]!);
    const midX = (Math.min(...xs) + Math.max(...xs)) / 2;
    const midY = (Math.min(...ys) + Math.max(...ys)) / 2;
    const textAt = (label: string) => {
      const m = r.svg.match(new RegExp(`x="([0-9.-]+)" y="([0-9.-]+)"[^>]*>${label}<`));
      expect(m, label).toBeTruthy();
      return { x: Number(m![1]), y: Number(m![2]) };
    };
    const eight = textAt("8 cm");
    const four = textAt("4 cm");
    expect(Math.hypot(eight.x - midX, eight.y - midY)).toBeGreaterThan(10);
    expect(Math.hypot(four.x - midX, four.y - midY)).toBeGreaterThan(10);
    expect(Math.hypot(eight.x - four.x, eight.y - four.y)).toBeGreaterThan(16);
    expect(eight.y).toBeLessThan(Math.max(...ys) + 22);
    expect(four.x).toBeLessThan(Math.max(...xs) + 22);
    expect(r.svg).not.toMatch(/ Q /);
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

describe("[초등 그림] 무작위 20 스펙 계약", () => {
  it("이름 붙은 도형·분수 사다리꼴·곱셈표는 초등 kind 다", () => {
    const byId = new Map(
      CUBE_RANDOM_20.map((it) => [it.id, it.figureSpec as Record<string, unknown>]),
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
  return [...svg.matchAll(/<rect x="([0-9.]+)" y="([0-9.]+)" width="([0-9.]+)" height="([0-9.]+)"/g)].map(
    (m) => {
      const x = Number(m[1]);
      const y = Number(m[2]);
      const w = Number(m[3]);
      const h = Number(m[4]);
      return { x, y, w, h, cx: x + w / 2 };
    },
  );
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
