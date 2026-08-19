/**
 * □ 되살리기 계획을 **제품 렌더러로** 검증한다. 내 목록이 아니라 화면이 판정한다.
 *
 *   npx tsx scripts/qa/verify-rpm-square-repair.ts            # 집계
 *   npx tsx scripts/qa/verify-rpm-square-repair.ts --list 8   # 표본을 눈으로
 *   npx tsx scripts/qa/verify-rpm-square-repair.ts --emit     # 판정을 파일로
 *
 * 입력: `scripts/qa/reports/rpm-square-repair.json`
 * 출력: `scripts/qa/reports/rpm-square-verified.json`
 *
 * ## 왜 렌더러를 부르나
 *
 * 「LaTeX 로 옮겼다」와 「화면에 제대로 나온다」는 다른 말이다. `renderMathHtml` 은
 * `$` **밖**의 백슬래시를 글자 그대로 이스케이프하므로, 감싸는 데 실패하면 지면에
 * `\frac{1}{2}` 가 날 것으로 나간다 — 그건 유사도로 안 잡힌다(CLAUDE.md 2026-08-16
 * 「KaTeX 가 초록이라고 지면이 멀쩡한 게 아니다」).
 *
 * 그래서 판정을 **네 가지로 다** 본다.
 *  · `katex-error` 가 있나
 *  · `.math-raw` 로 물러섰나 (3단 방어의 마지막 단계)
 *  · 붉은 글씨(`#cc0000`)가 있나 — KaTeX 0.16 은 모르는 명령을 **에러로 안 본다**
 *  · 수식 **밖**에 백슬래시 명령이 남았나
 *
 * ## 지금 값도 같이 렌더한다
 *
 * 「새 것이 성한가」만 보면 안 된다. 「지금 것보다 나은가」를 봐야 바꿀 근거가 된다.
 * 그래서 양쪽을 같은 렌더러에 넣고 □ 개수까지 같이 센다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { preprocessMathText } from "../../src/lib/math/textPreprocess";

const PLAN = "scripts/qa/reports/rpm-square-repair.json";
const OUT = "scripts/qa/reports/rpm-square-verified.json";

interface PlanRow {
  id: string;
  field: "solution" | "answer";
  book: string;
  q: number;
  "□": number;
  sim: number;
  answerSim: number;
  current: string | null;
  value: string;
}

/** 화면에 제대로 나오나. `mathRenderQa.ts` 의 `safe` 와 같은 잣대를 쓴다. */
function judge(text: string): { safe: boolean; why: string[]; html: string } {
  const html = renderMathHtml(text);
  const outside = preprocessMathText(text).replace(
    /\$\$[\s\S]*?\$\$|\$[^$\r\n]*?\$/gu,
    "",
  );
  const why: string[] = [];
  if (html.includes("katex-error")) why.push("katex-error");
  if (html.includes("math-raw")) why.push("math-raw 폴백");
  if (/#cc0000/iu.test(html)) why.push("붉은 글씨");
  if (/\\(?:[A-Za-z]+|[{},.;:!%#$&_ |\\])/u.test(outside))
    why.push("수식 밖에 명령이 남았다");
  return { safe: why.length === 0, why, html };
}

const countSquare = (s: string | null): number =>
  ((s ?? "").match(/\\square/g) ?? []).length;

function main(): void {
  const args = process.argv.slice(2);
  const listAt = args.indexOf("--list");
  const list = listAt >= 0 ? Number(args[listAt + 1] ?? 5) : 0;
  const emit = args.includes("--emit");
  const skipAt = args.indexOf("--skip");
  const skip = skipAt >= 0 ? Number(args[skipAt + 1] ?? 0) : 0;
  const onlyBad = args.includes("--bad");

  const plan = JSON.parse(readFileSync(PLAN, "utf8")) as { 목록: PlanRow[] };
  const rows = plan.목록;

  const verdicts = rows.map((r) => {
    const next = judge(r.value);
    const now = judge(r.current ?? "");
    return {
      ...r,
      ok: next.safe,
      why: next.why,
      nowOk: now.safe,
      nowWhy: now.why,
      nowSquare: countSquare(r.current),
      nextSquare: countSquare(r.value),
    };
  });

  const good = verdicts.filter((v) => v.ok);
  const bad = verdicts.filter((v) => !v.ok);
  console.log(
    `계획 ${rows.length}자리 · 화면에 제대로 나오는 것 ${good.length} · 아닌 것 ${bad.length}`,
  );

  const tally = new Map<string, number>();
  for (const v of bad)
    tally.set(v.why.join("+"), (tally.get(v.why.join("+")) ?? 0) + 1);
  for (const [k, n] of [...tally].sort((a, b) => b[1] - a[1]))
    console.log(`   막힘: ${k} ${n}`);

  const stillSquare = good.filter((v) => v.nextSquare > 0);
  console.log(`   새 값에도 □ 가 남는 것 ${stillSquare.length}`);
  console.log(
    `   지금 값이 이미 성한 것 ${verdicts.filter((v) => v.nowOk && v.nowSquare === 0).length}`,
  );
  console.log(
    `   되살아나는 □ ${good.reduce((s, v) => s + v.nowSquare, 0)}자리`,
  );

  const show = (onlyBad ? bad : good).slice(skip, skip + list);
  for (const v of show) {
    console.log(
      `\n═══ ${v.book.slice(7, 10)} #${v.q} [${v.field}] □${v.nowSquare}→${v.nextSquare}${v.ok ? "" : "  ✗ " + v.why.join(", ")}`,
    );
    console.log(
      `  지금 ${(v.current ?? "").replace(/\s+/g, " ").slice(0, 260)}`,
    );
    console.log(`  원문 ${v.value.replace(/\s+/g, " ").slice(0, 260)}`);
  }

  if (emit) {
    writeFileSync(
      OUT,
      JSON.stringify(
        { 통과: good.length, 막힘: bad.length, 목록: verdicts },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n→ ${OUT}`);
  }
}

main();
