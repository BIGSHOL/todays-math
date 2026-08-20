/**
 * 지면에 **날 LaTeX 이 그대로 나가는** 문항을 출제 풀에서 뺀다.
 *
 *   npx tsx scripts/qa/reject-latex-leak.ts                 # 드라이런(기본)
 *   npx tsx scripts/qa/reject-latex-leak.ts --list          # 대상 전량
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-latex-leak.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-latex-leak.ts --revert --apply
 *
 * ## 무엇이 문제인가
 *
 * 원장님이 시험지에서 찾아 주셨다(2026-08-20) — 문항 본문이 이렇게 나갔다:
 *
 *   `\displaystyle 1-\left\{ 5-4\div under\left( -\dfrac{2}{3}\right) ^{2}\right\}`
 *
 * `$` 감싸기가 깨져서 수식이 **글자 그대로** 인쇄된다. 학생은 못 푼다.
 *
 * ## 판정은 **제품 렌더러**가 한다
 *
 * `renderMathHtml` 은 `$` **밖**의 백슬래시를 글자 그대로 이스케이프한다. 그러니
 * 「렌더한 결과에 백슬래시 명령이 글자로 남았나」가 곧 「지면에 날 것이 나가나」다.
 * 낱말 목록으로 세면 이 부류를 구조적으로 못 본다 — 목록에 없는 명령은 영영 0이다
 * (CLAUDE.md 2026-08-18·19).
 *
 * ## 왜 `directUseAllowed` 가 아니라 `reviewStatus` 인가
 *
 * 그 컬럼은 그림 유실 잠금과 보기그림 잠금이 **이미 쓰고 있다.** 여기서 같이 쓰면
 * 되돌릴 때 서로를 푼다(16 §3). 대신 D-22 의 검수 판정을 쓴다 —
 * `findEligibleProblems` 는 `approved` 만 보므로 `rejected` 면 출제에서 빠지고,
 * **검수 콘솔에는 남아** 나중에 고칠 수 있다. 지우는 것이 아니다.
 *
 * ⚠️ 공유 DB(D-31). 기본은 드라이런.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient, ReviewStatus } from "@prisma/client";

import { renderMathHtml } from "../../src/lib/math/renderMathHtml";
import { isDirectScript } from "../import/isDirectScript";

const LEDGER = "scripts/qa/reports/latex-leak-reject.json";

/**
 * 지면에 글자로 남으면 안 되는 명령들.
 *
 * ⚠️ 이 목록은 **판정의 근거가 아니라 이름표**다. 판정은 「렌더 결과에 백슬래시
 *    명령이 남았나」이고, 목록은 그중 **확실히 수식인 것**만 골라 오탐을 막는다
 *    (본문에 `\` 가 우연히 들어간 경우와 가른다).
 */
const BS = String.fromCharCode(92);
const COMMANDS = [
  "displaystyle",
  "dfrac",
  "frac",
  "left",
  "right",
  "uparrow",
  "times",
  "div",
  "sqrt",
  "overline",
  "begin",
  "end",
  "mathrm",
  "underset",
  "angle",
  "cdots",
  "leq",
  "geq",
];
const RAW = new RegExp(BS + BS + "(" + COMMANDS.join("|") + ")");

/** 이 문항이 지면에 날 LaTeX 을 내보내나 — **제품 렌더러로** 판정한다. */
export function leaksRawLatex(content: string): boolean {
  const text = renderMathHtml(content).replace(/<[^>]+>/g, "");
  return RAW.test(text);
}

interface LedgerRow {
  id: string;
  code: string;
  beforeStatus: ReviewStatus;
  reportId: string | null;
}

const WHY =
  "수식 감싸기가 깨져 지면에 날 LaTeX 이 그대로 인쇄된다 " +
  "(제품 렌더러로 판정). 고치면 다시 approved 로 돌린다.";

