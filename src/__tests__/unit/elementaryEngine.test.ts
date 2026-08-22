/**
 * 초3-1~초6-2 소단원 전량 생성. 정답은 생성기가 같은 숫자로 계산한다.
 * 그림 스펙이 있으면 엔진이 실제로 SVG 를 낸다 — 모킹하지 않는다.
 */
import { existsSync } from "node:fs";
import path from "node:path";

import { describe, expect, it } from "vitest";

import { FRAC_FIG_MAX, fracSpec } from "@/lib/elementary/fracFig";
import {
  elementaryChapters,
  elementaryUnits,
  generateElementaryProblem,
  handlerKeys,
} from "@/lib/elementary/generate";
import { renderFigureSpec } from "@/lib/figure/renderFigureSpec";

const VENDOR = path.join(process.cwd(), "vendor", "figure-engine");
const LEGACY = "F:\\시험지변환기";
const hasEngine = existsSync(VENDOR) || existsSync(LEGACY);

const UNITS = elementaryUnits();

describe("[초등 엔진] 소단원 전량", () => {
  it("초3~초6 소단원이 230개다", () => {
    expect(UNITS).toHaveLength(230);
    expect(new Set(UNITS.map((u) => u.grade))).toEqual(
      new Set(["초3", "초4", "초5", "초6"]),
    );
  });

  it("대단원 48개마다 생성기가 있다", () => {
    const chapters = elementaryChapters();
    expect(chapters).toHaveLength(48);
    const keys = new Set(handlerKeys());
    const missing = chapters
      .map((c) => `${c.grade}|${c.chapter}`)
      .filter((k) => !keys.has(k));
    expect(missing).toEqual([]);
  });

  it("초3-1~초6-2 소단원 230개가 모두 문항을 낸다", () => {
    const failed: string[] = [];
    for (const unit of UNITS) {
      try {
        const item = generateElementaryProblem(unit, 20260821);
        if (item.section !== unit.section) failed.push(`${unit.section}: section`);
        if (item.content.trim().length < 8) failed.push(`${unit.section}: 발문`);
        if (!item.answer || item.answer.length < 1) failed.push(`${unit.section}: 정답`);
        if (!item.solution) failed.push(`${unit.section}: 해설`);
      } catch (err) {
        failed.push(`${unit.grade} ${unit.section}: ${String(err)}`);
      }
    }
    expect(failed).toEqual([]);
  });

  it("같은 씨앗이면 같은 정답이 나온다", () => {
    const unit = UNITS[0]!;
    const a = generateElementaryProblem(unit, 7);
    const b = generateElementaryProblem(unit, 7);
    expect(a.answer).toBe(b.answer);
    expect(a.content).toBe(b.content);
  });

  it("세 자리 덧셈 정답은 두 수의 합이다", () => {
    const unit = UNITS.find((u) => u.section.includes("받아올림이 없는"))!;
    const item = generateElementaryProblem(unit, 11);
    const hit = item.content.match(/\$(\d+)\+(\d+)=\\square\$/);
    expect(hit).toBeTruthy();
    expect(item.answer).toBe(String(Number(hit![1]) + Number(hit![2])));
  });

  it("직육면체 부피 정답은 가로×세로×높이이다", () => {
    const unit = UNITS.find((u) => u.section.includes("직육면체의 부피 비교"))!;
    const item = generateElementaryProblem(unit, 11);
    const hit = item.content.match(/가로 (\d+) cm, 세로 (\d+) cm, 높이 (\d+)/);
    expect(hit).toBeTruthy();
    expect(item.answer).toBe(
      String(Number(hit![1]) * Number(hit![2]) * Number(hit![3])),
    );
  });

  it("쌓기나무 정답은 voxel 개수이다", () => {
    const unit = UNITS.find((u) => u.section.includes("쌓은 모양과 쌓기나무의 개수 알아보기 (1)"))!;
    const item = generateElementaryProblem(unit, 11);
    const spec = item.figureSpec as { voxels: unknown[] };
    expect(spec.voxels.length).toBe(Number(item.answer));
  });

  it("막대그래프는 눈금과 막대 숫자가 있고 흰 외곽선으로 뭉개지 않는다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "barChart",
      values: [
        { label: "사과", value: 14 },
        { label: "배", value: 8 },
      ],
      yMax: 18,
      yLabel: "명",
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    expect(drawn.svg).toContain(">14<");
    expect(drawn.svg).toContain(">8<");
    expect(drawn.svg).toContain(">0<");
    expect(drawn.svg).toContain(">10<");
    expect(drawn.svg).toContain(">15<");
    expect(drawn.svg).not.toMatch(/stroke="#fff"/);
    expect(drawn.svg).not.toContain(">2<");
    expect(drawn.svg).not.toContain(">4<");
  });

  it("막대그래프 세로축 단위는 눈금 숫자와 겹치지 않는다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "barChart",
      values: [
        { label: "개", value: 15 },
        { label: "고양이", value: 4 },
      ],
      yMax: 20,
      yLabel: "마리",
    });
    expect(drawn.ok).toBe(true);
    if (!drawn.ok) return;
    const textY = (label: string) => {
      const m = drawn.svg.match(new RegExp(`y="([0-9.]+)"[^>]*>${label}<`));
      expect(m, `${label} 좌표`).toBeTruthy();
      return Number(m![1]);
    };
    expect(textY("마리")).toBeLessThan(textY("20") - 14);
  });

  it("막대그래프는 요일만 묻지 않는다", () => {
    const units = UNITS.filter((u) => u.chapter.includes("막대그래프"));
    const labels = units.map((unit) => {
      const spec = generateElementaryProblem(unit, 20260821).figureSpec as {
        values: { label: string }[];
      };
      return spec.values.map((v) => v.label).join(",");
    });
    expect(new Set(labels).size).toBeGreaterThan(1);
    expect(labels.some((row) => !row.startsWith("월,"))).toBe(true);
  });

  it("띠그래프·원그래프는 비율 구성이 여러 가지다", () => {
    const units = UNITS.filter((u) => u.chapter.includes("여러 가지 그래프"));
    expect(units.length).toBeGreaterThan(0);
    const keys = new Set<string>();
    const labelRows = new Set<string>();
    for (const unit of units) {
      for (let seed = 0; seed < 20; seed += 1) {
        const spec = generateElementaryProblem(unit, seed).figureSpec as {
          segments?: { label: string; pct: number }[];
          slices?: { label: string; pct: number }[];
        };
        const items = spec.segments ?? spec.slices ?? [];
        expect(items.reduce((s, it) => s + it.pct, 0)).toBe(100);
        keys.add(items.map((it) => it.pct).join(","));
        labelRows.add(items.map((it) => it.label).join(","));
      }
    }
    expect(keys.size).toBeGreaterThan(6);
    expect(labelRows.size).toBeGreaterThan(2);
    expect([...labelRows].some((row) => !row.startsWith("가"))).toBe(true);
  });

  it("평균 정답은 나누어떨어지는 자연수이다", () => {
    const units = UNITS.filter(
      (u) => u.chapter.includes("평균과 가능성") && !u.section.includes("가능성"),
    );
    expect(units.length).toBeGreaterThan(0);
    for (const unit of units) {
      for (let seed = 0; seed < 40; seed += 1) {
        const item = generateElementaryProblem(unit, seed);
        expect(item.answer, unit.section).toMatch(/^\d+$/);
        const hit = item.content.match(/(\d+), (\d+), (\d+)의 평균/);
        expect(hit, item.content).toBeTruthy();
        const sum = Number(hit![1]) + Number(hit![2]) + Number(hit![3]);
        expect(sum % 3).toBe(0);
        expect(item.answer).toBe(String(sum / 3));
      }
    }
  });

  it("선대칭·점대칭 그림은 격자 블록만 쓰지 않는다", () => {
    const line = UNITS.find((u) => u.section.includes("선대칭도형과 그 성질"))!;
    const point = UNITS.find((u) => u.section.includes("점대칭도형과 그 성질"))!;
    const lineMotifs = new Set<string>();
    const pointMotifs = new Set<string>();
    for (let seed = 0; seed < 24; seed++) {
      const a = generateElementaryProblem(line, seed).figureSpec as { motif?: string };
      const b = generateElementaryProblem(point, seed).figureSpec as { motif?: string };
      expect(a.motif).toBeTruthy();
      expect(b.motif).toBeTruthy();
      lineMotifs.add(a.motif!);
      pointMotifs.add(b.motif!);
    }
    expect(lineMotifs.size).toBeGreaterThan(1);
    expect(pointMotifs.size).toBeGreaterThan(1);
  });

  it("가·나 그림이면 이름을 묻지 않는다", () => {
    const bad: string[] = [];
    for (const unit of UNITS) {
      const item = generateElementaryProblem(unit, 20260821);
      const spec = item.figureSpec as
        | { kind?: string; items?: { label?: string }[] }
        | null;
      if (spec?.kind !== "namedShapes") continue;
      const labeled = (spec.items ?? []).some(
        (it) => it.label === "가" || it.label === "나",
      );
      if (labeled && item.content.includes("이름을 쓰시오")) {
        bad.push(unit.section);
      }
    }
    expect(bad).toEqual([]);
  });

  it("변의 길이 분류는 세 변이 같은 삼각형의 기호를 고른다", () => {
    const unit = UNITS.find((u) => u.section.includes("변의 길이에 따라 분류"))!;
    const item = generateElementaryProblem(unit, 20260821);
    expect(item.content).toMatch(/기호/);
    expect(item.answer).toBe("가");
    const spec = item.figureSpec as { items: { shape: string; label: string }[] };
    expect(spec.items.some((it) => it.shape === "eqTri" && it.label === "가")).toBe(
      true,
    );
  });

  it("분수 그림 등분이 크면 스펙을 만들지 않는다", () => {
    expect(() => fracSpec(() => 0, 30, 25)).toThrow(/12/);
    expect(() => fracSpec(() => 0, 16, 5)).toThrow(/12/);
  });

  it("크기가 같은 분수는 그릴 수 있는 등분만 그림으로 붙인다", () => {
    const visual = UNITS.find((u) => u.section.includes("크기가 같은 분수"))!;
    const compute = UNITS.find((u) => u.section.includes("분수를 간단하게"))!;
    for (let seed = 1; seed <= 30; seed++) {
      const shown = generateElementaryProblem(visual, seed);
      expect(shown.figureSpec, `seed ${seed} 그림`).toBeTruthy();
      const spec = shown.figureSpec as { kind?: string; cols?: number; n?: number };
      const parts = Number(spec.cols ?? spec.n);
      expect(parts, `seed ${seed} 등분`).toBeGreaterThanOrEqual(2);
      expect(parts, `seed ${seed} 등분`).toBeLessThanOrEqual(FRAC_FIG_MAX);
      const calc = generateElementaryProblem(compute, seed);
      expect(calc.figureSpec, `seed ${seed} 계산 약분`).toBeNull();
    }
  });

  it("생성기 fracBars 등분은 엔진 한도 안이다", () => {
    for (const seed of [1, 11, 20260821]) {
      for (const unit of UNITS) {
        const item = generateElementaryProblem(unit, seed);
        if (!item.figureSpec) continue;
        const spec = item.figureSpec as { kind?: string; cols?: number };
        if (spec.kind !== "fracBars") continue;
        expect(spec.cols, `${unit.section} seed ${seed}`).toBeGreaterThanOrEqual(2);
        expect(spec.cols, `${unit.section} seed ${seed}`).toBeLessThanOrEqual(16);
      }
    }
  });

  it("똑같이 나누기 그림은 사탕 개수와 같은 묶음이다", () => {
    const unit = UNITS.find(
      (u) => u.grade === "초3" && u.chapter.includes("나눗셈") && u.section.includes("똑같이"),
    )!;
    const item = generateElementaryProblem(unit, 11);
    const spec = item.figureSpec as { kind: string; groups: number; each: number };
    expect(spec.kind).toBe("groupDots");
    const hit = item.content.match(/사탕 (\d+)개를 (\d+)묶음/);
    expect(hit).toBeTruthy();
    expect(spec.groups * spec.each).toBe(Number(hit![1]));
    expect(spec.groups).toBe(Number(hit![2]));
    expect(item.answer).toBe(String(spec.each));
  });
});

