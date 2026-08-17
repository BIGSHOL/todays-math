/**
 * 단원 오분류 158건을 **출제 풀에서 뺀다** (통합 보고서 §4-A 즉시 조치).
 *
 *   npx tsx scripts/classify/apply-unit-audit-mitigation.ts            # 드라이런(기본)
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-mitigation.ts   # 실제 적용
 *   ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-mitigation.ts --revert  # 되돌리기
 *
 * 왜 이 조치가 먼저인가: **어디로 옮길지 정하기 전에도 피해는 멈출 수 있다.**
 * 지금은 초3 반 시험지에 고1 이차부등식이 뽑힐 수 있다(`4509-5`).
 *
 * 레버는 `directUseAllowed = false` 다 — 스키마 주석대로 "출제 풀에서 제외하고
 * 변형 원본으로만 쓴다". `reviewStatus` 는 건드리지 않는다(AI 생성물 검수 대기와 섞이면
 * 원장님이 두 종류를 구분할 수 없다).
 *
 * ⚠️ D-26 원안 폐지 후 `directUseAllowed` 는 전량 true 이고 새로 잠그려면 원장님 확인이
 *    필요하다(스키마 주석). **2026-08-17 원장님 지시로 이 158건에 한해 잠근다.**
 *
 * 공유 Supabase 쓰기라 기본은 차단이다(CLAUDE.md 2026-08-14 교훈).
 * `ALLOW_UNIT_FIX=1` 일 때만 실제로 쓴다. 되돌리기가 대칭으로 붙어 있다.
 */
import { readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const SOURCE = "scripts/classify/reports/unit-audit-consolidated.json";
const LEDGER = "scripts/classify/reports/mitigation-ledger.json";

type Finding = {
  problemId: string;
  externalId: string | null;
  source: string;
  현재단원: string;
  확신도: string;
  축: string[];
};

const APPLY = process.env.ALLOW_UNIT_FIX === "1";
const REVERT = process.argv.includes("--revert");

async function main() {
  const report = JSON.parse(readFileSync(SOURCE, "utf8")) as {
    목록: Finding[];
  };
  const list = report.목록;
  const ids = list.map((f) => f.problemId);
  console.log(`대상 ${ids.length}건 (${SOURCE})`);

  // 현재 상태를 먼저 읽는다 — 되돌릴 수 있어야 하고, 이미 적용됐는지도 알아야 한다.
  const before = await prisma.problem.findMany({
    where: { id: { in: ids } },
    select: { id: true, externalId: true, directUseAllowed: true },
  });
  if (before.length !== ids.length) {
    console.log(
      `⚠️ DB 에서 찾은 것은 ${before.length}건 — ${ids.length - before.length}건이 사라졌다`,
    );
  }

  const target = REVERT ? true : false;
  const toChange = before.filter((r) => r.directUseAllowed !== target);
  console.log(
    `${REVERT ? "되돌리기" : "출제 제외"}: directUseAllowed ${!target} → ${target}`,
  );
  console.log(
    `  이미 그 상태 ${before.length - toChange.length}건 · 바꿀 것 ${toChange.length}건`,
  );

  // 이 조치가 실제로 무엇을 막는지 숫자로 보여 준다 — "적용했다"만으로는 효과를 모른다.
  const eligible = await prisma.problem.count({
    where: {
      id: { in: ids },
      reviewStatus: "approved",
      directUseAllowed: true,
    },
  });
  console.log(
    `  그중 지금 **출제 가능**(approved + directUseAllowed) 상태: ${eligible}건`,
  );

  if (!APPLY) {
    console.log("\n드라이런이다. 실제로 쓰려면 ALLOW_UNIT_FIX=1 을 붙여라.");
    console.log("표본 5건:");
    for (const f of list.slice(0, 5)) {
      console.log(
        `  [${f.externalId ?? f.problemId.slice(0, 8)}] ${f.현재단원} (확신도 ${f.확신도}, 축 ${f.축.join("+")})`,
      );
    }
    return;
  }

  const result = await prisma.problem.updateMany({
    where: { id: { in: toChange.map((r) => r.id) } },
    data: { directUseAllowed: target },
  });
  console.log(`\n적용 완료: ${result.count}건`);

  // 되돌릴 수 있도록 이전 상태를 남긴다.
  if (!REVERT) {
    writeFileSync(
      LEDGER,
      JSON.stringify(
        {
          적용: "directUseAllowed=false (출제 풀 제외)",
          근거: SOURCE,
          바꾼건수: result.count,
          되돌리기:
            "ALLOW_UNIT_FIX=1 npx tsx scripts/classify/apply-unit-audit-mitigation.ts --revert",
          이전상태: before.map((r) => ({
            id: r.id,
            externalId: r.externalId,
            directUseAllowed: r.directUseAllowed,
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`이전 상태 기록: ${LEDGER}`);
  }

  // 적용 후 실측 — 보고를 믿지 말고 다시 센다.
  const after = await prisma.problem.count({
    where: { id: { in: ids }, directUseAllowed: true },
  });
  console.log(`검증: 대상 중 아직 출제 허용인 것 ${after}건 (0 이어야 정상)`);
}

main().finally(() => prisma.$disconnect());
