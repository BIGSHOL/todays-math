/**
 * 단원 오분류를 **올바른 단원으로 되돌린다** (통합 보고서 §4-B 재배정).
 *
 *   npx tsx scripts/classify/apply-unit-audit-reassign.ts                      # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign.ts     # 실제 적용
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign.ts --revert
 *
 * ## 근거: 매퍼의 열쇠를 그대로 되돌린다
 *
 * 오분류의 뿌리는 **이관 매퍼가 소단원 이름만 보고 학년을 안 본 것**이다.
 * 그래서 「같은 이름이 올바른 학년에 정확히 하나 있는」 경우가 가장 확실한 교정이다 —
 * 매퍼가 이름으로 틀린 것을 **그 이름으로** 되돌리는 것이라 추측이 끼지 않는다.
 *
 * 158건 중 그런 것이 30건이었다. 그런데 **전부 옮기면 안 된다.**
 * 육안으로 다섯 덩어리를 다 훑어 보니 이름 되돌리기는 **학년은 30/30 맞히지만
 * 소단원은 2건이 어긋났다**:
 *   · `(x²-3x-2)⁴ = a₀+a₁x+…` 항등식 문항이 「다항식의 덧셈과 뺄셈」으로 갈 뻔했다
 *   · `f(x)를 x-2로 나눈 나머지가 5` 나머지정리 문항이 「인수분해」로 갈 뻔했다
 * 공통수학1 에는 「항등식」과 「나머지와 인수정리(1)」 소단원이 따로 있다.
 * → **덩어리 규칙 + 예외 개별 지정**으로 나눴다. 규칙만 믿지 않는다.
 *
 * 나머지 128건은 동명 단원이 없어 목적지를 이름으로 못 정한다. 그것들은 §4-A 로
 * 출제 풀에서 빠진 채 남고, 목적지는 원장님이 덩어리로 확정하실 몫이다.
 *
 * 공유 Supabase 쓰기라 기본 차단이다 — `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = "scripts/classify/reports/unit-audit-consolidated.json";
const LEDGER = "scripts/classify/reports/reassign-ledger.json";

const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");
/**
 * 재배정이 끝난 것만 출제 풀에 되돌린다(`--restore-pool`).
 * §4-A 는 「목적지를 모르니 일단 뺀다」였다. 목적지를 찾아 옮겼으면 그 이유가 사라진다 —
 * 안 되돌리면 교정이 아무 효과가 없다. **§4-A 이전 값으로만** 되돌린다(원래 false 였던 것은 그대로).
 */
const RESTORE = process.argv.includes("--restore-pool");

/** 초등 소단원만 번호 접두가 붙는다(`2-2-2 이등변삼각형의 성질`). 떼야 이름이 견줘진다. */
const strip = (s: string) =>
  s.replace(/^\s*\d+(?:-\d+)*\s*[.)]?\s*/, "").trim();

/**
 * **예외 — 이름 되돌리기가 소단원을 틀리는 것들.** 육안으로 찾았다(위 주석).
 * externalId → 목적지 소단원 이름(같은 학년 안).
 */
const SECTION_OVERRIDE: Record<string, string> = {
  // 항등식 계수 문제. 「다항식의 덧셈과 뺄셈」이 아니다.
  "4496-3": "항등식",
  // 나머지정리. 「인수분해」가 아니다.
  "4496-18": "나머지와 인수정리(1)",
};

type Finding = { problemId: string; externalId: string | null };

