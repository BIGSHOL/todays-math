/**
 * **HWP 원본으로 본문을 되찾는다** — 재추출본으로 교체 (원장님 확정 ㉡, 2026-08-19).
 *
 *   npx tsx scripts/qa/apply-hwp-rescue.ts                          # 드라이런
 *   ALLOW_HWP_RESCUE=1 npx tsx scripts/qa/apply-hwp-rescue.ts --apply
 *   ALLOW_HWP_RESCUE=1 npx tsx scripts/qa/apply-hwp-rescue.ts --revert
 *
 * ## 무엇을 고르나
 *
 * 236편의 HWP 재추출본과 맞댄 결과가 **«완전회복»** 인 행만 바꾼다 — 즉
 * 교체하면 판정이 `정상` 이 되고(보기 1..5 가 다 서고 정답이 그 자리),
 * 짝 확인(포함도)과 보기 진위 검사를 통과한 행이다(`hwpRescueRules.ts`).
 *
 * ⚠️ **R2 가 제품에 들어간 뒤**(D-58) 다시 골랐다. R2 만으로 사는 행은 여기서
 * 제외된다 — 이미 살아 있으니 건드릴 이유가 없다. 그래서 이 자의 대상은
 * 「파서로는 안 되고 **원본이 있어야** 사는 것」뿐이다.
 *
 * ## 개악 13건을 막는 가드 — **먼저 건다**
 *
 * 반대쪽 전량(성한 3,372건)에 같은 교체를 대 보면 **13건이 깨진다.** 전부 같은
 * 모양이다 — DB 는 보기 5칸인데 HWP 는 4칸 이하(9건은 추출기가 0칸)이거나 10칸이다.
 * 트랙 D 의 `judgeSignals` 가 그걸 `H6_보기손실`·`H10_HWP빈보기` 로 이미 잡는다.
 * 그래서 이 자는 **H 신호가 하나라도 있으면 교체하지 않는다.**
 * (드라이런이 그 13건이 전부 걸리는지 매번 확인해 찍는다.)
 *
 * ## 잠금은 건드리지 않는다
 *
 * 대상 상당수가 다른 트랙의 `unusable-discard-lock` 으로 `directUseAllowed=false` 다.
 * 이 자는 **본문·정답만** 바꾸고 그 컬럼은 손대지 않는다 — 같은 컬럼을 두 원장이
 * 잠그면 한쪽을 되돌릴 때 다른 쪽이 풀린다(CLAUDE.md 2026-08-18).
 */
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { isFatal, judgeAnswerChoice } from "./answerChoiceRules";
import {
  alignExam,
  buildHwpContent,
  judgeSignals,
  type Align,
  type DbRow,
  type HwpQ,
} from "./hwpJudgeRules";
import { judgeRescue } from "./hwpRescueRules";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { renderKatexSafe } from "../../src/lib/math/katexRender";
import { tokenizeMath } from "../../src/lib/math/segments";
import { mergeLedgerRows, stillApplied } from "./revertLedger";

const HWP_DIR = "scripts/qa/reports/hwp-latex";
const LEDGER = "scripts/qa/reports/hwp-rescue-apply-ledger.json";

/** KaTeX 가 못 그린 수식 개수 — `judge-hwp-replacement.ts` 와 **같은 방식**으로 센다.
 *  이 값이 없으면 H5(렌더열위)·H11·H13 가 조용히 꺼진다. */
function mathFailures(text: string): { fail: number; total: number } {
  let fail = 0;
  let total = 0;
  for (const seg of tokenizeMath(text ?? "")) {
    if (seg.type === "text") continue;
    total += 1;
    if (renderKatexSafe(seg.value, seg.type === "display").includes("math-raw"))
      fail += 1;
  }
  return { fail, total };
}

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_HWP_RESCUE !== "1") {
  throw new Error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_HWP_RESCUE=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
}

interface SourceRow {
  id: string;
  content: string;
  answer: string;
  figureUrls: string[];
  school: string | null;
  questionNumber: number | null;
  examId: string | null;
  externalId: string | null;
  score: number | null;
  problemType: string;
  unitId: string | null;
  allowed: boolean;
  review: string;
  pool: string;
}

