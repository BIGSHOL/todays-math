/**
 * **해설의 날 HWP 스크립트를 LaTeX 로** — 계획 → 가드 → 표본 → 원장 → 적용.
 *
 *   npx tsx scripts/qa/repair-solution-hwp.ts --limit 50 --sample 8   # 드라이런
 *   npx tsx scripts/qa/repair-solution-hwp.ts                          # 전량 드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-solution-hwp.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-solution-hwp.ts --revert --apply
 *
 * ## 왜 이 트랙이 생겼나
 *
 * 잔재 지표가 **`content` 만** 재고 있었다 — 거기서는 0.31% 다. `solution` 을 재니
 * **9.98%(4,694문항)** 였다. 변환을 본문에만 돌리고 해설은 안 돌린 자리다.
 * 정답지에 `lim _{n rarrow INF }` · `LEFT ( 3x ^{2} +ax-5 RIGHT )` 가 글자로 나간다.
 *
 * ## 🔴 세 겹의 가드
 *
 * 1. **범위** — 이미 LaTeX 인 덩어리는 건드리지 않는다(`solutionHwpScope.ts`).
 *    다시 변환하면 `\frac{5}{16}` 이 `\frac516` 이 된다. 에러는 안 난다.
 * 2. **손실** — 한글·수를 잃으면 그 행을 버린다.
 * 3. **결과** — 고친 뒤에도 잔재가 남거나 **제품 렌더러가 붉게** 그리면 버린다.
 *    판정은 화면과 같은 `renderMathHtml` 로 한다 — 규칙을 옮겨 적지 않는다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런. 되돌리기 원장을 **DB 보다 먼저** 쓴다.
 */
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { isDirectScript } from "../import/isDirectScript";
import { judgeSpan, residueRuns, scopeOf } from "./solutionHwpScope";

const LEDGER = "scripts/qa/reports/solution-hwp-repair.json";
/** 감출 때 쓰는 사적 영역 열쇠 — 결과에 남으면 변환이 삼킨 것이다. */
const KEY = /[-]/u;

interface LedgerRow {
  id: string;
  code: string;
  before: string;
  after: string;
  spans: number;
}

const 한글 = (s: string) => (s.match(/[가-힣]/g) ?? []).join("");
/**
 * 수를 **개수까지** 센다.
 *
 * 🔴 집합으로 세면 같은 수가 또 있을 때 손실이 구조적으로 안 보인다 —
 *    `\frac{1}{2}+\frac{1}{2}` 에서 하나가 사라져도 집합은 그대로다.
 */
const 수 = (s: string): Map<string, number> => {
  const m = new Map<string, number>();
  for (const n of s.match(/\d+/g) ?? []) m.set(n, (m.get(n) ?? 0) + 1);
  return m;
};
const 붉은가 = (s: string) => {
  const html = renderMathHtml(s);
  return html.includes("katex-error") || html.includes("#cc0000");
};

