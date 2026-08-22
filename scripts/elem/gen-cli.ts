/**
 * 초등 출제 CLI — .claude/skills/elem-gen 스킬이 부르는 실행부.
 *
 * 사용:
 *   npx tsx scripts/elem/gen-cli.ts --list [--grade 초4]
 *   npx tsx scripts/elem/gen-cli.ts --grade 초4 --section 1-5-1 --count 6 --seed 20260823 \
 *       [--tier 기본 | --preset 중위반] [--out set.json] [--html preview.html]
 *
 * - DB 에는 아무것도 쓰지 않는다 (적재는 별도 절차 — D-22·D-31).
 * - HTML 은 «검수용 미리보기»다. 시험지 지면이 아니다 (D-07) — 인쇄는 제품 화면으로.
 * - 그림이 안 그려지면 그 문항을 조용히 빼지 않고 **종료 코드 1** 로 알린다.
 */
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import {
  ELEM_TIERS,
  type ClassPreset,
  type ElemTier,
} from "../../src/lib/elementary/difficulty";
import { renderFigureSpec } from "../../src/lib/figure/renderFigureSpec";
import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { generateSet, listCoverage, type GenItem } from "./gen-core";

type Args = Record<string, string | true>;

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i]!;
    if (!a.startsWith("--")) throw new Error(`알 수 없는 인자: ${a}`);
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith("--")) {
      out[key] = next;
      i += 1;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function printCoverage(gradeFilter?: string): void {
  const rows = listCoverage().filter(
    (r) => !gradeFilter || r.grade === gradeFilter,
  );
  let lastChapter = "";
  for (const row of rows) {
    const chapterKey = `${row.grade} ${row.chapter}`;
    if (chapterKey !== lastChapter) {
      console.log(`\n${chapterKey}`);
      lastChapter = chapterKey;
    }
    const tiers = row.tiers.length
      ? `갈래: ${row.tiers.join("·")}`
      : "갈래 없음";
    console.log(
      `  ${row.code}  ${row.section.slice(row.code.length + 1)}  [${tiers}]`,
    );
  }
  const withTiers = rows.filter((r) => r.tiers.length > 0).length;
  console.log(`\n소단원 ${rows.length}개 · 난이도 갈래 등록 ${withTiers}개`);
}

function esc(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

async function buildHtml(
  title: string,
  items: GenItem[],
): Promise<{ html: string; figureErrors: string[] }> {
  const require = createRequire(import.meta.url);
  const katexCss = resolve(
    require.resolve("katex/package.json"),
    "../dist/katex.min.css",
  );
  const figureErrors: string[] = [];
  const blocks: string[] = [];
  for (let i = 0; i < items.length; i += 1) {
    const { tier, seed, problem } = items[i]!;
    let figure = "";
    if (problem.figureSpec) {
      const r = await renderFigureSpec(problem.figureSpec);
      if (r.ok) {
        figure = `<div class="fig">${r.svg}</div>`;
      } else {
        figureErrors.push(`${i + 1}번 (씨앗 ${seed}): ${r.error}`);
        figure = `<div class="fig err">그림 실패: ${esc(r.error)}</div>`;
      }
    }
    blocks.push(`<article>
<header><b>${i + 1}.</b> <span class="meta">${tier ? `[${esc(tier)}] ` : ""}씨앗 ${seed} · ${esc(problem.section)}</span></header>
<div class="content">${renderMathHtml(problem.content)}</div>
${figure}
<details><summary>정답·풀이</summary>
<div class="ans">정답: ${renderMathHtml(problem.answer)}</div>
<div class="sol">${renderMathHtml(problem.solution)}</div>
</details>
</article>`);
  }
  const html = `<!doctype html>
<html lang="ko"><head><meta charset="utf-8">
<title>${esc(title)}</title>
<link rel="stylesheet" href="file:///${katexCss.replace(/\\/g, "/")}">
<style>
body{font-family:"Malgun Gothic",sans-serif;max-width:760px;margin:24px auto;padding:0 16px;background:#fff;color:#111}
.banner{background:#fff7e0;border:1px solid #e0c060;padding:8px 12px;font-size:13px}
article{border-bottom:1px solid #ddd;padding:14px 0}
.meta{color:#888;font-size:12px}
.fig{margin:8px 0}
.fig svg{max-width:340px;height:auto}
.fig.err{color:#b00020;font-weight:bold}
details{margin-top:6px;font-size:14px}
.ans{font-weight:bold}
</style></head><body>
<div class="banner">검수용 미리보기 — 시험지 지면이 아닙니다 (인쇄는 제품 화면으로, D-07)</div>
<h2>${esc(title)}</h2>
${blocks.join("\n")}
</body></html>`;
  return { html, figureErrors };
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.list) {
    printCoverage(typeof args.grade === "string" ? args.grade : undefined);
    return;
  }

  const grade = args.grade;
  const code = args.section;
  if (typeof grade !== "string" || typeof code !== "string") {
    throw new Error(
      "필수: --grade 초3|초4|초5|초6 --section <코드>  (목록은 --list). 예: --grade 초4 --section 1-5-1 --count 6",
    );
  }
  const count = Number(args.count ?? 6);
  const seed = Number(args.seed ?? 20260821);
  const tier =
    typeof args.tier === "string" ? (args.tier as ElemTier) : undefined;
  if (tier !== undefined && !(ELEM_TIERS as readonly string[]).includes(tier)) {
    throw new Error(`갈래는 ${ELEM_TIERS.join("·")} 중 하나입니다: ${tier}`);
  }
  const preset =
    typeof args.preset === "string" ? (args.preset as ClassPreset) : undefined;

  const items = generateSet({ grade, code, count, seed, tier, preset });
  const payload = {
    meta: {
      grade,
      section: items[0]!.problem.section,
      code,
      count,
      seed,
      tier: tier ?? null,
      preset: preset ?? null,
      generatedAt: new Date().toISOString(),
    },
    items,
  };

  const json = JSON.stringify(payload, null, 2);
  if (typeof args.out === "string") {
    mkdirSync(dirname(resolve(args.out)), { recursive: true });
    writeFileSync(args.out, json, "utf-8");
    console.log(`JSON: ${resolve(args.out)}`);
  } else {
    console.log(json);
  }

  if (typeof args.html === "string") {
    const title = `${grade} ${payload.meta.section} — ${count}문항 (씨앗 ${seed}${preset ? ` · ${preset}` : tier ? ` · ${tier}` : ""})`;
    const { html, figureErrors } = await buildHtml(title, items);
    mkdirSync(dirname(resolve(args.html)), { recursive: true });
    writeFileSync(args.html, html, "utf-8");
    console.log(`HTML: ${resolve(args.html)}`);
    if (figureErrors.length) {
      console.error(
        `그림 실패 ${figureErrors.length}건:\n  ${figureErrors.join("\n  ")}`,
      );
      process.exitCode = 1;
    }
  }
}

main().catch((e: unknown) => {
  console.error(e instanceof Error ? e.message : String(e));
  process.exitCode = 1;
});
