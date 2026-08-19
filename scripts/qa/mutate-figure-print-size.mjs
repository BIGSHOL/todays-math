/**
 * 변이 시험 — **그림 인쇄 크기 규칙의 가드가 장식이 아닌지** 확인한다.
 *
 * ## 왜 이 파일이 있는가
 *
 * 이 저장소는 「가드가 있는데 아무것도 안 막던」 일을 여러 번 겪었다:
 *   · 상수 29개를 하나씩 망가뜨렸더니 **9개가 초록**이었다(적대적 리뷰 ④).
 *   · 재시도 고리를 통째로 지웠더니 **28개 전부 초록**이었다(2026-08-18 D-53).
 * 둘 다 문서·리뷰로는 안 나왔고 **망가뜨려 봐서만** 나왔다.
 *
 * 그래서 규칙을 한 곳으로 모은 김에, 그 한 곳을 한 줄씩 뒤집어 **어떤 검사가
 * 빨개지는지**를 기록한다. 안 빨개지는 변이가 있으면 그건 가드가 없다는 뜻이다.
 *
 * ## 쓰는 법
 *
 * ```
 * node scripts/qa/mutate-figure-print-size.mjs
 * ```
 *
 * 파일을 **제자리에서 고쳤다가 되돌린다.** 중간에 죽어도 원본 문자열을 그대로 다시
 * 쓰므로(`finally`) 남지 않지만, 확인은 `git status` 로 한 번 더 할 것.
 * ⚠️ `fs.rmSync` 는 쓰지 않는다 — 경로에 한글이 있으면 노드가 메시지 없이 죽는다.
 */
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();

const RULE = "src/lib/figurePrintSize.ts";
const RULER = "src/lib/printOverflow.ts";
const VIEW = "src/components/math/ProblemContent.tsx";
const PAPER = "src/components/print/PaperProblemView.tsx";
const BODY = "src/components/print/templates/ProblemBody.tsx";

const SIZE_TEST = "src/__tests__/unit/figurePrintSize.test.ts";
const HEIGHT_TEST = "src/__tests__/unit/printFigureHeight.test.ts";
const VIEW_TEST = "src/__tests__/unit/problemFigures.test.tsx";
const PIN_TEST = "src/__tests__/unit/printGeometryPin.test.ts";

const ALL = [SIZE_TEST, HEIGHT_TEST, VIEW_TEST, PIN_TEST];

/**
 * 변이 목록. `why` 는 **그 변이가 실제로 일어나면 지면에서 무슨 일이 나는가** 다 —
 * 「어떤 줄을 바꿨나」가 아니라 「무엇을 잃는가」를 적는다.
 */
