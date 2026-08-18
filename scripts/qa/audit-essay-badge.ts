/**
 * 지면 배지 근거 감사 — **라벨을 뗀 뒤 `questionType` 이 유일한 근거가 됐다.**
 *
 * 적대적 리뷰 ②의 🔴 소견: 원본 시험지가 `[단답형 3]` 이라고 인쇄한 문항에
 * 우리 시험지가 「서술형 n」 배지를 찍는다. 라벨을 떼기 전에는 근거가 둘이었고
 * 374행에서 둘이 어긋났는데, **어긋남을 정리하기 전에 뗐다.**
 *
 * 렌더-C 의 구현 규칙은 "모르는 것을 서술형이라 단정하면 틀린 표시가 나가고,
 * 그건 표시가 없는 것보다 나쁘다" 였다. 그 가드는 `questionType` 이 **비어 있을 때**만
 * 막는다 — **비어 있지 않고 틀렸을 때**는 못 막는다.
 *
 * 근거 파일은 라벨 제거 계획(`docs/planning/tracks/reports/render-c-label-revert.json.gz`)
 * 이다. 거기 `meta.kind` 가 «원본 시험지가 인쇄한 유형» 이다.
 *
 *   npx tsx scripts/qa/audit-essay-badge.ts             요약
 *   npx tsx scripts/qa/audit-essay-badge.ts --samples   표본
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/audit-essay-badge.ts --fix   컬럼 교정
 *
 * `--fix` 는 **틀린 배지가 찍히는 문항의 `questionType` 을 라벨대로 되돌린다.**
 * 표본 10건을 눈으로 확인했다 — 전부 「…의 값을 구하시오」 형태의 단답형이고
 * 라벨이 맞고 컬럼이 틀렸다. `주관식` 은 계약 유효값이 아니라 `단답형` 으로 읽는다
 * (`questionTypeSchema` 는 객관식/단답형/서술형 셋뿐).
 */
import { gunzipSync } from "node:zlib";
import { readFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const PLAN = "docs/planning/tracks/reports/render-c-label-revert.json.gz";

/** 배지는 `questionType === "서술형"` 일 때만 붙는다 (`assignEssayLabels`). */
const BADGE_TYPE = "서술형";

/**
 * 라벨 유형과 컬럼이 **양립하는가**. 서답형은 서술형·단답형 어느 쪽으로도 읽히므로
 * 어긋남으로 세지 않는다 — 상위어를 오류로 세면 실제 오류가 묻힌다.
 */
function compatible(labelKind: string, questionType: string | null): boolean {
  if (!questionType) return false;
  if (labelKind === questionType) return true;
  if (labelKind === "서답형")
    return questionType === "서술형" || questionType === "단답형";
  return false;
}

type Item = { id: string; meta?: { kind?: string } };

/** 라벨 유형 → 계약 유효값. `주관식` 은 계약에 없어 단답형으로 읽는다. */
function toColumnType(labelKind: string): string | null {
  if (labelKind === "단답형" || labelKind === "주관식") return "단답형";
  if (labelKind === "서술형") return "서술형";
  return null; // 서답형은 상위어라 단정하지 않는다
}

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const wantFix = process.argv.includes("--fix");
  if (wantFix && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error("공유 DB 쓰기는 ALLOW_SHARED_IMPORT=1 이 필요하다.");
    process.exitCode = 1;
    return;
  }
  const plan = JSON.parse(gunzipSync(readFileSync(PLAN)).toString("utf-8")) as {
    items: Item[];
  };
  console.log(
    `라벨 제거 계획 ${plan.items.length.toLocaleString()}행 — 배지 근거 대조`,
  );

  const byId = new Map<string, string>();
  for (const item of plan.items) {
    const kind = item.meta?.kind;
    if (kind) byId.set(item.id, kind);
  }

  const rows = await prisma.problem.findMany({
    where: { id: { in: [...byId.keys()] } },
    select: { id: true, questionType: true },
  });

  const pairs = new Map<string, number>();
  const wrongBadge: string[] = [];
  const missingBadge: string[] = [];

  for (const row of rows) {
    const kind = byId.get(row.id)!;
    const key = `${kind} ↔ ${row.questionType ?? "null"}`;
    pairs.set(key, (pairs.get(key) ?? 0) + 1);

    const badgePrinted = row.questionType === BADGE_TYPE;
    const shouldHaveBadge = kind === "서술형" || kind === "서답형";

    // 라벨이 서술형이 아닌데 배지가 찍힌다 = 지면에 틀린 사실이 인쇄된다.
    if (badgePrinted && !compatible(kind, BADGE_TYPE)) wrongBadge.push(row.id);
    // 라벨이 서술형인데 배지가 없다 = 표시 누락(틀린 표시보다는 가볍다).
    else if (!badgePrinted && shouldHaveBadge && kind === "서술형")
      missingBadge.push(row.id);
  }

  console.log("\n라벨 유형 ↔ 현재 questionType");
  for (const [key, count] of [...pairs].sort((a, b) => b[1] - a[1])) {
    console.log(`  ${key.padEnd(22)} ${String(count).padStart(6)}`);
  }
  console.log(
    `\n🔴 틀린 배지: ${wrongBadge.length}문항 — 지면에 틀린 사실이 인쇄된다`,
  );
  console.log(`🟡 배지 누락: ${missingBadge.length}문항`);

  if (wantFix) {
    console.log("\n교정 — 라벨이 말한 유형으로 되돌린다");
    let fixed = 0;
    let skipped = 0;
    for (const id of wrongBadge) {
      const want = toColumnType(byId.get(id)!);
      if (!want) {
        skipped += 1;
        continue;
      }
      // 현재 값이 배지를 찍는 값일 때만 바꾼다 — 그 사이 누가 고쳤으면 건드리지 않는다.
      const updated = await prisma.problem.updateMany({
        where: { id, questionType: BADGE_TYPE },
        data: { questionType: want },
      });
      if (updated.count === 1) fixed += 1;
      else skipped += 1;
    }
    console.log(`  교정 ${fixed}행 · 건너뜀 ${skipped}`);
  }

  if (wantSamples) {
    console.log("\n틀린 배지 표본");
    for (const id of wrongBadge.slice(0, 10)) {
      const row = await prisma.problem.findUnique({
        where: { id },
        select: { content: true, questionType: true },
      });
      console.log(
        `  · ${id.slice(0, 8)} 라벨=${byId.get(id)} 컬럼=${row?.questionType}\n    ${(row?.content ?? "").slice(0, 110).replace(/\n/g, " ")}`,
      );
    }
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