async function main() {
  const report = JSON.parse(readFileSync(SOURCE, "utf8")) as {
    목록: Finding[];
  };
  const ids = report.목록.map((f) => f.problemId);

  const units = await prisma.unit.findMany({
    select: { id: true, grade: true, chapter: true, section: true },
  });
  const byName = new Map<string, typeof units>();
  for (const u of units) {
    const key = strip(u.section);
    if (!byName.has(key)) byName.set(key, []);
    byName.get(key)!.push(u);
  }

  const rows = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: {
      id: true,
      externalId: true,
      source: true,
      content: true,
      unitId: true,
      unit: { select: { grade: true, chapter: true, section: true } },
    },
  });

  type Move = {
    id: string;
    externalId: string | null;
    from: string;
    fromUnitId: string;
    to: string;
    toUnitId: string;
    예외: boolean;
    본문: string;
  };
  const moves: Move[] = [];
  let 동명없음 = 0;
  let 모호 = 0;
  let 이미옮김 = 0;

  /**
   * ⚠️ **멱등성 가드 — 없으면 두 번째 실행이 교정을 되돌린다.**
   * 이 규칙은 현재 DB 상태에서 「다른 학년의 동명 단원」을 찾는다. 그래서 초4→중2 로
   * 옮기고 나면 다음 실행에서는 중2→초4 가 「동명 단원」으로 보여 **도로 틀린 자리로 보낸다.**
   * (드라이런에서 실제로 그 출력이 나왔다.) 이미 옮긴 것은 원장부를 보고 건너뛴다.
   */
  const movedBefore = new Set<string>();
  try {
    const prev = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      이동: { id: string }[];
    };
    for (const m of prev.이동) movedBefore.add(m.id);
  } catch {
    // 원장부가 없으면 아직 한 번도 안 옮긴 것이다.
  }

  for (const r of rows) {
    if (movedBefore.has(r.id)) {
      이미옮김 += 1;
      continue;
    }
    const others = (byName.get(strip(r.unit.section)) ?? []).filter(
      (u) => u.grade !== r.unit.grade,
    );
    if (others.length === 0) {
      동명없음 += 1;
      continue;
    }
    if (others.length > 1) {
      모호 += 1;
      continue;
    }
    const dest = others[0];

    // 예외 지정이 있으면 같은 학년 안에서 그 소단원으로 보낸다.
    const overrideName = r.externalId
      ? SECTION_OVERRIDE[r.externalId]
      : undefined;
    const target = overrideName
      ? units.find((u) => u.grade === dest.grade && u.section === overrideName)
      : dest;
    if (!target) {
      throw new Error(
        `예외 지정한 소단원을 못 찾았다: ${dest.grade} / ${overrideName}`,
      );
    }

    moves.push({
      id: r.id,
      externalId: r.externalId,
      from: `${r.unit.grade} / ${r.unit.chapter} / ${r.unit.section}`,
      fromUnitId: r.unitId,
      to: `${target.grade} / ${target.chapter} / ${target.section}`,
      toUnitId: target.id,
      예외: Boolean(overrideName),
      본문: r.content.slice(0, 90).replace(/\s+/g, " "),
    });
  }

  console.log(
    `대상 ${rows.length}건 — 옮길 것 ${moves.length} · 이미 옮김 ${이미옮김} · 동명 없음 ${동명없음} · 모호 ${모호}`,
  );
  const byPair = new Map<string, number>();
  for (const m of moves)
    byPair.set(
      `${m.from.split(" / ")[0]}/${strip(m.from.split(" / ")[2])} → ${m.to}`,
      0,
    );
  for (const m of moves) {
    const k = `${m.from.split(" / ")[0]}/${strip(m.from.split(" / ")[2])} → ${m.to}`;
    byPair.set(k, (byPair.get(k) ?? 0) + 1);
  }
  console.log("\n이동 계획:");
  for (const [k, n] of [...byPair].sort((a, b) => b[1] - a[1]))
    console.log(`  ${String(n).padStart(3)}건  ${k}`);
  const 예외들 = moves.filter((m) => m.예외);
  if (예외들.length) {
    console.log(`\n예외 개별 지정 ${예외들.length}건:`);
    for (const m of 예외들)
      console.log(`  [${m.externalId}] → ${m.to}\n      ${m.본문}`);
  }

  if (RESTORE) {
    const moved = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      이동: { id: string; externalId: string | null; to: string }[];
    };
    const mitig = JSON.parse(
      readFileSync("scripts/classify/reports/mitigation-ledger.json", "utf8"),
    ) as { 이전상태: { id: string; directUseAllowed: boolean }[] };
    const wasAllowed = new Map(
      mitig.이전상태.map((r) => [r.id, r.directUseAllowed]),
    );
    const restore = moved.이동.filter((m) => wasAllowed.get(m.id) === true);
    console.log(
      `\n출제 풀 복구 대상: 재배정 ${moved.이동.length}건 중 §4-A 이전에 허용이던 ${restore.length}건`,
    );
    if (!APPLY) {
      console.log("드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
      return;
    }
    const res = await prisma.problem.updateMany({
      where: { id: { in: restore.map((m) => m.id) } },
      data: { directUseAllowed: true },
    });
    console.log(`복구 완료: ${res.count}건`);
    const check = await prisma.problem.count({
      where: { id: { in: restore.map((m) => m.id) }, directUseAllowed: false },
    });
    console.log(`검증: 아직 제외 상태인 것 ${check}건 (0 이어야 정상)`);
    return;
  }

  if (REVERT) {
    const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as {
      이동: { id: string; fromUnitId: string }[];
    };
    if (!APPLY) {
      console.log(`\n드라이런. 되돌릴 것 ${ledger.이동.length}건.`);
      return;
    }
    let n = 0;
    for (const m of ledger.이동) {
      await prisma.problem.update({
        where: { id: m.id },
        data: { unitId: m.fromUnitId },
      });
      n += 1;
    }
    console.log(`\n되돌리기 완료: ${n}건`);
    return;
  }

  if (!APPLY) {
    console.log("\n드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
    return;
  }

  let n = 0;
  for (const m of moves) {
    await prisma.problem.update({
      where: { id: m.id },
      data: { unitId: m.toUnitId },
    });
    n += 1;
  }
  console.log(`\n적용 완료: ${n}건`);

  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "unitId 재배정 (동명 단원 되돌리기 + 예외 개별 지정)",
        근거: SOURCE,
        옮긴건수: n,
        되돌리기:
          "ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-reassign.ts --revert",
        이동: moves,
      },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`이전 상태 기록: ${LEDGER}`);

  // 적용 후 실측 — 보고를 믿지 말고 다시 센다.
  const after = await prisma.problem.findMany({
    where: { id: { in: moves.map((m) => m.id) } },
    select: { id: true, unitId: true },
  });
  const wrong = after.filter(
    (r) => r.unitId !== moves.find((m) => m.id === r.id)!.toUnitId,
  );
  console.log(`검증: 목적지와 다른 것 ${wrong.length}건 (0 이어야 정상)`);
}

main().finally(() => prisma.$disconnect());