describe.skipIf(!hasEngine)("[초등 엔진] 그림 렌더", () => {
  it("크기가 같은 분수 그림이 실제로 그려진다", async () => {
    const unit = UNITS.find((u) => u.section.includes("크기가 같은 분수"))!;
    const item = generateElementaryProblem(unit, 20260821);
    expect(item.figureSpec).toBeTruthy();
    const drawn = await renderFigureSpec(item.figureSpec!);
    expect(drawn.ok, drawn.ok ? "" : drawn.error).toBe(true);
  });

  it("생성기가 붙인 그림 스펙은 모두 그려진다", async () => {
    const failed: string[] = [];
    const seen = new Set<string>();
    for (const unit of UNITS) {
      const item = generateElementaryProblem(unit, 20260821);
      if (!item.figureSpec) continue;
      const kind = String((item.figureSpec as { kind?: string }).kind ?? "");
      if (seen.has(kind)) continue;
      seen.add(kind);
      const drawn = await renderFigureSpec(item.figureSpec);
      if (!drawn.ok) failed.push(`${kind} (${unit.section}): ${drawn.error}`);
    }
    expect(failed).toEqual([]);
  });

  it("후반 학년 kind 표본이 SVG 를 낸다", async () => {
    const samples: Record<string, unknown>[] = [
      { version: "elem-1", kind: "fracBars", cols: 7, rows: 4, filled: 8, fill: "#7eb89a" },
      { version: "elem-1", kind: "groupDots", groups: 5, each: 5 },
      { version: "elem-1", kind: "barChart", values: [{ label: "가", value: 4 }, { label: "나", value: 7 }], yMax: 10 },
      { version: "elem-1", kind: "lineChart", values: [{ label: "1", value: 2 }, { label: "2", value: 5 }] },
      { version: "elem-1", kind: "pictograph", unit: 5, items: [{ label: "가", count: 3 }] },
      {
        version: "elem-1",
        kind: "stripChart",
        segments: [
          { label: "가", pct: 40 },
          { label: "나", pct: 60 },
        ],
      },
      {
        version: "elem-1",
        kind: "pieChart",
        slices: [
          { label: "가", pct: 25 },
          { label: "나", pct: 75 },
        ],
      },
      { version: "elem-1", kind: "protractor", deg: 60 },
      { version: "elem-1", kind: "rotateFlip", cells: [[1, 1], [1, 2]], op: "rot90" },
      { version: "elem-1", kind: "symmetry", cells: [[1, 1], [3, 1]], axis: "v" },
      { version: "elem-1", kind: "symmetry", axis: "point", motif: "para" },
      { version: "elem-1", kind: "stackCubes", voxels: [[0, 0, 0], [0, 0, 1], [1, 0, 0]], views: ["iso", "top"] },
      { version: "elem-1", kind: "cuboid", w: 4, d: 3, h: 2 },
      { version: "elem-1", kind: "prism", sides: 5, h: 3 },
      { version: "elem-1", kind: "pyramid", sides: 4, h: 3 },
      { version: "elem-1", kind: "cylinder", r: 2, h: 5 },
      { version: "elem-1", kind: "cone", r: 2, h: 4 },
      { version: "elem-1", kind: "sphere", r: 3 },
      { version: "elem-1", kind: "netCuboid", w: 4, d: 2, h: 3 },
      { version: "elem-1", kind: "netCylinder", r: 2, h: 5, pi: 3 },
      { version: "elem-1", kind: "areaPoly", shape: "tri", base: 8, height: 6 },
    ];
    const failed: string[] = [];
    for (const spec of samples) {
      const drawn = await renderFigureSpec(spec);
      if (!drawn.ok) failed.push(`${String(spec.kind)}: ${drawn.error}`);
      else if (!drawn.svg.includes("<svg")) failed.push(`${String(spec.kind)}: empty`);
    }
    expect(failed).toEqual([]);
  });

  it("원기둥 전개도 생성기는 배치를 여러 가지로 고른다", () => {
    const unit = UNITS.find((u) => u.section.includes("원기둥의 전개도"))!;
    const layouts = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const item = generateElementaryProblem(unit, seed);
      const spec = item.figureSpec as { kind?: string; layout?: string };
      expect(spec.kind).toBe("netCylinder");
      expect(spec.layout, `seed ${seed}`).toBeTruthy();
      layouts.add(String(spec.layout));
    }
    expect(layouts.size).toBeGreaterThanOrEqual(4);
  });

  it("세로셈은 두 자리·세 자리 viewBox 폭이 같다", async () => {
    const two = await renderFigureSpec({
      version: "elem-1",
      kind: "columnOp",
      top: "26",
      op: "×",
      bottom: "12",
    });
    const three = await renderFigureSpec({
      version: "elem-1",
      kind: "columnOp",
      top: "381",
      op: "×",
      bottom: "5",
    });
    expect(two.ok && three.ok).toBe(true);
    if (!two.ok || !three.ok) return;
    const w2 = two.svg.match(/viewBox="0 0 ([0-9.]+)/)?.[1];
    const w3 = three.svg.match(/viewBox="0 0 ([0-9.]+)/)?.[1];
    expect(w2).toBe(w3);
    expect(two.svg).toMatch(/font-size="15"/);
    expect(three.svg).toMatch(/font-size="15"/);
  });

  it("그림그래프는 칸 수와 무관하게 viewBox 폭이 240이다", async () => {
    const few = await renderFigureSpec({
      version: "elem-1",
      kind: "pictograph",
      unit: 10,
      items: [{ label: "가", count: 3 }],
    });
    const many = await renderFigureSpec({
      version: "elem-1",
      kind: "pictograph",
      unit: 10,
      items: [
        { label: "가", count: 6 },
        { label: "나", count: 4 },
      ],
    });
    expect(few.ok && many.ok).toBe(true);
    if (!few.ok || !many.ok) return;
    expect(few.svg).toMatch(/viewBox="0 0 240 /);
    expect(many.svg).toMatch(/viewBox="0 0 240 /);
  });

  it("돌리기 격자는 빈 칸·색 칸 테두리 굵기가 같다", async () => {
    const r = await renderFigureSpec({
      version: "elem-1",
      kind: "rotateFlip",
      cells: [
        [1, 1],
        [2, 1],
        [3, 1],
        [2, 0],
      ],
      op: "rot90",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const widths = [
      ...r.svg.matchAll(/stroke-width="([0-9.]+)"/g),
    ].map((m) => m[1]);
    const cell = widths.filter((w) => w === "0.9");
    expect(cell.length).toBeGreaterThan(8);
    expect(new Set(cell).size).toBe(1);
  });

  it("띠그래프 pct 합이 100이 아니면 거부한다", async () => {
    const drawn = await renderFigureSpec({
      version: "elem-1",
      kind: "stripChart",
      segments: [
        { label: "가", pct: 40 },
        { label: "나", pct: 40 },
      ],
    });
    expect(drawn.ok).toBe(false);
  });
});
