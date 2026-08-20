/**
 * 중2 **「다항식의 곱셈과 나눗셈」(J20108) 재배정** — 옆 소단원에 앉은 문항을 제자리로.
 *
 *   npx tsx scripts/classify/apply-polynomial-unit-fix.ts              # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-polynomial-unit-fix.ts --apply
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-polynomial-unit-fix.ts --revert
 *
 * ## 왜 필요한가
 *
 * 2026-08-20, 중복 삭제 2차의 D-20 집계가 「J20108: 3 → 1」을 알렸다. 열어 보니 그 2행마저
 * **남의 단원 문항**(중3 제곱근·피타고라스)이라 **이 단원의 제 문항은 0개**였다.
 * 원장님 지적: 「2학년 1학기 중간고사 위주로 기출에 많았을 텐데」 — 맞다. 「1. 수와 식」
 * 전체에 기출 2,053건이 들어와 있는데 **마지막 소단원만 0**이었다. 문항이 없는 게 아니라
 * **옆 소단원에 앉아 있었다.**
 *
 * ## 판정 — 「무엇이 곱해지는가」
 *
 * 중2 J20108 은 **(단항식)×(다항식)** 과 **(다항식)÷(단항식)** 이다. 그래서:
 *   · 괄호 앞이 **계수뿐**(`3(x+1)`)이면 J20107 덧셈·뺄셈의 분배법칙이다 — 안 옮긴다.
 *   · 괄호 앞에 **문자**가 있으면(`3x(x+1)`) J20108 이다.
 *   · 나누는 식에 **문자**가 있어야(`(6x+3)÷3x`) J20108 이다. `÷3` 은 덧셈·뺄셈 쪽이다.
 *   · **(다항식)×(다항식)** 은 중3 곱셈공식이라 뺀다.
 *
 * ## 규칙을 만들며 실제로 걸린 함정 셋 (전부 표본을 눈으로 봐서 나왔다)
 *
 * ⑴ **음수 단항식이 괄호 때문에 다항식으로 읽혔다.** `(-2a^{2}b)` 안에 `-` 가 있어
 *    「항이 둘」로 잡혔고, 그 바람에 J20106 지수법칙 문항이 대거 딸려 왔다(128 → 114).
 *    부호가 **맨 앞이 아닌** 자리에 있어야 다항식이다.
 * ⑵ **보기(선택지) 안의 식이 판정을 뒤집었다.** 「다음 중 옳지 않은 것은?」류는 보기마다
 *    다른 단원의 식이 들어 있다. **발문만** 본다(114 → 100). 발문에 식이 없으면 그 문항이
 *    무엇을 묻는지 본문이 말해 주지 않는 것이라 **안 옮긴다**(보수적).
 * ⑶ 발문 안의 `보기` 상자도 같은 이유로 잘라 낸다(100 → 96).
 *
 * ## 반대쪽 모집단
 *
 * 중3 J30201 「다항식의 곱셈」 689건에 같은 규칙을 대면 10건(1.5%)만 걸린다 —
 * 곱셈공식은 (다항식)×(다항식)이라 구조적으로 갈린다. 중3 단원은 **안 건드린다.**
 *
 * ## 눈으로 본 것
 *
 * 후보 96건을 **전량** 눈으로 봤다. 오탐 1건(`J20106-BBEQ`)만 손으로 뺀다 —
 * 근거는 아래 `REVIEWED_EXCLUDE` 에 적는다.
 *
 * 공유 Supabase 쓰기라 기본 차단이다 — `ALLOW_UNIT_FIX=1` + `--apply` 둘 다 있어야 쓴다(D-31).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { isDirectScript } from "../import/isDirectScript";

const prisma = new PrismaClient();

const LEDGER = "scripts/classify/reports/polynomial-unit-ledger.json";
const TARGET = "J20108";
/** 옮겨 오는 곳 — 같은 중단원 「1. 수와 식」 안에서만. 중3은 안 건드린다. */
export const SOURCE_UNITS = ["J20104", "J20106", "J20107"] as const;

/**
 * 눈으로 보고 **뺀** 문항. 규칙이 잡았지만 사람이 보니 다른 단원 것이다.
 * 근거를 여기 적는다 — 다음 사람이 왜 뺐는지 알 수 있어야 한다.
 */
export const REVIEWED_EXCLUDE: Record<string, string> = {
  "J20106-BBEQ":
    "지수법칙 문항이다(X=2^a 일 때 P(X)=a). 발문에 낀 (m-2)÷162m 만 규칙에 걸렸다.",
};

const bare = (s: string) =>
  (s ?? "")
    .replace(/\\left|\\right|\\,|\\;|\\!|\s/g, "")
    .replace(/\\times/g, "×")
    .replace(/\\div/g, "÷")
    .replace(/[$]/g, "");

