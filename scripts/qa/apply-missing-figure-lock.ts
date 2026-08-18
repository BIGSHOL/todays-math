/**
 * 그림 유실 문항을 **출제 풀에서 뺀다** (`directUseAllowed = false`).
 *
 *   npx tsx scripts/qa/apply-missing-figure-lock.ts                 # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert
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
} from "./missingFigureRule";

const prisma = new PrismaClient();

const LEDGER = "scripts/qa/reports/missing-figure-lock.json";
const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");
/** 원장에 있던 것 중 **이제 그림이 붙은** 문항만 푼다. 회수 직후에 쓴다. */
const RECOVERED_ONLY = process.argv.includes("--recovered");

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

  const { count } = await prisma.problem.updateMany({
    where: { id: { in: todo.map((r) => r.id) } },
    data: { directUseAllowed: false },
  });

  const ledger: Ledger = {
    적용: "그림 유실 문항 출제 제외 (directUseAllowed=false)",
    기준시각: new Date().toISOString(),
    되돌리기:
      "ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert",
    잠근건수: merged.length,
    이전상태: merged,
  };
  writeFileSync(LEDGER, JSON.stringify(ledger, null, 1), "utf8");
  console.log(`\n잠갔다: ${count}건 (누적 ${merged.length}). 원장 → ${LEDGER}`);
}

async function revert() {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const ledger = JSON.parse(readFileSync(LEDGER, "utf8")) as Ledger;

  let targets = ledger.이전상태;
  if (RECOVERED_ONLY) {
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