/** 파이썬 정본 변환기를 **한 번에** 부른다 — 행마다 부르면 기동 비용이 지배한다. */
function convertSpans(bodies: string[]): (string | null)[] {
  if (bodies.length === 0) return [];
  const dir = path.join(os.tmpdir(), `hwpconv-${process.pid}`);
  mkdirSync(dir, { recursive: true });
  const inp = path.join(dir, "in.json");
  const out = path.join(dir, "out.json");
  writeFileSync(
    inp,
    JSON.stringify(
      bodies.map((b, i) => ({ id: String(i), text: "$" + b + "$" })),
    ),
    "utf-8",
  );
  execFileSync("python", ["scripts/qa/convert-hwp-spans.py", inp, out], {
    encoding: "utf-8",
    maxBuffer: 1 << 28,
  });
  const got = JSON.parse(readFileSync(out, "utf-8")) as {
    id: string;
    text?: string;
    error?: string;
  }[];
  // ⚠️ `rmSync` 를 쓰지 않는다 — Node v24(win32)는 해석된 경로에 비ASCII 가 있으면
  //    프로세스를 죽인다(CLAUDE.md 2026-08-19). 저장소 가드가 이 자리를 잡아 줬다.
  for (const f of [inp, out]) unlinkSync(f);
  rmdirSync(dir);
  const byId = new Map(got.map((g) => [g.id, g]));
  return bodies.map((_b, i) => {
    const g = byId.get(String(i));
    if (!g || g.error || typeof g.text !== "string") return null;
    // `$…$` 로 싸서 보냈으니 벗겨서 돌려준다.
    return g.text.replace(/^\$/, "").replace(/\$$/, "");
  });
}

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  const num = (flag: string, dflt: number) => {
    const i = process.argv.indexOf(flag);
    return i >= 0 ? Number(process.argv[i + 1] ?? dflt) : dflt;
  };
  const LIMIT = num("--limit", 0);
  const SAMPLE = num("--sample", 0);
  if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (REVERT) return await revert(prisma, APPLY);

    const all = await prisma.problem.findMany({
      where: { solution: { not: null } },
      select: { id: true, problemCode: true, solution: true },
      orderBy: { problemCode: "asc" },
    });

    const 대상 = all.filter((r) => scopeOf(r.solution ?? "").any);
    const rows = LIMIT > 0 ? 대상.slice(0, LIMIT) : 대상;
    console.log(
      `해설 ${all.length.toLocaleString()} (분모) · 변환 대상 ${대상.length.toLocaleString()}` +
        (LIMIT > 0 ? ` · 이번에 ${rows.length}` : ""),
    );

    // ⑴ 바꿀 덩어리를 전부 모아 **한 번에** 변환한다.
    interface Piece {
      row: number;
      start: number;
      end: number;
      body: string;
    }
    const pieces: Piece[] = [];
    rows.forEach((r, ri) => {
      for (const m of (r.solution ?? "").matchAll(/\$([^$]*)\$/g)) {
        if (!judgeSpan(m[1]!).convert) continue;
        pieces.push({
          row: ri,
          start: m.index,
          end: m.index + m[0].length,
          body: m[1]!,
        });
      }
    });
    console.log(
      `  변환할 덩어리 ${pieces.length.toLocaleString()} — 정본 변환기를 한 번 부른다`,
    );
    const converted = convertSpans(pieces.map((p) => p.body));

    // ⑵ 행마다 되붙이고 가드를 건다.
    const ledger: LedgerRow[] = [];
    const 버린이유: Record<string, number> = {};
    const 남은키워드: Record<string, number> = {};
    const 표본: string[] = [];
    const perRow = new Map<number, Piece[]>();
    pieces.forEach((p, i) => {
      (p as Piece & { out?: string | null }).out = converted[i] ?? null;
      const a = perRow.get(p.row) ?? [];
      a.push(p);
      perRow.set(p.row, a);
    });

    for (const [ri, ps] of perRow) {
      const r = rows[ri]!;
      const before = r.solution ?? "";
      let after = before;
      let ok = true;
      // 뒤에서부터 갈아 끼워야 앞 자리 오프셋이 안 흔들린다.
      for (const p of [...ps].sort((a, b) => b.start - a.start)) {
        const outBody = (p as Piece & { out?: string | null }).out;
        if (outBody == null) {
          ok = false;
          break;
        }
        after =
          after.slice(0, p.start) + "$" + outBody + "$" + after.slice(p.end);
      }
      const 버린다 = (why: string) => {
        버린이유[why] = (버린이유[why] ?? 0) + 1;
      };
      if (!ok) {
        버린다("변환 실패");
        continue;
      }
      if (after === before) {
        버린다("바뀐 것 없음");
        continue;
      }
      if (KEY.test(after)) {
        버린다("🔴 감춘 열쇠가 남았다");
        continue;
      }
      if (한글(after) !== 한글(before)) {
        버린다("🔴 한글이 달라졌다");
        continue;
      }
      const 후수 = 수(after);
      for (const [n, c] of 수(before))
        if ((후수.get(n) ?? 0) < c) {
          ok = false;
          break;
        }
      if (!ok) {
        버린다("🔴 수를 잃었다");
        continue;
      }
      // 🔴 결과 검사는 `scopeOf` 가 아니라 `residueRuns` 다 — `scopeOf` 의
      //    「역슬래시가 있으면 LaTeX」 규칙을 결과에 대면 **구조적으로 0**이 된다.
      const 남은 = residueRuns(after);
      if (남은.length > 0) {
        남은.forEach((k) => (남은키워드[k] = (남은키워드[k] ?? 0) + 1));
        버린다("잔재가 남았다");
        continue;
      }
      // 🔴 빈 분수가 **새로 생기면** 변환이 인자를 삼킨 것이다 —
      //    `LE pi over` 처럼 끝이 잘린 조각에서 실제로 `\\frac{\\pi}{}` 가 나온다.
      //    지면은 이제 그것을 □ 로 그리므로 조용하지 않지만, 애초에 안 만드는 게 낫다.
      const 빈분수 = (s: string) =>
        (s.match(/\\frac\{[^{}]*\}\{\}|\\frac\{\}/g) ?? []).length;
      if (빈분수(after) > 빈분수(before)) {
        버린다("🔴 빈 분수가 생겼다");
        continue;
      }
      if (붉은가(after) && !붉은가(before)) {
        버린다("🔴 붉어졌다");
        continue;
      }

      ledger.push({
        id: r.id,
        code: r.problemCode,
        before,
        after,
        spans: ps.length,
      });
      if (표본.length < SAMPLE) {
        const p = ps[0]!;
        표본.push(
          `${r.problemCode}\n     전 ${p.body.replace(/\s+/g, " ").slice(0, 110)}` +
            `\n     후 ${String((p as Piece & { out?: string }).out)
              .replace(/\s+/g, " ")
              .slice(0, 110)}`,
        );
      }
    }

    console.log(
      `  🔴 고칠 문항 ${ledger.length.toLocaleString()} · 버린 행 ${(perRow.size - ledger.length).toLocaleString()}`,
    );
    for (const [k, v] of Object.entries(버린이유).sort((a, b) => b[1] - a[1]))
      console.log(`     ${k}: ${v}`);
    const 남은top = Object.entries(남은키워드)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 20);
    if (남은top.length > 0)
      console.log(
        "     남은 키워드: " + 남은top.map(([k, v]) => `${k}:${v}`).join(" "),
      );
    표본.forEach((s) => console.log("   " + s));

    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (ledger.length === 0) return;

    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. before 가 고치기 전 값이다. " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-solution-hwp.ts --revert --apply",
          변환기:
            "testchanger/core/hwpeq_to_latex.py (+ scripts/qa/convert-hwp-spans.py 의 구멍 막기)",
          rows: ledger,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (${ledger.length}행) — DB 보다 먼저 썼다`,
    );

    let n = 0;
    for (const l of ledger) {
      await prisma.problem.update({
        where: { id: l.id },
        data: { solution: l.after },
      });
      if (++n % 200 === 0) process.stdout.write(`\r적용 ${n}/${ledger.length}`);
    }
    console.log(`\r적용 완료 ${n.toLocaleString()}건`);
  } finally {
    await prisma.$disconnect();
  }
}

async function revert(prisma: PrismaClient, apply: boolean): Promise<void> {
  if (!existsSync(LEDGER)) {
    console.error(`되돌릴 원장이 없다: ${LEDGER}`);
    process.exit(1);
  }
  const l = JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows: LedgerRow[] };
  let done = 0;
  let skipped = 0;
  for (const r of l.rows) {
    const cur = await prisma.problem.findUnique({
      where: { id: r.id },
      select: { solution: true },
    });
    if (!cur || cur.solution !== r.after) {
      skipped++;
      continue;
    }
    if (apply)
      await prisma.problem.update({
        where: { id: r.id },
        data: { solution: r.before },
      });
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      (skipped
        ? " — 그 뒤 다른 트랙이 바꾼 것이다. 남의 값을 덮지 않는다."
        : ""),
  );
}

if (isDirectScript(import.meta.url)) void main();
