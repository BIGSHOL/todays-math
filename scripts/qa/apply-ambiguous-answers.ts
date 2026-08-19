/**
 * **정답 표기가 갈리던 문항 5건을 HWP 미주로 확정한다** (원장님 위임 2026-08-19).
 *
 *   npx tsx scripts/qa/apply-ambiguous-answers.ts                       # 드라이런
 *   ALLOW_ANSWER_FIX=1 npx tsx scripts/qa/apply-ambiguous-answers.ts --apply
 *   ALLOW_ANSWER_FIX=1 npx tsx scripts/qa/apply-ambiguous-answers.ts --revert
 *
 * ## 왜 «일률 규칙»을 쓰지 않는가 — 그게 이 5건의 핵심이다
 *
 * DB 정답이 맨숫자 하나(`"4"`)인데 보기가 숫자면 **값으로도 번호로도** 읽힌다.
 * 앞 트랙은 못 정하는 것을 정한 척하지 않으려고 `모호` 로 남겼다. 옳았다 —
 * 실제로 **한 방향이 아니었다**:
 *
 *   · 정화여고 2  — 미주 `①`  → 그 `"4"` 는 **값**이다 (보기 4,5,6,7,8 의 첫 칸)
 *   · 나머지 넷    — 미주 `③⑤④③` → 그 숫자는 **번호**다
 *
 * 「늘 번호로 읽는다」로 했으면 정화여고 2번을 **④(=7)** 로 틀렸다. 그래서 규칙을
 * 만들지 않고 **행마다 미주 원문을 근거로** 적는다. 근거는 아래 표에 그대로 있다.
 *
 * ## 근거의 세기
 *
 * 다섯 행 모두 (ㄱ) 편 정렬이 `확정`, (ㄴ) **DB 보기와 HWP 보기가 글자 그대로 같고**,
 * (ㄷ) 미주가 원문자를 하나만 준다. 본문이 같다는 것이 「같은 문항」의 증거이고,
 * 미주는 본문 **밖**이라 「값이냐 번호냐」를 본문 안에서 못 가르는 것을 갈라 준다.
 *
 * ⚠️ 이 다섯은 지금 `directUseAllowed=false` 로 **잠겨 있다**(다른 트랙의
 * `unusable-discard-lock`). 정답을 고쳐도 잠금은 그대로다 — 이 자는 잠금을
 * 건드리지 않는다. 되살릴지는 그 원장이 정한다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { mergeLedgerRows, stillApplied } from "./revertLedger";

const LEDGER = "scripts/qa/reports/ambiguous-answer-ledger.json";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_ANSWER_FIX !== "1") {
  throw new Error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_ANSWER_FIX=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
}

/**
 * 행마다의 판단. **규칙이 아니라 목록이다** — 근거와 이유를 같이 적는다.
 *
 * `idPrefix` 로 찾는다(전체 uuid 는 길고, 앞 8자면 이 저장소에서 유일하다 —
 * 스크립트가 실행 시 «정확히 한 행»인지 확인한다).
 */
interface Decision {
  idPrefix: string;
  school: string;
  n: number;
  /** 지금 DB 값. 이것과 다르면 **멈춘다** — 그 사이 누가 고쳤다는 뜻이다. */
  expectBefore: string;
  /** HWP 미주 **원문**. 이게 근거다. */
  endnote: string;
  /** 확정하는 정답. */
  after: string;
  /** 왜 그 읽기인가 — 한 줄. */
  why: string;
}

const DECISIONS: Decision[] = [
  {
    idPrefix: "10f859c0",
    school: "정화여고",
    n: 2,
    expectBefore: "4",
    endnote: "① [23년 기말고사 10번]",
    after: "①",
    why: "보기가 4,5,6,7,8 인데 미주가 ① 이다 — 적혀 있던 «4» 는 번호가 아니라 **①번 보기의 값**이었다. 다섯 중 유일하게 «값» 쪽이다.",
  },
  {
    idPrefix: "37957249",
    school: "소선여중",
    n: 14,
    expectBefore: "3",
    endnote: "정답 ③",
    after: "③",
    why: "보기가 2,3,4,5,6 이라 «3» 은 값(②)으로도 읽혔지만 미주가 ③ 이다 — **번호**로 적힌 것이다(③의 값은 4).",
  },
  {
    idPrefix: "3c539406",
    school: "황금중",
    n: 5,
    expectBefore: "5",
    endnote: "정답 ⑤",
    after: "⑤",
    why: "보기가 3,4,5,6,7 이라 «5» 는 값(③)으로도 읽혔지만 미주가 ⑤ 다 — **번호**다(⑤의 값은 7).",
  },
  {
    idPrefix: "4bdb1447",
    school: "성산고",
    n: 2,
    expectBefore: "4",
    endnote: "정답 ④",
    after: "④",
    why: "보기가 3,4,5,6,7 이라 «4» 는 값(②)으로도 읽혔지만 미주가 ④ 다 — **번호**다(④의 값은 6).",
  },
  {
    idPrefix: "81f6b657",
    school: "정화여고",
    n: 12,
    expectBefore: "3",
    endnote: "③ [p137 ~ 11번]",
    after: "③",
    why: "보기가 1/3, 1/2, 3/2, 3, 6 이라 «3» 은 값(④)으로도 읽혔지만 미주가 ③ 이다 — **번호**다(③의 값은 3/2).",
  },
];

