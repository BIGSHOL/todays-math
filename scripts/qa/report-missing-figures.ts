/**
 * 그림 유실 전수 조사 — **본문이 그림을 지목하는데 그림이 없는 문항**을 센다.
 *
 *   npx tsx scripts/qa/report-missing-figures.ts            # 집계만
 *   npx tsx scripts/qa/report-missing-figures.ts --list     # 대상 전량 목록
 *   npx tsx scripts/qa/report-missing-figures.ts --json     # scripts/qa/reports/ 에 기록
 *
 * ## 왜 이 지표인가 — 「그림」이라는 낱말은 열쇠가 아니다
 *
 * 처음엔 본문에 「그림」이 있고 `figureUrls`·`figureSvg` 가 둘 다 빈 것을 셌다(1,499건).
 * 표본을 눈으로 보니 그중 상당수가 **멀쩡했다** — 「줄기와 잎 그림」은 표가 본문에
 * 글자로 들어 있고, 「그림그래프」는 낱말만 나오는 자작 문항이고, 「사람의 **그림**자」는
 * 부분문자열 오탐이다. 반대로 「그래프」로 세면 3,373건이 걸리는데 표본 14건이 **전부**
 * 대수식만으로 풀리는 멀쩡한 문항이었다.
 *
 * 그래서 열쇠를 낱말에서 **지시어**로 바꿨다 — 「오른쪽 그림과 같은…」처럼 본문이
 * 지면의 그림을 **가리키는가**. 가리키는데 그림이 없으면 학생은 풀 수 없다.
 * (CLAUDE.md 2026-08-17 「문턱을 옮기지 말고 열쇠를 바꿔라」와 같은 자리다.)
 *
 * ## 손으로 쓴 목록은 눈이 먼다 — 그래서 발견기를 같이 돌린다
 *
 * 첫 지시어 목록 5개는 198건을 못 봤다. 그 사실은 「그림」 전수와 대조해서야 드러났다.
 * 그래서 이 스크립트는 판정과 **함께** `미분류` 를 반드시 출력한다 —
 * 「그림」이 있는데 지시어에도 오탐 목록에도 안 걸린 것. 0이 아니면 목록이 아직 눈멀었다는
 * 뜻이고, 사람이 그 표본을 봐야 한다. 조용히 잘라내지 않는다.
 * (CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」)
 */
import { mkdirSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

/**
 * 본문이 지면의 그림을 **가리키는** 표현. 이게 있으면 그림 없이는 못 푼다.
 * `<그림 1>`·`[그림$2$]` 형태는 첫 목록에 없어 미분류로 떨어졌다 — 미분류 표본을
 * 눈으로 보고 추가했다. 목록을 늘릴 때는 반드시 그 근거가 된 표본이 있어야 한다.
 */
const DEICTIC: RegExp =
  /(다음|위|아래|오른쪽|왼쪽)\s*그림|그림과\s*같|그림에서|그림에\s*대한|그림은|그림의|그림을\s*보|그림\s*\(가\)|그림이다|그림입니다|[<[]\s*그림\s*\$?\d|산점도는|상자그림이\s*나타내/;

/**
 * 지시어처럼 보이지만 그림이 필요 없는 것 — **전부 표본을 눈으로 확인했다.**
 * · 줄기와 잎 그림 : 표가 본문에 글자로 들어 있다(27건 중 표본 2건 확인)
 * · 그림그래프     : 낱말만 나오는 자작 개념 문항(6건)
 * · 그림자         : 부분문자열 오탐 — 「사람의 **그림**자 끝이」
 * · 그림 카드/개   : 조작 교구를 말로 설명하는 문항
 * · …으로 나타내시오 : **학생이 그리는** 문항이다. 지면에 그림이 없어야 정상이다.
 *   「상자그림**이 나타내는** 자료는?」(그림 필요)과 한 글자 차이라 방향을 구분한다.
 * · 펼쳐 놓은 그림  : 전개도의 «이름»을 묻는 말뿐인 문항
 */
const NOT_A_FIGURE: RegExp =
  /줄기와\s*잎\s*그림|그림그래프|그림자|그림\s*카드|그림\s*하나|그림\s*\d+\s*개|그림을\s*그린|그림으로\s*나타내|펼쳐\s*놓은\s*그림|그림이\s*나오는/;

/**
 * `[그림]` 은 **유실이 아니라 오염 자국**이다 — 추출기가 학원 로고·머리말 이미지 자리에
 * 남긴 표시다. 실제로 그 뒤에 「…기말고사칠성고 1학년 수학학원 로고…」가 딸려 온다.
 * 그림 유실과 성격이 다르므로 따로 센다(같이 세면 둘 다 안 보인다).
 */
const CONTAMINATION = "[그림]";

type Row = {
  id: string;
  externalId: string | null;
  source: string;
  content: string;
  directUseAllowed: boolean;
  reviewStatus: string;
};

const NO_FIGURE = { figureUrls: { isEmpty: true }, figureSvg: null } as const;
const flat = (s: string) => s.replace(/\s+/g, " ");

async function main() {
  const list = process.argv.includes("--list");
  const json = process.argv.includes("--json");

  // 「그림」이 든 것만 끌어온다 — 판정은 여기 코드에서, DB 쿼리에서 하지 않는다.
  const rows = (await prisma.problem.findMany({
    where: { content: { contains: "그림" }, ...NO_FIGURE },
    select: {
      id: true,
      externalId: true,
      source: true,
      content: true,
      directUseAllowed: true,
      reviewStatus: true,
    },
    orderBy: { id: "asc" },
  })) as Row[];

  const broken: Row[] = [];
  const contaminated: Row[] = [];
  const benign: Row[] = [];
  const unclassified: Row[] = [];

  for (const r of rows) {
    const c = flat(r.content);
    // 오탐을 **먼저** 뺀다 — 「줄기와 잎 그림이다」는 `그림이다` 지시어에도 걸린다.
    if (NOT_A_FIGURE.test(c)) benign.push(r);
    else if (DEICTIC.test(c)) broken.push(r);
    else if (c.includes(CONTAMINATION)) contaminated.push(r);
    else unclassified.push(r);
  }

  const printable = (rs: Row[]) =>
    rs.filter((r) => r.directUseAllowed && r.reviewStatus === "approved")
      .length;
  const bySource = (rs: Row[]) => {
    const m: Record<string, number> = {};
    for (const r of rs) m[r.source] = (m[r.source] ?? 0) + 1;
    return m;
  };

  console.log(`본문에 「그림」 + 그림 파일 없음 = ${rows.length}건\n`);
  console.log(`■ 그림 유실 (지시어 있음)   ${broken.length}건`);
  console.log(`   · 지금 출제 가능           ${printable(broken)}건`);
  console.log(
    `   · source 별                ${JSON.stringify(bySource(broken))}`,
  );
  console.log(`■ 본문 오염 (\`[그림]\` 자국)  ${contaminated.length}건`);
  console.log(`   · 지금 출제 가능           ${printable(contaminated)}건`);
  console.log(`□ 그림이 필요 없는 것        ${benign.length}건`);
  console.log(
    `? 미분류 — 목록이 눈멀었는지 확인해야 한다  ${unclassified.length}건`,
  );

  if (unclassified.length > 0) {
    console.log("\n미분류 표본 (사람이 봐야 한다):");
    const step = Math.max(1, Math.floor(unclassified.length / 10));
    for (let i = 0; i < unclassified.length && i / step < 10; i += step) {
      console.log(`  · ${flat(unclassified[i]!.content).slice(0, 120)}`);
    }
  }

  if (list) {
    console.log("\n───── 그림 유실 전량 ─────");
    for (const r of broken) {
      console.log(
        `${r.id}\t${r.source}\t${r.externalId ?? "-"}\t${flat(r.content).slice(0, 90)}`,
      );
    }
  }

  if (json) {
    mkdirSync("scripts/qa/reports", { recursive: true });
    const out = "scripts/qa/reports/missing-figures.json";
    writeFileSync(
      out,
      JSON.stringify(
        {
          측정: "본문이 그림을 지목하는데 figureUrls·figureSvg 가 모두 빈 문항",
          전체: rows.length,
          그림유실: broken.length,
          그림유실_출제가능: printable(broken),
          본문오염: contaminated.length,
          그림불필요: benign.length,
          미분류: unclassified.length,
          목록: broken.map((r) => ({
            id: r.id,
            externalId: r.externalId,
            source: r.source,
            directUseAllowed: r.directUseAllowed,
            본문: flat(r.content).slice(0, 200),
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`\n기록 → ${out}`);
  }

  await prisma.$disconnect();
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