const MUTATIONS = [
  {
    id: "상한을 70 → 100mm",
    why: "그림이 문항 열을 넘어 옆 칸을 침범한다",
    file: RULE,
    from: "export const FIGURE_MAX_WIDTH_MM = 70;",
    to: "export const FIGURE_MAX_WIDTH_MM = 100;",
    run: ALL,
  },
  {
    id: "mm→px 를 96 대신 72(pt)로",
    why: "모든 그림이 25% 작게 인쇄된다 — 지면에서 티가 안 난다",
    file: RULE,
    from: "const CSS_PX_PER_INCH = 96;",
    to: "const CSS_PX_PER_INCH = 72;",
    run: ALL,
  },
  {
    id: "인쇄 폭 상한을 min → max",
    why: "150mm 짜리 그림이 그대로 나가 지면을 뚫는다",
    file: RULE,
    from: "  return Math.min(sourceMm, FIGURE_MAX_WIDTH_MM);",
    to: "  return Math.max(sourceMm, FIGURE_MAX_WIDTH_MM);",
    run: ALL,
  },
  {
    id: "mm 를 알아도 **원본 픽셀보다 크게는 안 그린다**",
    why: "작은 그림이 안 커진다 — 일관성이 반쪽만 생기고 아무도 모른다",
    file: RULE,
    from: "  return mmToCssPx(figurePrintWidthMm(figure.sourceMm));",
    to: "  return Math.min(figure.width, mmToCssPx(figurePrintWidthMm(figure.sourceMm)));",
    run: ALL,
  },
  {
    id: "mm 배열 길이 검사를 뺀다",
    why: "짝이 어긋난 mm 가 엉뚱한 그림에 붙는다 — 판정이 안다고 착각한다",
    file: RULE,
    from: "  if (!flat || flat.length !== figureCount) return unknown();",
    to: "  if (!flat) return unknown();",
    run: ALL,
  },
  {
    id: "물리적 경계(1~210mm)를 뺀다",
    why: "1/100mm 단위 착오(7000)가 그대로 들어와 그림이 0.7mm 로 사라진다",
    file: RULE,
    from: "    value >= MIN_FIGURE_MM &&\n    value <= MAX_FIGURE_MM",
    to: "    value > 0",
    run: ALL,
  },
  {
    /**
     * ⚠️ **동치 변이다.** 지금 경계(1~210mm)가 NaN·무한대를 이미 전부 걷어낸다
     * (`NaN >= 1` 은 false, `Infinity <= 210` 도 false). 그래서 이 줄을 빼도 동작이
     * 한 톨도 안 바뀐다 — 「가드가 없다」가 아니라 **「변이가 아무것도 안 바꾼다」** 다.
     * 줄은 남겨 둔다: 경계를 나중에 넓히면 그때부터 이 줄이 유일한 방어가 된다.
     * 실제 동작 잠금은 `0·음수·NaN·무한대는 그 자리만 모른다다` 가 하고 있다.
     */
    id: "`Number.isFinite` 검사를 뺀다",
    why: "(동치) 경계가 이미 NaN·무한대를 걷어낸다 — 지금은 잃는 것이 없다",
    equivalent: true,
    file: RULE,
    from: "    Number.isFinite(value) &&\n",
    to: "",
    run: ALL,
  },
  {
    /**
     * ⚠️ 이것도 **동치다.** `Number.isFinite("40")` 는 강제 변환을 안 해서 false 다 —
     * 문자열을 옆줄이 이미 막는다. 위 항목과 **서로를 덮고 있다.**
     */
    id: '`typeof value === "number"` 검사를 뺀다',
    why: "(동치) 옆줄 `Number.isFinite` 가 문자열을 이미 막는다",
    equivalent: true,
    file: RULE,
    from: '    typeof value === "number" &&\n',
    to: "",
    run: ALL,
  },
  {
    /**
     * 🔴 **겹치는 가드는 하나씩 빼서는 못 잰다.** 위 둘은 각각 빼면 상대가 덮어 주어
     * 동치가 되지만, **같이 빼면** 문자열이 통과한다(`"40" >= 1 && "40" <= 210` 은 참).
     * 그래서 「변이가 초록이다 = 가드가 없다」로 곧장 읽으면 안 된다 — 겹침을 먼저 보고,
     * 겹친 것은 **묶어서** 빼 봐야 그 자리에 가드가 있는지 알 수 있다.
     */
    id: "숫자 검사 **둘 다** 뺀다 (`typeof` + `Number.isFinite`)",
    why: '대장 JSON 의 문자열 `"40"` 이 경계를 통과해 `toFixed` 에서 터진다 — 인쇄 화면이 죽는다',
    file: RULE,
    from: '    typeof value === "number" &&\n    Number.isFinite(value) &&\n',
    to: "",
    run: ALL,
  },
  {
    id: "치수를 몰라도 mm 는 살린다",
    why: "자는 «모른다»(264.567px)로, 지면은 mm 로 그려 **둘이 갈라진다**",
    file: RULE,
    from: "    if (!Number.isFinite(width) || !Number.isFinite(height)) return null;\n    if (width <= 0 || height <= 0) return null;",
    to: "    if (!Number.isFinite(width) || !Number.isFinite(height))\n      return sourceMm[index] == null ? null : { width: 1, height: 1, sourceMm: sourceMm[index] };\n    if (width <= 0 || height <= 0)\n      return sourceMm[index] == null ? null : { width: 1, height: 1, sourceMm: sourceMm[index] };",
    run: ALL,
  },
  {
    id: "`parseFigureDimensions` 가 mm 인자를 무시한다",
    why: "규칙만 고치고 배선이 끊긴 상태 — 아무것도 안 바뀌는데 초록이면 못 알아챈다",
    file: RULE,
    from: "  const sourceMm = parseFigureSourceMm(figureCount, sourceMmFlat);",
    to: "  const sourceMm = parseFigureSourceMm(figureCount, undefined);",
    run: ALL,
  },
  {
    id: "인라인 style 에서 상한을 뺀다",
    why: "`width: 150mm` 이 나가고 CSS 상한 한쪽만 남는다",
    file: RULE,
    from: "  return { width: `${figurePrintWidthMm(sourceMm).toFixed(2)}mm` };",
    to: "  return { width: `${sourceMm.toFixed(2)}mm` };",
    run: ALL,
  },
  {
    id: "모를 때 style 을 `0mm` 로 만든다",
    why: "mm 를 모르는 그림이 지면에서 **사라진다**",
    file: RULE,
    from: "  if (sourceMm == null) return undefined;",
    to: "  if (sourceMm == null) return { width: `0.00mm` };",
    run: ALL,
  },
  {
    id: "자가 줄 접기에는 **원본 픽셀 폭**을 쓴다",
    why: "지면은 mm 로 나란히 놓는데 자는 두 줄로 세서 헛경고가 는다",
    file: RULER,
    from: "    const width = printedWidth;",
    to: "    const width = figure ? figure.width : printedWidth;",
    run: ALL,
  },
  {
    id: "판정이 문항의 `figureSourceMm` 을 안 읽는다",
    why: "DB 에 값이 들어와도 넘침 판정만 옛 크기로 잰다 — 한쪽 배선만 끊긴 상태",
    file: RULER,
    from: "    problem.figureSourceMm,\n",
    to: "",
    run: ALL,
  },
  {
    id: "지면이 인라인 style 을 안 붙인다",
    why: "자만 mm 로 재고 지면은 옛 크기 — **자가 재는 지면이 실제 지면이 아니다**",
    file: VIEW,
    from: "              style={figureWidthStyle(placements[index]?.sourceMm)}\n",
    to: "",
    run: ALL,
  },
  {
    id: "인쇄 상한 클래스(`print:max-w-[70mm]`)를 뗀다",
    why: "mm 를 모르는 그림이 화면 크기(360px=95mm) 그대로 인쇄된다",
    file: VIEW,
    from: 'className="h-auto w-auto max-w-full sm:max-w-[360px] print:max-w-[70mm]"',
    to: 'className="h-auto w-auto max-w-full sm:max-w-[360px]"',
    run: ALL,
  },
  {
    id: "`PaperProblemView` 가 mm 를 안 넘긴다",
    why: "인쇄 지면만 옛 크기로 그린다 — 화면에서는 안 보이는 회귀다",
    file: PAPER,
    from: "      figureSourceMm={figureSourceMm}\n",
    to: "",
    run: ALL,
  },
  {
    id: "`ProblemBody`(인쇄 템플릿)가 mm 를 안 넘긴다",
    why: "정확히 인쇄 경로에서만 값이 끊긴다 — 단위 테스트로는 안 보인다",
    file: BODY,
    from: "      figureSourceMm={problem.figureSourceMm}\n",
    to: "",
    run: ALL,
  },
  {
    id: "`ProblemBody` 가 치수(`figureDims`)를 안 넘긴다",
    why: "치수를 모르면 mm 도 버리는 규칙 때문에 **mm 가 통째로 죽는다**",
    file: BODY,
    from: "      figureDims={problem.figureDims}\n",
    to: "",
    run: ALL,
  },
];