async function main(): Promise<void> {
  const APPLY = process.argv.includes("--apply");
  const REVERT = process.argv.includes("--revert");
  const LIST = process.argv.includes("--list");
  if ((APPLY || REVERT) && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error(
      "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
    process.exit(1);
  }

  const prisma = new PrismaClient();
  try {
    if (REVERT) return await revert(prisma, APPLY);

    const rows = await prisma.problem.findMany({
      where: { reviewStatus: ReviewStatus.approved, directUseAllowed: true },
      select: {
        id: true,
        problemCode: true,
        content: true,
        unitId: true,
        unit: { select: { grade: true, chapter: true, section: true } },
      },
    });
    const bad = rows.filter((r) => leaksRawLatex(r.content));

    // 분모를 먼저 찍는다.
    console.log(`출제 가능 ${rows.length.toLocaleString()}건 (분모)`);
    console.log(
      `  🔴 지면에 날 LaTeX 이 나가는 것 ${bad.length.toLocaleString()}`,
    );

    // D-20 — **무엇을 잃는가.** 건수만 보면 1%도 그럴듯해 보인다.
    const per = new Map<
      string,
      { name: string; before: number; lose: number }
    >();
    for (const r of rows) {
      const k = r.unitId;
      const cur = per.get(k) ?? {
        name: `${r.unit?.grade} > ${r.unit?.section}`,
        before: 0,
        lose: 0,
      };
      cur.before++;
      per.set(k, cur);
    }
    for (const r of bad) per.get(r.unitId)!.lose++;
    const hit = [...per.values()].filter((u) => u.lose > 0);
    const thin = hit
      .filter((u) => u.before - u.lose < 8)
      .sort((a, b) => a.before - a.lose - (b.before - b.lose));
    console.log(`  영향 단원 ${hit.length}개`);
    console.log(`  🔴 뺀 뒤 8건 미만이 되는 단원 ${thin.length}개`);
    for (const u of thin.slice(0, 10))
      console.log(`     ${u.before} → ${u.before - u.lose}  ${u.name}`);

    if (LIST) for (const r of bad) console.log(`  ${r.problemCode}`);
    if (!APPLY) {
      console.log("\n드라이런이다 — DB 를 한 건도 안 바꿨다.");
      return;
    }
    if (bad.length === 0) return;

    const ledgerRows: LedgerRow[] = bad.map((r) => ({
      id: r.id,
      code: r.problemCode,
      beforeStatus: ReviewStatus.approved,
      reportId: null,
    }));
    mkdirSync(path.dirname(LEDGER), { recursive: true });
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          note:
            "되돌리기 자료. beforeStatus 가 바꾸기 전 값이다. " +
            "되돌리기: ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/reject-latex-leak.ts --revert --apply",
          why: WHY,
          rows: ledgerRows,
        },
        null,
        1,
      ),
      "utf-8",
    );
    console.log(
      `\n되돌리기 원장 → ${LEDGER} (${ledgerRows.length}행) — DB 보다 먼저 썼다`,
    );

    let n = 0;
    for (const l of ledgerRows) {
      const report = await prisma.problemReport.create({
        data: { problemId: l.id, reason: "content", note: WHY },
        select: { id: true },
      });
      l.reportId = report.id;
      await prisma.problem.update({
        where: { id: l.id },
        data: { reviewStatus: ReviewStatus.rejected },
      });
      if (++n % 100 === 0)
        process.stdout.write(`\r적용 ${n}/${ledgerRows.length}`);
    }
    console.log(`\r적용 완료 ${n.toLocaleString()}건`);
    writeFileSync(
      LEDGER,
      JSON.stringify(
        { note: "되돌리기 자료.", why: WHY, applied: true, rows: ledgerRows },
        null,
        1,
      ),
      "utf-8",
    );
  } finally {
    await prisma.$disconnect();
  }
}

/** 되돌리기 — **지금 값이 우리가 쓴 값일 때만** 되돌린다. */
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
      select: { reviewStatus: true, content: true },
    });
    if (!cur || cur.reviewStatus !== ReviewStatus.rejected) {
      skipped++;
      continue;
    }
    // 🔴 고쳐지지 않았는데 되돌리면 **깨진 문항이 다시 시험지에 나간다.**
    if (leaksRawLatex(cur.content)) {
      skipped++;
      continue;
    }
    if (apply) {
      await prisma.problem.update({
        where: { id: r.id },
        data: { reviewStatus: r.beforeStatus },
      });
      if (r.reportId)
        await prisma.problemReport.updateMany({
          where: { id: r.reportId, status: "open" },
          data: {
            status: "resolved",
            resolutionNote: "수식이 고쳐져 출제로 되돌렸다.",
            resolvedAt: new Date(),
          },
        });
    }
    done++;
  }
  console.log(
    `되돌리기${apply ? "" : " (드라이런)"}: ${done} · 건너뜀 ${skipped}` +
      " — 건너뛴 것은 «아직 안 고쳐졌거나 남이 바꾼 것»이다.",
  );
}

if (isDirectScript(import.meta.url)) void main();
