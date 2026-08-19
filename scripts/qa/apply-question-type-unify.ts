/**
 * 시험지 원본이 **`서답형`** 이라 찍은 문항을 `questionType = 서술형` 으로 통일한다.
 *
 *   npx tsx scripts/qa/apply-question-type-unify.ts                      드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-question-type-unify.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-question-type-unify.ts --revert
 *
 * 원장님 확정(2026-08-19, D-57): 「서답형 → 서술형 으로 전부. 단답형은 그대로.」
 * 2차(2026-08-19): 머리표가 **`[서술형]`** 인데 DB 가 객관식인 4건도 고치기로 확정.
 *
 * ## 왜 고칠 것이 남아 있나
 *
 * 적재는 대체로 `서답형` 을 `서술형` 으로 합쳐 넣었다. 그런데 HWP 추출기의
 * `type` 이 `단답형` 인 행은 그 값이 그대로 들어가, **시험지는 `[서답형 n]` 이라
 * 찍었는데 DB 는 `단답형`** 인 행이 남았다. 그대로 두면 지면에 **「단답형 n」**
 * 이라고 나간다(D-57 로 단답형 배지가 생겼으니 이제 눈에 보인다).
 *
 * ## 판정 근거는 **셋**이다 — 한 컬럼만 보지 않는다
 *
 *   ㉠ 시험지 머리표가 `[서답형 n]` 이다 (본문 밖 근거)
 *   ㉡ 지면 보기가 **0칸**이다
 *   ㉢ 기록된 정답이 **보기 번호가 아니다**
 *
 * 실측 30건 전량이 셋을 모두 만족한다(눈으로 확인). 하나라도 어긋나면 **안 고친다** —
 * 머리표는 묶음 제목일 수 있고, 그때 보기가 남아 있으면 객관식이다.
 *
 * ## 무엇을 안 고치나
 *
 *   · 머리표가 `[단답형]` 인 15건 — 원장님이 **그대로 두라** 하셨다.
 *   원본 어휘 셋 중 `단답형` 만 우리 값과 이름이 같고, 나머지 둘은 **모두 `서술형`
 *   으로 모인다.**
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import { mergeLedgerRows, stillApplied } from "./revertLedger";

const prisma = new PrismaClient();

/** HWP 추출 산출물이 있는 곳. 다른 워크트리가 만든 것이라 없을 수 있다. */
const HWP_DIR =
  process.env.HWP_REPORTS ??
  "C:/Users/user/orca/workspaces/testautocreator/기출원본회수/scripts/qa/reports";
const LEDGER = "scripts/qa/reports/question-type-unify-ledger.json";

const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

if ((APPLY || REVERT) && process.env.ALLOW_UNIT_FIX !== "1") {
  console.error(
    "공유 DB 쓰기가 막혀 있다(D-31). ALLOW_UNIT_FIX=1 과 --apply(또는 --revert) 가 둘 다 필요하다.",
  );
  process.exit(1);
}

export interface HwpQuestion {
  number: number;
  label?: string | null;
  type?: string | null;
  choices?: string[] | null;
}

export interface DbRow {
  id: string;
  questionType: string | null;
  /** 기록된 정답 — «객관식인가» 를 가르는 열쇠다(`questionType` 이 아니다). */
  answer: string;
  school: string | null;
  questionNumber: number | null;
}

export interface UnifiedRow {
  id: string;
  /** 고치기 **전** 값. 이게 없으면 되돌릴 수 없다. */
  questionType: string | null;
  school: string | null;
  questionNumber: number | null;
  머리표: string;
  exam: string;
}

/** 시험지 머리표에서 원본 어휘 셋 중 하나를 읽는다. 없으면 빈 문자열. */
export function readMark(label: string | null | undefined): string {
  const s = label ?? "";
  if (s.includes("단답")) return "단답형";
  if (s.includes("서답")) return "서답형";
  if (s.includes("서술")) return "서술형";
  return "";
}

/**
 * 정답이 **보기 번호**인가 — 즉 이 문항이 객관식인가.
 * `questionType` 을 쓰면 안 된다: 정답이 `①` 인데 «서술형» 이라 적힌 행이 있다.
 */
export function isChoiceAnswer(answer: string | null | undefined): boolean {
  return /^\s*[①-⑮1-5](\s*[,·]\s*[①-⑮1-5])*\s*$/u.test((answer ?? "").trim());
}

export type Decision = { fix: true } | { fix: false; reason: string };

