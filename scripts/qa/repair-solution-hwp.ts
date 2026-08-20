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

import { isDirectScript } from "../import/isDirectScript";
import { judgeSpan, scopeOf } from "./solutionHwpScope";
import { MASK_KEY as KEY, spliceAccepted } from "./spanGuards";

const LEDGER = "scripts/qa/reports/solution-hwp-repair.json";

interface LedgerRow {
  id: string;
  code: string;
  before: string;
  after: string;
  spans: number;
}

/**
 * 되돌리기 원장을 **누적**한다 — 덮어쓰면 앞 회차를 되돌릴 수 없다.
 *
 * 🔴 이 스크립트는 이미 4,562행을 바꿔 놓았다. 두 번째 판이 원장을 통째로
 *    쓰면 그 4,562행의 되돌리기 자료가 **사라진다** — `--revert` 는 이 파일
 *    **하나만** 읽고 돌기 때문이다(CLAUDE.md 2026-08-20).
 *
 * 같은 문항이 두 번 나오면 **처음의 `before`** 와 **마지막의 `after`** 를 남긴다.
 * 마지막 `before` 를 쓰면 1차가 만든 값으로 되돌아가 「되돌렸다고 하면서
 * 아무것도 안 되돌린 것」이 된다.
 */
export function mergeLedgerRows(
  prev: readonly LedgerRow[],
  next: readonly LedgerRow[],
): LedgerRow[] {
  const byId = new Map<string, LedgerRow>(prev.map((r) => [r.id, r]));
  for (const r of next) {
    const old = byId.get(r.id);
    byId.set(r.id, old ? { ...r, before: old.before } : r);
  }
  return [...byId.values()];
}

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

    /**
     * 🔴 **판정 단위는 «행» 이 아니라 «덩어리» 다.**
     *
     * 처음엔 행 단위였다. 그러면 덩어리 하나가 걸릴 때 **그 행의 멀쩡한
     * 덩어리 전부가 같이 버려진다** — 실측으로 107행이 그렇게 버려졌고,
     * 그 안에 「변환 대상인데 안 고쳐진」 문항이 102개였다.
     * 못 바꾸는 덩어리는 원래 글자 그대로 두면 되므로 **잃는 것이 없다.**
     */
    let 버린덩어리 = 0;
    let 바꾼덩어리 = 0;
    for (const [ri, ps] of perRow) {
      const r = rows[ri]!;
      const before = r.solution ?? "";
      const { after, 바꾼수, 버림 } = spliceAccepted(
        before,
        ps.map((p) => ({
          start: p.start,
          end: p.end,
          body: p.body,
          out: (p as Piece & { out?: string | null }).out ?? null,
        })),
      );
      for (const b of 버림) {
        버린이유[b.why] = (버린이유[b.why] ?? 0) + 1;
        버린덩어리++;
        b.남은?.forEach((k) => (남은키워드[k] = (남은키워드[k] ?? 0) + 1));
      }
      if (표본.length < SAMPLE && 바꾼수 > 0) {
        const p = ps.find(
          (q) => (q as Piece & { out?: string | null }).out != null,
        );
        if (p)
          표본.push(
            `${r.problemCode}\n     전 ${p.body.replace(/\s+/g, " ").slice(0, 110)}` +
              `\n     후 ${String((p as Piece & { out?: string }).out)
                .replace(/\s+/g, " ")
                .slice(0, 110)}`,
          );
      }
      if (바꾼수 === 0) continue;
      바꾼덩어리 += 바꾼수;
      // 마지막 그물 — 덩어리를 갈아 끼우다 열쇠가 새면 그 행은 통째로 버린다.
      if (KEY.test(after)) {
        버린이유["🔴 행에 감춘 열쇠가 남았다"] =
          (버린이유["🔴 행에 감춘 열쇠가 남았다"] ?? 0) + 1;
        continue;
      }
      ledger.push({
        id: r.id,
        code: r.problemCode,
        before,
        after,
        spans: 바꾼수,
      });
    }

    console.log(
      `  🔴 고칠 문항 ${ledger.length.toLocaleString()} / 후보 행 ${perRow.size.toLocaleString()}` +
        ` · 바꾼 덩어리 ${바꾼덩어리.toLocaleString()} · 버린 덩어리 ${버린덩어리.toLocaleString()}`,
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

    // 🔴 **누적**한다. 이 판의 계획만 쓰면 앞 회차를 못 되돌린다.
    const 옛행: LedgerRow[] = existsSync(LEDGER)
      ? ((JSON.parse(readFileSync(LEDGER, "utf-8")) as { rows?: LedgerRow[] })
          .rows ?? [])
      : [];
    const merged = mergeLedgerRows(옛행, ledger);
    if (merged.length < 옛행.length) {
      console.error(
        `🔴 원장이 줄어든다 (${옛행.length} → ${merged.length}) — 멈춘다.`,
      );
      process.exit(1);
    }
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. before 가 **처음** 고치기 전 값이다(회차를 누적한다). " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/repair-solution-hwp.ts --revert --apply",
          변환기:
            "testchanger/core/hwpeq_to_latex.py (+ scripts/qa/convert-hwp-spans.py 의 구멍 막기)",
          rows: merged,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (이번 ${ledger.length}행 · 이어받은 ${merged.length - ledger.length}행 · 합 ${merged.length}행) — DB 보다 먼저 썼다`,
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
