/**
 * `\overline{GE}` → `\overline{\geq }` 손상을 되돌린다 — **적대적 리뷰 ②가 찾은 잔여 3행.**
 *
 * ## 무슨 일이 있었나
 * `le`/`ge` → 부등호 치환 규칙이 **기하 라벨**을 연산자로 읽었다. 선분 GE 가
 * `≥` 가 됐다. 세 문항 다 무게중심·중선 문항이라 지면에 「선분 GE」가 있어야 할
 * 자리에 ≥ 가 찍힌다. `c1a859a5` 는 「옳지 **않은** 것은?」 5지선다인데 ③④ 두 선택지가
 * 동시에 망가져 **정답 판정이 불가능**하다.
 *
 * 앞선 수리(`dbcb92d3`)가 2행을 되돌렸지만 되돌릴 대상을 `\mathrm{\overline{GE}}`
 * 모양으로만 찾아 **같은 사고의 나머지 3행을 못 봤다.** 적대적 리뷰가 적용 로그의
 * `\cmd{...}` 인자를 before/after 로 전수 대조해 찾아냈다.
 *
 * ## 안전 장치
 * - 되돌릴 문자열은 **적용 로그의 `before` 에서 확인한 원본**이다(추측이 아니다).
 * - 현재 값이 예상과 다르면 건드리지 않고 「건너뜀」으로 보고한다.
 * - 되돌린 뒤 `\geq` 가 남아 있는지 다시 세어 확인한다.
 *
 *   npx tsx scripts/qa/revert-overline-ge.ts              드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/revert-overline-ge.ts --apply
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/** 손상된 자리. 적대적 리뷰 ②의 전수 인자 감사 결과 — 이 셋이 전부다. */
const DAMAGED_IDS = [
  "6d840bbf-817b-4e12-bc39-ecc47a6cc7c0",
  "770327c0-b3b5-4768-8052-230fe8f3bb49",
  "c1a859a5-7ecb-4abd-9f13-70ca62a2aede",
];

/** 손상 모양 → 원본. 로그의 `before` 로 확인했다. */
const BROKEN = "\\overline{\\geq }";
const ORIGINAL = "\\overline{GE}";

async function main() {
  const apply = process.argv.includes("--apply");
  if (apply && process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.error("공유 DB 쓰기는 ALLOW_SHARED_IMPORT=1 이 필요하다.");
    process.exitCode = 1;
    return;
  }

  const rows = await prisma.problem.findMany({
    where: { id: { in: DAMAGED_IDS } },
    select: { id: true, content: true },
  });

  let planned = 0;
  let applied = 0;
  let skipped = 0;

  for (const row of rows) {
    const hits = row.content.split(BROKEN).length - 1;
    if (hits === 0) {
      console.log(
        `· ${row.id.slice(0, 8)} 손상 없음 — 건너뜀 (이미 되돌아갔거나 다른 값)`,
      );
      skipped += 1;
      continue;
    }
    const after = row.content.split(BROKEN).join(ORIGINAL);
    planned += hits;
    console.log(`· ${row.id.slice(0, 8)} ${hits}곳`);
    for (const m of after.matchAll(/.{0,45}overline\{GE\}.{0,20}/g)) {
      console.log(`    후 … ${m[0].replace(/\n/g, " ")}`);
    }

    if (!apply) continue;

    // 현재 값이 읽은 것과 같을 때만 쓴다 — 그 사이 누가 바꿨으면 건드리지 않는다.
    const updated = await prisma.problem.updateMany({
      where: { id: row.id, content: row.content },
      data: { content: after },
    });
    if (updated.count === 1) applied += 1;
    else {
      console.log(`    ⚠️ 값이 바뀌어 있어 건너뜀`);
      skipped += 1;
    }
  }

  console.log(
    `\n${apply ? "적용" : "드라이런"} — 손상 ${planned}곳 / ${rows.length}행 조회` +
      (apply ? ` · 갱신 ${applied}행 · 건너뜀 ${skipped}` : " · 변경 없음"),
  );

  if (apply) {
    const left = await prisma.problem.findMany({
      where: { id: { in: DAMAGED_IDS } },
      select: { id: true, content: true },
    });
    const remaining = left.reduce(
      (sum, r) => sum + (r.content.split(BROKEN).length - 1),
      0,
    );
    console.log(`되돌린 뒤 남은 손상: ${remaining}곳`);
  }
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