export function decideUnify(
  mark: string,
  hwp: HwpQuestion | undefined,
  row: DbRow | undefined,
): Decision {
  // ㉠ 시험지가 «서답형» 또는 «서술형» 이라 한 것만 고친다 — 둘은 `서술형` 으로 모인다.
  //    «단답형» 은 원장님이 **그대로 두라** 하셨다.
  if (mark !== "서답형" && mark !== "서술형")
    return {
      fix: false,
      reason: `머리표가 서답형·서술형이 아니다 (${mark || "없음"})`,
    };
  if (!hwp) return { fix: false, reason: "HWP 문항을 못 찾았다" };
  if (!row) return { fix: false, reason: "DB 에 그 행이 없다" };
  // ㉡ 보기가 남아 있으면 객관식이다 — 머리표가 묶음 제목이었던 것이다.
  if ((hwp.choices?.length ?? 0) > 0)
    return {
      fix: false,
      reason: "지면에 보기가 있다 (머리표가 묶음 제목일 수 있다)",
    };
  // ㉢ 정답이 보기 번호면 객관식이다.
  if (isChoiceAnswer(row.answer))
    return { fix: false, reason: "정답이 보기 번호다 (객관식)" };
  // 이미 서술형이면 그대로 둔다 (멱등).
  if (row.questionType === "서술형")
    return { fix: false, reason: "이미 서술형이다 (멱등)" };
  return { fix: true };
}

export type RevertDecision =
  { restore: true; to: string | null } | { restore: false; reason: string };

/** 되돌리기는 **지금 값이 우리가 쓴 값(서술형)일 때만** 한다. */
export function revertUnify(
  row: UnifiedRow,
  now: { questionType: string | null } | undefined,
): RevertDecision {
  if (!now) return { restore: false, reason: "DB 에 그 행이 없다" };
  if (now.questionType !== "서술형")
    return {
      restore: false,
      reason: "우리가 쓴 값이 아니다 — 남의 변경을 덮지 않는다",
    };
  return { restore: true, to: row.questionType };
}

/* ── 실행 ────────────────────────────────────────────────────────────── */

interface Verdict {
  id?: string;
  examId?: string | number;
  hwpNumber?: number;
}

function loadMarks(): {
  id: string;
  mark: string;
  hwp: HwpQuestion;
  exam: string;
}[] {
  const vf = `${HWP_DIR}/hwp-verdicts.jsonl`;
  if (!existsSync(vf))
    throw new Error(
      `HWP 대장이 없다: ${vf}\n` +
        `이 산출물은 다른 워크트리가 만든다. HWP_REPORTS=<경로> 로 지정할 수 있다.`,
    );
  const rows = readFileSync(vf, "utf-8")
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as Verdict)
    .filter((v) => v.id);
  const cache = new Map<string, Map<number, HwpQuestion>>();
  const out: { id: string; mark: string; hwp: HwpQuestion; exam: string }[] =
    [];
  for (const v of rows) {
    const ex = String(v.examId);
    if (!cache.has(ex)) {
      const f = `${HWP_DIR}/hwp-latex/${ex}.json`;
      const j = existsSync(f)
        ? (JSON.parse(readFileSync(f, "utf-8")) as {
            questions?: HwpQuestion[];
          })
        : { questions: [] };
      cache.set(ex, new Map((j.questions ?? []).map((q) => [q.number, q])));
    }
    const hwp = cache.get(ex)!.get(Number(v.hwpNumber));
    const mark = readMark(hwp?.label);
    if (mark && hwp) out.push({ id: String(v.id), mark, hwp, exam: ex });
  }
  return out;
}

async function fetchRows(ids: string[]): Promise<Map<string, DbRow>> {
  const out = new Map<string, DbRow>();
  for (let i = 0; i < ids.length; i += 500)
    for (const r of await prisma.problem.findMany({
      where: { id: { in: ids.slice(i, i + 500) } },
      select: {
        id: true,
        questionType: true,
        answer: true,
        school: true,
        questionNumber: true,
      },
    }))
      out.set(r.id, r);
  return out;
}

async function revert() {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
    이전상태: UnifiedRow[];
  };
  const rows = await fetchRows(ledger.이전상태.map((r) => r.id));
  let restored = 0;
  let untouched = 0;
  for (const row of ledger.이전상태) {
    const d = revertUnify(row, rows.get(row.id));
    if (!d.restore) {
      untouched += 1;
      continue;
    }
    await prisma.problem.update({
      where: { id: row.id },
      data: { questionType: d.to },
    });
    restored += 1;
  }
  console.log(
    `되돌림 ${restored}행 · 값이 달라 건드리지 않음 ${untouched}행 (남의 변경을 덮지 않는다)`,
  );
}

