/**
 * 정답 없는 문항을 **풀이용 묶음 파일**로 내보낸다. AI 호출은 하지 않는다.
 *
 * 정답 백필은 Claude 요금제로 푼다(비용 0). 그래서 API 클라이언트가 아니라
 * **파일**이 인터페이스다 — 묶음 파일을 풀어 답안 파일을 만들고,
 * `load-answer-backfill.ts` 가 그걸 DB 에 넣는다.
 *
 * 기본 대상은 **그림 없는 비서술형**이다:
 *  - 그림 참조 문항은 그림을 못 보면 못 푼다. 추측한 정답이 시험지에 인쇄된다.
 *  - 서술형은 정답이 문장이라 맞는지 판정할 방법이 없다.
 * 둘 다 `(정답 없음)` 으로 두면 출제에서 자동 제외되므로 지금도 안전하다.
 *
 *   npx tsx scripts/qa/export-answer-batches.ts --size 40
 *   npx tsx scripts/qa/export-answer-batches.ts --size 40 --limit 40   파일럿 1묶음
 */
import { mkdir, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

const OUTDIR = "scripts/qa/reports/answer-batches";
const SENTINEL = "정답 없음";

/**
 * 본문이 그림을 **명시적으로 가리키는** 표현. `figureUrls` 가 비어 있고
 * `[그림]` 마커도 없는데 "오른쪽 그림과 같은 …" 으로 시작하는 문항이
 * 3,172건 중 1,691건(53%)이었다(2026-08-15 실측).
 *
 * 이런 문항을 텍스트만 주고 풀리면 AI 가 **추측**한다. 그 정답이 시험지에
 * 인쇄되면 학생이 틀린 답으로 채점받는다. 걸러 내는 게 토큰도 아끼고
 * 품질도 지킨다 — 남겨 두면 `(정답 없음)` 이라 출제에서 자동 제외된다.
 */
const FIGURE_REF =
  /(오른쪽|아래|다음|위|왼쪽)\s*그림|그림에서|그림과 같|그림처럼/;

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const num = (flag: string, d: number) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? Number(argv[i + 1]) : d;
  };
  const size = num("--size", 40);
  const limit = num("--limit", 0);
  const includeFigure = argv.includes("--include-figure");
  const includeEssay = argv.includes("--include-essay");

  const prisma = new PrismaClient();
  try {
    const all = await prisma.problem.findMany({
      where: {
        answer: { contains: SENTINEL },
        ...(includeEssay ? {} : { problemType: { not: "서술형" } }),
      },
      select: {
        id: true,
        externalId: true,
        content: true,
        problemType: true,
        figureUrls: true,
        unit: { select: { grade: true, chapter: true, section: true } },
      },
      orderBy: { id: "asc" },
    });

    let rows = all.filter(
      (r) =>
        includeFigure ||
        (r.figureUrls.length === 0 &&
          !r.content.includes("[그림") &&
          !FIGURE_REF.test(r.content)),
    );
    if (limit > 0) rows = rows.slice(0, limit);

    await mkdir(OUTDIR, { recursive: true });
    let files = 0;
    let chars = 0;
    for (let i = 0; i < rows.length; i += size) {
      const chunk = rows.slice(i, i + size).map((r) => ({
        id: r.id,
        externalId: r.externalId,
        unit: r.unit
          ? `${r.unit.grade} / ${r.unit.chapter} / ${r.unit.section}`
          : null,
        problemType: r.problemType,
        content: r.content,
      }));
      chars += chunk.reduce((a, c) => a + c.content.length, 0);
      const name = `${String(files).padStart(4, "0")}.json`;
      await writeFile(
        `${OUTDIR}/${name}`,
        JSON.stringify(chunk, null, 1),
        "utf-8",
      );
      files += 1;
    }

    console.log("── 정답 풀이 묶음 내보내기 ──");
    console.log(
      `문항 ${rows.length} · 묶음 ${files}개(묶음당 ${size}) · 본문 ${(chars / 1000).toFixed(0)}k자`,
    );
    console.log(`→ ${OUTDIR}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