interface LedgerRow {
  id: string;
  school: string | null;
  n: number | null;
  examId: string;
  /** 바꾸기 **전** 본문. 이게 없으면 되돌릴 수 없다. */
  before: string;
  after: string;
  verdictBefore: string;
  unitId: string | null;
  /** 잠겨 있었나 — 이 자는 잠금을 안 건드린다. 기록만 한다. */
  locked: boolean;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  /* ── 1. 추출한 편의 모든 past_exam 행을 읽는다 (잠긴 것도 포함) ─────────── */
  const examIds = existsSync(HWP_DIR)
    ? readdirSync(HWP_DIR)
        .filter((f) => f.endsWith(".json"))
        .map((f) => f.replace(/\.json$/, ""))
    : [];
  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, content, answer, figure_urls AS "figureUrls", school,
            question_number AS "questionNumber", exam_id AS "examId",
            external_id AS "externalId", score, problem_type::text AS "problemType",
            unit_id AS "unitId", direct_use_allowed AS allowed,
            review_status::text AS review, pool::text AS pool
       FROM problem
      WHERE source = 'past_exam' AND exam_id = ANY($1::text[])
      ORDER BY exam_id, question_number`,
    examIds,
  )) as SourceRow[];

  const hwpByExam = new Map<string, HwpQ[]>();
  for (const f of readdirSync(HWP_DIR).filter((x) => x.endsWith(".json"))) {
    hwpByExam.set(
      f.replace(/\.json$/, ""),
      (
        JSON.parse(readFileSync(path.join(HWP_DIR, f), "utf-8")) as {
          questions?: HwpQ[];
        }
      ).questions ?? [],
    );
  }
  const byExam = new Map<string, Map<number, DbRow>>();
  for (const r of rows) {
    if (r.questionNumber == null) continue;
    const e = String(r.examId);
    if (!byExam.has(e)) byExam.set(e, new Map());
    byExam.get(e)!.set(r.questionNumber, {
      id: r.id,
      externalId: r.externalId,
      examId: e,
      n: r.questionNumber,
      problemType: r.problemType,
      score: r.score,
      content: r.content,
      answer: r.answer,
      figs: r.figureUrls?.length ?? 0,
    });
  }
  const aligns = new Map<string, Align>();
  for (const [eid, qs] of hwpByExam) {
    const anchors = byExam.get(eid);
    if (anchors && anchors.size > 0) aligns.set(eid, alignExam(qs, anchors));
  }

  /* ── 2. 대상을 고른다 + 반대쪽에서 가드가 무엇을 막는지 같이 센다 ───────── */
  const plan: LedgerRow[] = [];
  const blocked = new Map<string, number>();
  let healthy = 0;
  let healthyHarmedWithoutGuard = 0;
  let healthyHarmBlocked = 0;
  let healthyHarmBySlot = 0;

  for (const r of rows) {
    const eid = String(r.examId);
    const qs = hwpByExam.get(eid);
    const a = aligns.get(eid);
    if (!qs || !a || a.grade === "근거없음" || r.questionNumber == null)
      continue;
    const q = qs.find((x) => x.number + a.offset === r.questionNumber);
    if (!q) continue;

    const before = judgeAnswerChoice({
      content: r.content,
      answer: r.answer,
      figureUrls: r.figureUrls ?? [],
    });
    const res = judgeRescue({
      content: r.content,
      answer: r.answer,
      figureUrls: r.figureUrls ?? [],
      score: r.score,
      hwp: q,
      alignGrade: a.grade,
    });
    const hwpContent = buildHwpContent(q);

    // 트랙 D 의 개악 방지 신호(H*). **하나라도 있으면 교체하지 않는다.**
    //
    // ⚠️ 넣는 입력이 **트랙 D 와 같아야** 한다. 처음엔 `dbQuestion` 에 본문 전체를,
    //    `dbChoices` 에 라벨 개수만큼의 더미를 넣었더니 H6(보기손실)이 헛돌아
    //    **개악 6건이 그대로 새어 나갔다.** 자에 넣는 입력이 다르면 놓침이 된다
    //    (CLAUDE.md 2026-08-18). 제품 파서가 실제로 가른 것을 그대로 넘긴다.
    const parsed = parseProblemContent(r.content);
    const dbM = mathFailures(r.content);
    const hwpM = mathFailures(hwpContent);
    const sig = judgeSignals({
      row: byExam.get(eid)!.get(r.questionNumber)!,
      hwp: q,
      dbQuestion: parsed.question,
      dbChoices: parsed.choices,
      dbMathFail: dbM.fail,
      hwpMathFail: hwpM.fail,
      dbMathTotal: dbM.total,
      hwpMathTotal: hwpM.total,
    });

    if (!isFatal(before.verdict)) {
      // ── 반대쪽: 성한 행. 교체하면 깨지는가, 그리고 가드가 막는가.
      healthy += 1;
      const wouldHarm = res.arms.HWP != null && isFatal(res.arms.HWP.verdict);
      if (wouldHarm) {
        healthyHarmedWithoutGuard += 1;
        // 원장님이 짚은 열쇠: 「DB 보기 5칸 → HWP 4칸 이하/10칸」.
        // H6 는 «4칸 미만» 만 보므로 **5→4 를 못 잡는다.** 칸 수가 달라지면 막는다.
        // 셋은 **배타적으로** 센다 — 겹쳐 세면 합이 분모를 넘어 «남는 것»이 음수가 된다.
        // 실측 19건 전량이 이 둘 중 하나다: HWP 가 **칸을 잃거나**(3→0, 5→4, 5→0),
        // 칸 수가 **달라지거나**(5→10, 뭉쳐서 늘어난 것). 「잃으면 안 바꾼다」가 본질이다.
        const slotChanged =
          res.slots.HWP < res.slots.DB ||
          (res.slots.DB >= 4 && res.slots.HWP !== res.slots.DB);
        if (sig.H.length > 0) healthyHarmBlocked += 1;
        else if (slotChanged) healthyHarmBySlot += 1;
        else
          console.log(
            `  🔴 어느 가드도 못 막는 개악: ${r.school} ${r.questionNumber} ${r.id.slice(0, 8)} ` +
              `보기 ${res.slots.DB}칸 → ${res.slots.HWP}칸 · ${res.arms.HWP!.verdict}`,
          );
      }
      continue;
    }

    if (res.rescue !== "완전회복") continue;
    if (sig.H.length > 0) {
      for (const h of sig.H) blocked.set(h, (blocked.get(h) ?? 0) + 1);
      continue;
    }
    plan.push({
      id: r.id,
      school: r.school,
      n: r.questionNumber,
      examId: eid,
      before: r.content,
      after: hwpContent,
      verdictBefore: before.verdict,
      unitId: r.unitId,
      locked: !r.allowed,
    });
  }

  console.log("## HWP 원본 회수 — 교체 계획\n");
  console.log(`추출 편 ${examIds.length} · 그 편의 DB 행 ${rows.length}`);
  console.log(
    `**교체 대상 ${plan.length}행** (그중 지금 잠겨 있는 것 ${plan.filter((p) => p.locked).length})`,
  );
  console.log(
    `
**성한 행은 계획에 못 들어간다** — 이 자는 «지금 치명»인 행만 바꾼다(구조적 차단).
` +
      `참고로 성한 ${healthy}행에 **가드 없이** 교체를 대면 ${healthyHarmedWithoutGuard}건이 깨진다 — ` +
      `H 가드 ${healthyHarmBlocked} · 「보기 칸 수가 달라짐」 ${healthyHarmBySlot} · ` +
      `남는 것 **${healthyHarmedWithoutGuard - healthyHarmBlocked - healthyHarmBySlot}**`,
  );
  if (blocked.size > 0) {
    console.log("\n치명인데 H 가드가 막은 것:");
    for (const [k, v] of [...blocked].sort((a, b) => b[1] - a[1]))
      console.log(`  ${String(v).padStart(3)}  ${k}`);
  }

  /* ── 3. D-20 — 무엇을 잃는가 (교체는 잃는 게 없어야 정상) ───────────────── */
  const byUnit = new Map<string, number>();
  for (const p of plan)
    byUnit.set(
      p.unitId ?? "(없음)",
      (byUnit.get(p.unitId ?? "(없음)") ?? 0) + 1,
    );
  console.log(
    `\nD-20 — 영향 단원 ${byUnit.size}개. **이 작업은 문항을 빼지 않는다**(본문 교체) — 정원이 줄지 않는다.`,
  );

  /* ── 4. 원장을 DB 보다 **먼저** 쓴다 ───────────────────────────────────── */
  const previous = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf-8")) as {
        rows?: LedgerRow[];
        적용됨?: boolean;
      })
    : null;
  const merged = mergeLedgerRows<LedgerRow>(previous?.rows, plan);
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "HWP 재추출본으로 본문 교체 (원장님 확정 ㉡ 2026-08-19)",
        기준시각: new Date().toISOString(),
        되돌리기:
          "ALLOW_HWP_RESCUE=1 npx tsx scripts/qa/apply-hwp-rescue.ts --revert",
        가드: "트랙 D judgeSignals 의 H 신호가 하나라도 있으면 교체하지 않는다 (H6_보기손실·H10_HWP빈보기 포함)",
        잠금은안건드림:
          "directUseAllowed 는 다른 원장(unusable-discard-lock) 소관이다",
        적용됨: stillApplied(previous?.적용됨, APPLY),
        rows: merged.rows,
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(
    `\n→ 원장 ${LEDGER} (DB 보다 먼저 · ${merged.rows.length}행, 이어받음 ${merged.carried})`,
  );

  if (!APPLY && !REVERT) {
    console.log("\n드라이런이다. 쓰려면 ALLOW_HWP_RESCUE=1 … --apply");
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const r of merged.rows) {
    // **지금 값이 우리가 아는 값일 때만** 쓴다 — 그 사이 누가 고쳤으면 그대로 둔다.
    const [from, to] = REVERT ? [r.after, r.before] : [r.before, r.after];
    n += await prisma.$executeRawUnsafe(
      `UPDATE problem SET content = $1 WHERE id = $2::uuid AND content = $3`,
      to,
      r.id,
      from,
    );
  }
  console.log(
    `${REVERT ? "되돌린" : "교체한"} 행 ${n} / ${merged.rows.length}`,
  );
  await prisma.$disconnect();
}

void main();