async function main() {
  if (REVERT) {
    await revert();
    await prisma.$disconnect();
    return;
  }

  const marks = loadMarks();
  const rows = await fetchRows(marks.map((m) => m.id));

  // 🔴 분모를 먼저 찍는다. 「고칠 것 + 건너뜀」이 이 수와 안 맞으면 범위가 샌 것이다.
  const 대상 = marks.filter(
    (m) => m.mark === "서답형" || m.mark === "서술형",
  ).length;
  console.log(
    `  분모 검산 — 머리표가 있는 행 ${marks.length} · 그중 «서답형·서술형» ${대상}`,
  );

  const todo: UnifiedRow[] = [];
  const skipped = new Map<string, number>();
  for (const m of marks) {
    const d = decideUnify(m.mark, m.hwp, rows.get(m.id));
    if (d.fix) {
      const row = rows.get(m.id)!;
      todo.push({
        id: row.id,
        questionType: row.questionType,
        school: row.school,
        questionNumber: row.questionNumber,
        머리표: m.hwp.label ?? "",
        exam: m.exam,
      });
    } else if (m.mark === "서답형" || m.mark === "서술형") {
      skipped.set(d.reason, (skipped.get(d.reason) ?? 0) + 1);
    }
  }

  const skippedTotal = [...skipped.values()].reduce((a, b) => a + b, 0);
  if (todo.length + skippedTotal !== 대상)
    throw new Error(
      `범위가 샜다 — 고칠 것 ${todo.length} + 건너뜀 ${skippedTotal} 이 대상 ${대상} 과 안 맞는다.`,
    );

  console.log(
    `── 서답형·서술형 → questionType 서술형 통일 ${APPLY ? "(적용)" : "(드라이런)"} ──`,
  );
  console.log(`  고칠 것  ${todo.length}건`);
  for (const [r, n] of [...skipped.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  건너뜀 ${String(n).padStart(4)}  ${r}`);

  const before = new Map<string, number>();
  for (const r of todo)
    before.set(
      r.questionType ?? "(없음)",
      (before.get(r.questionType ?? "(없음)") ?? 0) + 1,
    );
  console.log(`\n  [지금 값 → 서술형]`);
  for (const [k, n] of before) console.log(`  ${String(n).padStart(6)}  ${k}`);
  console.log(`\n  [표본]`);
  for (const r of todo.slice(0, 5))
    console.log(
      `   · ${r.school ?? "?"} ${r.exam}-${r.questionNumber ?? "?"}번 · 머리표 ${r.머리표}`,
    );

  // 원장을 **먼저** 쓴다. 덮어쓰지 않고 이어 쓴다(`revertLedger.ts`).
  const previous = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf8")) as {
        이전상태?: UnifiedRow[];
        적용됨?: boolean;
      })
    : null;
  const merged = mergeLedgerRows(previous?.이전상태, todo);
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "시험지 원본이 «서답형» 인 문항을 questionType=서술형 으로 통일 — 원장님 확정 2026-08-19 (D-57)",
        기준시각: new Date().toISOString(),
        되돌리기:
          "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-question-type-unify.ts --revert",
        적용됨: stillApplied(previous?.적용됨, APPLY),
        고친건수: merged.rows.length,
        이번계획: todo.length,
        이어받음: merged.carried,
        이전상태: merged.rows,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`\n  원장 → ${LEDGER} · 이번 계획 ${todo.length}행`);

  if (!APPLY) {
    console.log(
      `\n드라이런이다 — DB 를 한 건도 안 썼다.\n` +
        `적용하려면: ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-question-type-unify.ts --apply`,
    );
    await prisma.$disconnect();
    return;
  }

  let n = 0;
  for (const r of todo) {
    // 계획을 세울 때 본 값과 지금 값이 같을 때만 쓴다 — 그 사이 남이 바꿨으면 건너뛴다.
    const { count } = await prisma.problem.updateMany({
      where: { id: r.id, questionType: r.questionType },
      data: { questionType: "서술형" },
    });
    n += count;
  }
  console.log(`\n  고쳤다: ${n}건`);
  if (n !== todo.length)
    console.log(
      `  ⚠️ 계획 ${todo.length} 과 다르다 — 그 사이 ${todo.length - n}행을 다른 세션이 바꿨다.`,
    );
  await prisma.$disconnect();
}

if (process.argv[1]?.includes("apply-question-type-unify")) void main();
