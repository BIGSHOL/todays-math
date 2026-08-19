/**
 * 그림 유실 문항을 **출제 풀에서 뺀다** (`directUseAllowed = false`).
 *
 *   npx tsx scripts/qa/apply-missing-figure-lock.ts                 # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert --recovered
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert --reclassified
 *
 * ## 왜 잠그나
 *
 * 본문이 「오른쪽 그림과 같은 평행사변형 ABCD 에서…」라고 하는데 `figureUrls` 도
 * `figureSvg` 도 비어 있으면, 그 문항은 지면에 **그림 없이** 나간다. 학생은 못 푼다.
 * 단원이 맞든 틀리든 상관없다 — 물어야 할 것은 「어느 단원인가」가 아니라 「쓸 수 있는가」다.
 *
 * ⚠️ `directUseAllowed` 를 새로 잠그려면 원장님 확인이 필요하다(스키마 주석).
 *    **2026-08-18 원장님 지시로 이 결함군에 한해 잠근다.** 회수되는 대로 되돌린다.
 *
 * ## 되돌리기가 회수 절차의 일부다
 *
 * 그림을 되붙이면 이 문항은 더 이상 유실이 아니다. 그래서 `--revert` 는 원장을 통째로
 * 되돌리는 것 말고 **`--recovered` 로 「이제 그림이 있는 것만」 골라 푸는 길**도 준다.
 * 회수 → 해제가 한 명령이라야 회수분이 풀에 안 돌아오는 사고가 안 난다.
 *
 * 진행 상황은 `docs/planning/16-figure-recovery-ledger.md` 에 누적한다.
 * 공유 Supabase 쓰기라 기본은 차단이다 — `ALLOW_UNIT_FIX=1` 일 때만 쓴다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

import {
  classifyFigureNeed,
  MENTIONS_FIGURE_WHERE,
  NO_FIGURE_WHERE,
} from "../../src/lib/figure/missingFigureRule";

const prisma = new PrismaClient();

const LEDGER = "scripts/qa/reports/missing-figure-lock.json";
const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");
/** 원장에 있던 것 중 **이제 그림이 붙은** 문항만 푼다. 회수 직후에 쓴다. */
const RECOVERED_ONLY = process.argv.includes("--recovered");
/**
 * 원장에 있던 것 중 **판정 규칙이 바뀌어 더는 「유실」이 아닌** 문항을 푼다.
 * 오탐을 잠근 채 두면 멀쩡한 문항이 조용히 출제에서 빠진다 —
 * 실측: 「상자그림에서 상자 내부의 선은 무엇을 나타내는가」 2건이 그랬다.
 * 규칙을 고쳤으면 잠금도 같이 풀어야 한다.
 */
const RECLASSIFIED_ONLY = process.argv.includes("--reclassified");

type Ledger = {
  적용: string;
  기준시각: string;
  되돌리기: string;
  잠근건수: number;
  /** 잠그기 전 상태. 이게 없으면 되돌릴 수 없다. */
  이전상태: {
    id: string;
    externalId: string | null;
    directUseAllowed: boolean;
  }[];
};

