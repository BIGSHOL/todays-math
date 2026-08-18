/**
 * 적대적 리뷰 — 감사 도구가 **셀 수 없는** 상자 결함을 센다. **읽기 전용.**
 *
 * `audit-box-boundary.ts` 의 「발문 삼킴」 신호는 **물음표 하나뿐**이다.
 * 그런데 이 말뭉치의 서술형 문항은 물음표로 끝나지 않는다 — `…을 구하시오.`,
 * `…풀이 과정을 서술하시오.` 로 끝난다. 즉 **서술형 발문을 상자가 삼켜도
 * 감사 지표는 구조적으로 0이다** (CLAUDE.md 2026-08-16 «지표가 실패를 셀 수 있는
 * 형태인지 먼저 확인하라», 2026-08-18 «목록을 손으로 쓰면 세는 쪽과 고치는 쪽이
 * 같이 눈이 먼다»).
 *
 * 여기서는 상자 안에 있으면 안 되는 것을 **다른 열쇠**로 센다:
 *   ① 서술형 발문 종결 — `…시오.` `…하여라.` `…구하라.`
 *   ② 배점 표기 — `[ 4점]` `[4.5점]`
 *   ③ 「다음 물음에 답하시오」 — 하위 문항으로 이어지는 자리
 * 그리고 각각이 **기존 감사(물음표·하위문항·머리말)에 잡히는지**를 같이 센다.
 *
 * 실행: npx tsx qa/adversarial/scripts/scan-box-blindspots.ts [--samples]
 */
import { PrismaClient } from "@prisma/client";

import { parseProblemContent } from "../../../src/lib/problem/parseProblemContent";

const prisma = new PrismaClient();

interface Box {
  header: string;
  items: string[];
  raw: string;
}

function boxesOf(question: string): Box[] {
  const boxes: Box[] = [];
  let cur: string[] | null = null;
  for (const rawLine of question.split(/\r?\n/)) {
    const line = rawLine.trimStart();
    if (line.startsWith(">")) {
      if (cur === null) cur = [];
      cur.push(line.replace(/^>\s?/, ""));
      continue;
    }
    if (cur) {
      boxes.push(toBox(cur));
      cur = null;
    }
  }
  if (cur) boxes.push(toBox(cur));
  return boxes;
}
function toBox(lines: string[]): Box {
  const paras = lines
    .join("\n")
    .split(/\n\s*\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    header: paras[0] ?? "",
    items: paras.slice(1),
    raw: paras.join("\n"),
  };
}

/* 기존 감사(audit-box-boundary.ts)의 신호 — 「이미 보이는가」를 재려고 그대로 옮겼다. */
const OLD_SIGNALS = [
  /[?？]/,
  /[⑴-⑽]/,
  /(?:^|[\s$\n(])\(\s*[1-9]\s*\)/,
  /\d{4}\s*년|중간고사|기말고사|학력평가|모의고사|[가-힣]{2,5}(?:중|고)등?학?교?\s*\d\s*학년/,
];

/** ① 서술형 발문 종결. 조건 항목이 이 어미로 끝나는 일은 «서술하시오» 뿐이라 그건 뺀다. */
const ESSAY_TAIL =
  /(?:구하시오|구하여라|구하라|나타내시오|나타내어라|서술하시오|설명하시오|답하시오|쓰시오|보이시오|하여라)\s*[.．]?\s*(?:\(.{0,60}\)|\[.{0,40}\]|\$[^$]{0,40}\$)?\s*$/;
/** ② 배점 표기 — 발문 꼬리에만 붙는다. 상자 항목에는 배점이 없다. */
const SCORE_MARK = /\[\s*\$?\s*\d+(?:\.\d+)?\s*\$?\s*(?:점|소|중|상)?\s*\]?/;
const SCORE_STRICT = /\[\s*\$?\s*\d+(?:\.\d+)?\s*\$?\s*점/;
/** ③ 하위 문항 안내 */
const SUBQ_LEAD = /다음\s*물음에\s*답하[시여]/;

async function main() {
  const wantSamples = process.argv.includes("--samples");
  const total = await prisma.problem.count();
  let boxes = 0;
  const counts = new Map<string, number>();
  const unseen = new Map<string, number>();
  const samples = new Map<string, Array<{ id: string; raw: string }>>();

  const bump = (key: string, id: string, raw: string, invisible: boolean) => {
    counts.set(key, (counts.get(key) ?? 0) + 1);
    if (invisible) {
      unseen.set(key, (unseen.get(key) ?? 0) + 1);
      const list = samples.get(key) ?? [];
      if (list.length < 40) list.push({ id, raw });
      samples.set(key, list);
    }
  };

  const PAGE = 2000;
  for (let skip = 0; skip < total; skip += PAGE) {
    const rows = await prisma.problem.findMany({
      select: { id: true, content: true },
      orderBy: { id: "asc" },
      skip,
      take: PAGE,
    });
    if (rows.length === 0) break;
    for (const row of rows) {
      const { question } = parseProblemContent(row.content ?? "");
      for (const box of boxesOf(question)) {
        boxes += 1;
        const body = box.items.join("\n");
        const visible = OLD_SIGNALS.some((re) => re.test(body));
        if (ESSAY_TAIL.test(body.trim()))
          bump("① 서술형 발문으로 끝남", row.id, box.raw, !visible);
        if (SCORE_STRICT.test(body))
          bump("② 배점 표기", row.id, box.raw, !visible);
        if (SCORE_MARK.test(body) && !SCORE_STRICT.test(body))
          bump("②' 배점 파편", row.id, box.raw, !visible);
        if (SUBQ_LEAD.test(body))
          bump("③ 다음 물음에 답하시오", row.id, box.raw, !visible);
      }
    }
  }

  console.log(`상자 ${boxes}개 (전수 ${total}문항)\n`);
  console.log("신호별 — 「합계 / 기존 감사에 안 보이는 것」");
  for (const [key, count] of [...counts].sort((a, b) => b[1] - a[1]))
    console.log(
      `  ${key.padEnd(24)} ${String(count).padStart(4)} / ${String(unseen.get(key) ?? 0).padStart(4)}`,
    );

  if (wantSamples)
    for (const [key, list] of samples) {
      console.log(`\n\n##### ${key} — 기존 감사에 **안 보이는** 것 전량`);
      for (const s of list) {
        console.log(`\n--- ${s.id}`);
        console.log(
          s.raw
            .split("\n")
            .map((l) => "    " + l.slice(0, 240))
            .join("\n"),
        );
      }
    }
  await prisma.$disconnect();
}

main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