interface LedgerRow {
  id: string;
  school: string;
  n: number;
  before: string;
  after: string;
  endnote: string;
  why: string;
}

async function main(): Promise<void> {
  const prisma = new PrismaClient();

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT id, answer, school, question_number AS "questionNumber",
            direct_use_allowed AS allowed
       FROM problem
      WHERE ${DECISIONS.map((_, i) => `id::text LIKE $${i + 1}`).join(" OR ")}`,
    ...DECISIONS.map((d) => `${d.idPrefix}%`),
  )) as {
    id: string;
    answer: string;
    school: string | null;
    questionNumber: number | null;
    allowed: boolean;
  }[];

  /* ── 계획을 짠다. 어긋나는 것이 하나라도 있으면 **멈춘다.** ────────────── */
  const plan: LedgerRow[] = [];
  const skipped: string[] = [];
  for (const d of DECISIONS) {
    const hit = rows.filter((r) => r.id.startsWith(d.idPrefix));
    if (hit.length !== 1) {
      throw new Error(
        `${d.school} ${d.n}번(${d.idPrefix}): 행이 ${hit.length}개다 — 하나여야 한다.`,
      );
    }
    const row = hit[0]!;
    if (row.school !== d.school || row.questionNumber !== d.n) {
      throw new Error(
        `${d.idPrefix}: 학교·번호가 다르다 (DB ${row.school} ${row.questionNumber} ≠ 표 ${d.school} ${d.n}).`,
      );
    }
    if (row.answer === d.after) {
      skipped.push(`${d.school} ${d.n} — 이미 ${d.after}`);
      continue;
    }
    if (row.answer !== d.expectBefore) {
      throw new Error(
        `${d.school} ${d.n}번: 지금 정답이 ${JSON.stringify(row.answer)} 인데 표는 ` +
          `${JSON.stringify(d.expectBefore)} 를 기대한다 — 그 사이 누가 고쳤다. 사람이 봐야 한다.`,
      );
    }
    plan.push({
      id: row.id,
      school: d.school,
      n: d.n,
      before: row.answer,
      after: d.after,
      endnote: d.endnote,
      why: d.why,
    });
  }

  const previous = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf-8")) as {
        rows?: LedgerRow[];
        적용됨?: boolean;
      })
    : null;
  const merged = mergeLedgerRows<LedgerRow>(previous?.rows, plan);

  console.log("## 정답 표기가 갈리던 문항 — HWP 미주로 확정\n");
  console.log("| 문항 | 지금 | → | HWP 미주 (근거) | 왜 |");
  console.log("| --- | :-: | :-: | --- | --- |");
  for (const r of merged.rows)
    console.log(
      `| ${r.school} ${r.n} \`${r.id.slice(0, 8)}\` | \`${r.before}\` | **${r.after}** | \`${r.endnote}\` | ${r.why} |`,
    );
  for (const s of skipped) console.log(`\n(건너뜀) ${s}`);
  console.log(
    `\n이번 계획 ${plan.length}행 · 원장에서 이어받음 ${merged.carried}행 · 잠긴 행 ${rows.filter((r) => !r.allowed).length}/${rows.length}`,
  );

  /* ── 되돌리기 원장을 **DB 보다 먼저** 쓴다 ──────────────────────────────── */
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "정답 표기가 갈리던 5건을 HWP 미주로 확정 (원장님 위임 2026-08-19)",
        기준시각: new Date().toISOString(),
        되돌리기:
          "ALLOW_ANSWER_FIX=1 npx tsx scripts/qa/apply-ambiguous-answers.ts --revert",
        일률규칙아님:
          "정화여고 2번만 «값», 나머지 넷은 «번호» 다. 행마다 미주 원문이 근거다.",
        적용됨: stillApplied(previous?.적용됨, APPLY),
        rows: merged.rows,
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(`→ 원장 ${LEDGER} (DB 보다 먼저 썼다)`);

  if (!APPLY && !REVERT) {
    console.log("\n드라이런이다. 쓰려면 ALLOW_ANSWER_FIX=1 … --apply");
    await prisma.$disconnect();
    return;
  }

  /* ── 쓴다 ───────────────────────────────────────────────────────────────── */
  let n = 0;
  for (const r of merged.rows) {
    if (REVERT) {
      // **지금 값이 우리가 쓴 값일 때만** 되돌린다 — 그 사이 누가 고쳤으면 그대로 둔다.
      const res = await prisma.$executeRawUnsafe(
        `UPDATE problem SET answer = $1 WHERE id = $2::uuid AND answer = $3`,
        r.before,
        r.id,
        r.after,
      );
      n += res;
    } else {
      const res = await prisma.$executeRawUnsafe(
        `UPDATE problem SET answer = $1 WHERE id = $2::uuid AND answer = $3`,
        r.after,
        r.id,
        r.before,
      );
      n += res;
    }
  }
  console.log(`${REVERT ? "되돌린" : "고친"} 행 ${n}`);
  await prisma.$disconnect();
}

void main();