async function lock() {
  const rows = await prisma.problem.findMany({
    where: { ...MENTIONS_FIGURE_WHERE, ...NO_FIGURE_WHERE },
    select: {
      id: true,
      externalId: true,
      directUseAllowed: true,
      content: true,
    },
    orderBy: { id: "asc" },
  });
  const broken = rows.filter((r) => classifyFigureNeed(r.content) === "유실");
  const todo = broken.filter((r) => r.directUseAllowed);

  console.log(
    `그림 유실 ${broken.length}건 · 그중 아직 출제 가능 ${todo.length}건`,
  );
  if (todo.length === 0) {
    console.log("잠글 것이 없다 — 이미 적용돼 있다.");
    return;
  }
  if (!APPLY) {
    console.log("\n드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
    return;
  }

  // 이미 원장이 있으면 **합친다** — 회수/재잠금을 여러 번 돌려도 최초 상태를 잃지 않는다.
  const prev: Ledger["이전상태"] = existsSync(LEDGER)
    ? (JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger).이전상태
    : [];
  const seen = new Set(prev.map((p) => p.id));
  const merged = [
    ...prev,
    ...todo
      .filter((r) => !seen.has(r.id))
      .map((r) => ({
        id: r.id,
        externalId: r.externalId,
        directUseAllowed: r.directUseAllowed,
      })),
  ];

  const ledger: Ledger = {
    적용: "그림 유실 문항 출제 제외 (directUseAllowed=false)",
    기준시각: new Date().toISOString(),
    되돌리기:
      "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert",
    잠근건수: merged.length,
    이전상태: merged,
  };
  // **원장을 먼저 쓴다.** 반대 순서로 두면 쓰기와 기록 사이에서 죽었을 때 되돌릴 근거가
  // 사라진다 — 공유 DB 를 바꿔 놓고 undo 가 없는 상태다(적대적 리뷰 지적).
  // 원장이 앞서 있으면 최악이라도 «안 잠긴 것이 원장에 있다» 뿐이고, 그건 무해하다.
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), "utf8");

  const { count } = await prisma.problem.updateMany({
    where: { id: { in: todo.map((r) => r.id) } },
    data: { directUseAllowed: false },
  });
  console.log(`\n잠갔다: ${count}건 (누적 ${merged.length}). 원장 → ${LEDGER}`);
}

async function revert() {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;

  let targets = ledger.이전상태;
  if (RECLASSIFIED_ONLY) {
    // ⚠️ 본문만 보고 풀면 안 된다. `content` 는 다른 트랙이 고칠 수 있고, 예외 낱말이
    // 하나 섞여 들어오는 것만으로 **그림이 여전히 없는 문항이 풀린다**(적대적 리뷰 지적).
    // 그래서 그림이 실제로 없으면서 유실 판정인 행은 무조건 잠근 채로 둔다.
    const rows = await prisma.problem.findMany({
      where: { id: { in: targets.map((t) => t.id) } },
      select: { id: true, content: true, figureUrls: true, figureSvg: true },
    });
    const keepLocked = new Set(
      rows
        .filter(
          (r) =>
            r.figureUrls.length === 0 &&
            r.figureSvg === null &&
            classifyFigureNeed(r.content) === "유실",
        )
        .map((r) => r.id),
    );
    // DB 에서 사라진 행은 원장에 남긴다 — 조용히 지우면 기록이 없어진다.
    const alive = new Set(rows.map((r) => r.id));
    targets = targets.filter((t) => alive.has(t.id) && !keepLocked.has(t.id));
    console.log(
      `원장 ${ledger.이전상태.length}건 중 규칙 변경으로 유실이 아니게 된 것 ${targets.length}건`,
    );
  } else if (RECOVERED_ONLY) {
    // 이제 그림이 붙은 것만 고른다 — 아직 없는 것을 풀면 다시 그림 없이 인쇄된다.
    const withFigure = await prisma.problem.findMany({
      where: {
        id: { in: targets.map((t) => t.id) },
        OR: [
          { NOT: { figureUrls: { isEmpty: true } } },
          { figureSvg: { not: null } },
        ],
      },
      select: { id: true },
    });
    const ok = new Set(withFigure.map((w) => w.id));
    targets = targets.filter((t) => ok.has(t.id));
    console.log(
      `원장 ${ledger.이전상태.length}건 중 그림이 회수된 것 ${targets.length}건`,
    );
  }

  if (!APPLY) {
    console.log(`되돌릴 대상 ${targets.length}건 (드라이런)`);
    return;
  }

  // 잠그기 전 값이 true 였던 것만 되돌린다 — 원래 false 였던 것을 열면 안 된다.
  const ids = targets.filter((t) => t.directUseAllowed).map((t) => t.id);
  const { count } = await prisma.problem.updateMany({
    where: { id: { in: ids } },
    data: { directUseAllowed: true },
  });

  const rest = ledger.이전상태.filter(
    (t) => !targets.some((x) => x.id === t.id),
  );
  writeFileSync(
    LEDGER,
    JSON.stringify(
      { ...ledger, 잠근건수: rest.length, 이전상태: rest },
      null,
      1,
    ),
    "utf8",
  );
  console.log(`되돌렸다: ${count}건. 원장에 남은 잠금 ${rest.length}건`);
}

(REVERT ? revert() : lock())
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