function runTests(files) {
  const result = spawnSync(
    process.platform === "win32" ? "npx.cmd" : "npx",
    ["vitest", "run", "--reporter=dot", ...files],
    { cwd: ROOT, encoding: "utf8", shell: process.platform === "win32" },
  );
  const out = `${result.stdout ?? ""}${result.stderr ?? ""}`;
  const failed = [
    ...out.matchAll(/^\s*(?:FAIL|×|✗)\s+(\S+?\.tsx?)\b/gm),
  ].map((m) => m[1]);
  return { ok: result.status === 0, files: [...new Set(failed)] };
}

const rows = [];
for (const mutation of MUTATIONS) {
  const file = path.join(ROOT, mutation.file);
  const original = readFileSync(file, "utf8");
  if (!original.includes(mutation.from)) {
    rows.push({ ...mutation, caught: "변이 실패", by: "대상 문자열이 없다" });
    console.error(`⚠ 변이 대상을 못 찾았다: ${mutation.id} (${mutation.file})`);
    continue;
  }
  try {
    writeFileSync(file, original.replace(mutation.from, mutation.to), "utf8");
    const { ok, files } = runTests(mutation.run);
    const verdict = ok
      ? mutation.equivalent
        ? "⚪ 동치 — 동작이 안 바뀐다"
        : "🔴 초록 — 가드 없음"
      : "🟢 빨강";
    rows.push({
      ...mutation,
      caught: verdict,
      by: files.map((f) => path.basename(f)).join(" · ") || "—",
    });
    console.log(`${verdict.split(" ")[0]}  ${mutation.id}`);
  } finally {
    writeFileSync(file, original, "utf8");
  }
}

const escaped = (s) => s.replaceAll("|", "\\|");
console.log("\n| 변이 | 무엇을 잃는가 | 결과 | 잡은 검사 |");
console.log("| --- | --- | --- | --- |");
for (const r of rows)
  console.log(
    `| ${escaped(r.id)} | ${escaped(r.why)} | ${r.caught} | ${escaped(r.by)} |`,
  );

/**
 * ⚠️ **동치 변이를 «잡았다»로 세지 않는다.** 동작이 안 바뀌는 변이가 초록인 것은
 *    가드의 문제가 아니다 — 그걸 실패로 세면 다음 사람이 쓸데없는 검사를 만든다.
 *    반대로 «잡았다» 쪽에 섞어 세면 통과율이 부풀려진다. 그래서 **따로** 찍는다.
 */
const equivalent = rows.filter((r) => r.caught.startsWith("⚪"));
const missed = rows.filter(
  (r) => !r.caught.startsWith("🟢") && !r.caught.startsWith("⚪"),
);
console.log(
  `\n변이 ${rows.length}개 · 잡힘 ${rows.length - missed.length - equivalent.length}` +
    ` · 동치 ${equivalent.length} · **안 잡힘 ${missed.length}**`,
);
process.exit(missed.length === 0 ? 0 : 1);
