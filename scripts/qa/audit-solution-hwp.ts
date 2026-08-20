/**
 * **이미 적용한 것을 원장으로 되짚어 감사한다** — 죽은 가드가 하나 있었다.
 *
 *   npx tsx scripts/qa/audit-solution-hwp.ts
 *
 * `repair-solution-hwp.ts` 의 「빈 분수가 새로 생겼나」 가드가 정규식 이스케이프
 * 때문에 **어떤 것도 못 잡는 죽은 규칙**이었다(`\\\\frac` 은 역슬래시 둘을 찾는다).
 * 그래서 그 가드는 늘 0을 냈고, 나는 그것을 「그런 사례가 없다」로 읽었다.
 *
 * 이 저장소가 이미 적은 자리다 — **이미 적용한 것도 로그로 되짚어 감사하라**
 * (CLAUDE.md 2026-08-18: 그렇게 해서만 `\overline{GE}` 2행을 찾았다).
 *
 * 여기서는 원장(before/after)을 다시 읽어 **고친 뒤 나빠진 행**을 센다:
 *   · 빈 분수가 늘었나
 *   · 붉은 span 이 늘었나 (제품 렌더러로 판정)
 *   · 잔재가 남았나
 */
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { isDirectScript } from "../import/isDirectScript";
import { residueRuns } from "./solutionHwpScope";

const LEDGER = "scripts/qa/reports/solution-hwp-repair.json";

const 빈분수 = (s: string) =>
  (s.match(/\\frac\{[^{}]*\}\{\}|\\frac\{\}/g) ?? []).length;
const 붉은수 = (s: string) => {
  const html = renderMathHtml(s);
  return (
    (html.match(/katex-error/g) ?? []).length +
    (html.match(/#cc0000/g) ?? []).length
  );
};

async function main(): Promise<void> {
  const REVERT = process.argv.includes("--revert");
  const APPLY = process.argv.includes("--apply");
  if (REVERT && APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as {
    rows: { id: string; code: string; before: string; after: string }[];
  };
  const 되돌릴것: typeof l.rows = [];
  const 나쁜: Record<string, string[]> = {
    "빈 분수가 늘었다": [],
    "붉은 자리가 늘었다": [],
    "잔재가 늘었다": [],
  };
  for (const r of l.rows) {
    let bad = false;
    if (빈분수(r.after) > 빈분수(r.before)) {
      나쁜["빈 분수가 늘었다"]!.push(r.code);
      bad = true;
    }
    if (붉은수(r.after) > 붉은수(r.before)) {
      나쁜["붉은 자리가 늘었다"]!.push(r.code);
      bad = true;
    }
    /**
     * 🔴 **「남았나」가 아니라 「늘었나」를 묻는다.**
     *
     * 판정 단위를 행 → 덩어리로 옮긴 뒤(2026-08-21), 한 행이 **일부만** 고쳐진
     * 채 남는 것이 정상이 됐다 — 못 고치는 덩어리는 날 글자 그대로 둔다.
     * 그런데 이 감사는 「고친 뒤 잔재가 0인가」를 묻고 있었다. 그대로 뒀으면
     * **멀쩡하게 좋아진 81행을 되돌릴** 뻔했다.
     *
     * 감사의 질문은 언제나 **「우리가 나쁘게 만들었나」**다. 분모가 바뀌면 같은
     * 숫자가 다른 것을 가리킨다(CLAUDE.md 2026-08-17).
     */
    if (residueRuns(r.after).length > residueRuns(r.before).length) {
      나쁜["잔재가 늘었다"]!.push(r.code);
      bad = true;
    }
    if (bad) 되돌릴것.push(r);
  }
  console.log(`원장 ${l.rows.length.toLocaleString()}행을 되짚었다`);
  let 합 = 0;
  for (const [k, v] of Object.entries(나쁜)) {
    합 += v.length;
    console.log(
      `  ${k}: ${v.length}` +
        (v.length ? ` — ${v.slice(0, 12).join(" ")}` : ""),
    );
  }
  /**
   * 🔴 **원장이 아니라 DB 를 본다.**
   *
   * 처음엔 원장(before/after)만 보고 「나빠진 행 14」를 찍었다. 그런데 되돌린
   * **뒤에도 14** 였다 — 원장은 안 바뀌기 때문이다. 0에 도달할 수 없는 지표는
   * 「다 고쳤나」를 영영 못 알려 준다. 그래서 지금 DB 값이 그 나쁜 값인지 묻는다.
   */
  const prisma = new PrismaClient();
  try {
    const 아직: typeof 되돌릴것 = [];
    let 이미 = 0;
    for (const r of 되돌릴것) {
      const cur = await prisma.problem.findUnique({
        where: { id: r.id },
        select: { solution: true },
      });
      if (cur && cur.solution === r.after) 아직.push(r);
      else 이미++;
    }
    console.log(
      아직.length === 0
        ? `\n✅ DB 에 남은 나쁜 행 없음 (원장 기준 ${되돌릴것.length}건은 이미 되돌렸다)`
        : `\n🔴 DB 에 아직 나쁜 행 ${아직.length} · 이미 되돌린 것 ${이미} (사유 합 ${합})`,
    );
    if (아직.length === 0) return;
    if (!REVERT) {
      console.log(
        "   되돌리려면: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/audit-solution-hwp.ts --revert --apply",
      );
      return;
    }
    // **지금 값이 우리가 쓴 값일 때만** 되돌린다 — 위에서 이미 확인했다.
    let done = 0;
    for (const r of 아직) {
      if (APPLY)
        await prisma.problem.update({
          where: { id: r.id },
          data: { solution: r.before },
        });
      done++;
    }
    console.log(`되돌리기${APPLY ? "" : " (드라이런)"}: ${done}`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) void main();