/** 다른 단원의 주제어 — 있으면 그 단원 것이다. */
const OTHER_TOPIC =
  /부등식|연립|일차방정식|이차방정식|함수|그래프|순환소수|기약분수|유한소수|소수로\s*나타내|소수점|소숫점|확률|경우의\s*수|삼각형|사각형|평행사변형|합동|닮음|피타고라스|도수|평균|중앙값|산점도|인수분해/;

/**
 * 「괄호 안이 다항식」 — 부호가 **맨 앞이 아닌** 자리에 있어야 항이 둘이다.
 * `(-2a^{2}b)` 는 음수 단항식이지 다항식이 아니다(함정 ⑴).
 */
const POLY = String.raw`\((?:[^()+\-][^()]*)?[^()+\-][+\-][^()]*\)`;
const MONO_TIMES_POLY = new RegExp(
  String.raw`(^|[=+\-×÷({\[])\s*-?[0-9]*[a-zA-Z](\^\{?[0-9]+\}?)?\s*×?\s*` +
    POLY,
);
const POLY_DIV_MONO = new RegExp(
  POLY + String.raw`\s*÷\s*\(?\s*-?[0-9]*[a-zA-Z]`,
);
const TWO_POLY = new RegExp(POLY + String.raw`\s*×?\s*` + POLY);

/** 발문에서 「보기」 상자를 잘라 낸다 — 보기의 식은 발문이 아니다(함정 ⑶). */
export function stemOf(content: string): string {
  return parseProblemContent(content).question.split(
    /<\s*보\s*기\s*>|＜\s*보\s*기\s*＞/,
  )[0]!;
}

/** 이 문항이 「(단항식)×(다항식) · (다항식)÷(단항식)」인가. */
export function isPolyTimesMono(content: string): boolean {
  /**
   * ⚠️ 주제어도 **발문에서만** 본다 — 해설·정답에 낀 낱말이 발문과 무관하게 판정을
   *    뒤집지 않게. (실측으로는 결과가 같다: 이 가드가 막는 1행 `J20107-BLD4` 는
   *    ⑴이 다항식 나눗셈이고 ⑵가 「유한소수인지 순환소수인지 판별」이라 **두 단원에
   *    걸친 문항**이다. 발문만 봐도 그대로 막힌다 — 막는 것이 맞다.)
   */
  const stem = stemOf(content);
  if (OTHER_TOPIC.test(stem)) return false;
  const b = bare(stem);
  if (TWO_POLY.test(b)) return false;
  return MONO_TIMES_POLY.test(b) || POLY_DIV_MONO.test(b);
}

interface LedgerRow {
  id: string;
  code: string;
  fromUnitId: string;
  fromUnit: string;
  toUnitId: string;
  head: string;
}
interface Ledger {
  note: string;
  applied: boolean;
  rows: LedgerRow[];
}

function readLedger(): Ledger {
  if (!existsSync(LEDGER)) return { note: "", applied: false, rows: [] };
  return JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;
}

/** 옛 행을 **지우지 않는다** — 지우면 되돌릴 수 없게 된다. */
export function mergeLedgerRows(
  old: readonly LedgerRow[],
  next: readonly LedgerRow[],
): LedgerRow[] {
  const byId = new Map(old.map((r) => [r.id, r]));
  for (const r of next) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()];
}

function writeLedger(l: Ledger) {
  mkdirSync(path.dirname(LEDGER), { recursive: true });
  writeFileSync(LEDGER, JSON.stringify(l, null, 2) + "\n", "utf8");
}

async function main() {
  const APPLY =
    process.argv.includes("--apply") && process.env.ALLOW_UNIT_FIX === "1";
  const REVERT = process.argv.includes("--revert");

  const units = (await prisma.$queryRawUnsafe(
    `SELECT id, problem_code_prefix AS code, section FROM unit
      WHERE problem_code_prefix = ANY($1::text[])`,
    [TARGET, ...SOURCE_UNITS],
  )) as Array<{ id: string; code: string; section: string }>;
  const target = units.find((u) => u.code === TARGET)?.id;
  if (!target) throw new Error(`${TARGET} 단원을 못 찾았다 — 멈춘다.`);

  if (REVERT) {
    const ledger = readLedger();
    if (!ledger.applied) {
      console.log("적용된 적이 없다 — 되돌릴 것이 없다.");
      return;
    }
    let back = 0;
    let skipped = 0;
    for (const r of ledger.rows) {
      // 지금 값이 **자기가 쓴 값일 때만** 되돌린다 — 남이 그 사이 옮겼으면 안 건드린다.
      const res = await prisma.problem.updateMany({
        where: { id: r.id, unitId: r.toUnitId },
        data: { unitId: r.fromUnitId },
      });
      if (res.count > 0) back += 1;
      else skipped += 1;
    }
    writeLedger({ ...ledger, applied: false });
    console.log(`되돌림 ${back}행 · 건너뜀 ${skipped}행(지금 값이 달라졌다)`);
    return;
  }

  const rows = (await prisma.$queryRawUnsafe(
    `SELECT p.id, p.problem_code AS code, p.content, un.problem_code_prefix AS unit,
            un.id AS "unitId"
       FROM problem p JOIN unit un ON un.id = p.unit_id
      WHERE un.problem_code_prefix = ANY($1::text[]) ORDER BY p.problem_code`,
    [...SOURCE_UNITS],
  )) as Array<{
    id: string;
    code: string;
    content: string;
    unit: string;
    unitId: string;
  }>;

  const matched = rows.filter((r) => isPolyTimesMono(r.content));
  const excluded = matched.filter((r) => REVIEWED_EXCLUDE[r.code]);
  const move = matched.filter((r) => !REVIEWED_EXCLUDE[r.code]);

  console.log(`\n── 중2 「다항식의 곱셈과 나눗셈」 재배정 ──`);
  console.log(
    `훑은 문항 ${rows.length.toLocaleString()}행 (${SOURCE_UNITS.join(" · ")})`,
  );
  const byUnit = new Map<string, number>();
  for (const r of move) byUnit.set(r.unit, (byUnit.get(r.unit) ?? 0) + 1);
  console.log(
    `규칙에 걸린 것 ${matched.length} · 눈으로 뺀 것 ${excluded.length} · **옮길 것 ${move.length}**`,
  );
  for (const [k, v] of [...byUnit].sort((a, b) => b[1] - a[1]))
    console.log(`   ${k} → ${TARGET}  ${v}행`);
  for (const r of excluded)
    console.log(`   [뺌] ${r.code} — ${REVIEWED_EXCLUDE[r.code]}`);

  /** 분모 검산 — 셋의 합이 규칙에 걸린 수와 안 맞으면 멈춘다. */
  if (move.length + excluded.length !== matched.length)
    throw new Error("분모가 안 맞는다 — 멈춘다.");

  const before = (await prisma.$queryRawUnsafe(
    `SELECT un.problem_code_prefix AS code, un.section, count(*)::int AS n
       FROM problem p JOIN unit un ON un.id = p.unit_id
      WHERE un.problem_code_prefix = ANY($1::text[]) GROUP BY 1,2`,
    [TARGET, ...SOURCE_UNITS],
  )) as Array<{ code: string; section: string; n: number }>;
  console.log(`\n[D-20 무엇을 잃나]`);
  for (const b of before.sort((x, y) => x.code.localeCompare(y.code))) {
    const out = byUnit.get(b.code) ?? 0;
    const after = b.code === TARGET ? b.n + move.length : b.n - out;
    const mark = after < 8 ? "  ⚠️ 정원(8) 아래" : "";
    console.log(
      `   ${b.code} ${String(b.section).slice(0, 24).padEnd(26)} ${String(b.n).padStart(4)} → ${String(after).padStart(4)}${mark}`,
    );
  }

  if (!APPLY) {
    console.log(`\n드라이런이다. 실제로 옮기려면 ALLOW_UNIT_FIX=1 … --apply`);
    return;
  }

  // 🔴 원장을 **DB 보다 먼저** 쓴다.
  const ledger = readLedger();
  const next: LedgerRow[] = move.map((r) => ({
    id: r.id,
    code: r.code,
    fromUnitId: r.unitId,
    fromUnit: r.unit,
    toUnitId: target,
    head: r.content.replace(/\s+/g, " ").slice(0, 80),
  }));
  const merged = mergeLedgerRows(ledger.rows, next);
  writeLedger({
    note:
      "중2 J20108 재배정. 되돌리기: ALLOW_UNIT_FIX=1 npx tsx " +
      "scripts/classify/apply-polynomial-unit-fix.ts --revert",
    applied: true,
    rows: merged,
  });
  console.log(`\n원장 ${merged.length}행 → ${LEDGER}`);

  let moved = 0;
  for (const r of next) {
    const res = await prisma.problem.updateMany({
      where: { id: r.id, unitId: r.fromUnitId },
      data: { unitId: r.toUnitId },
    });
    moved += res.count;
  }
  console.log(`옮김 ${moved}행`);
}

/**
 * ⚠️ **직접 실행할 때만 돈다.** 테스트가 판정 함수를 import 하는데, 가드가 없으면
 *    그때마다 `main()` 이 돌아 공유 DB 를 친다(단위 테스트가 DB 를 치면 안 된다).
 */
if (isDirectScript(import.meta.url)) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
