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
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

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

/**
 * **진짜** 문장 답을 요구하는 표현. 이것만 백필에서 뺀다.
 *
 * `problemType='서술형'` 라벨은 믿을 수 없다 — 5,310건 중 95%가 본문이
 * `[서술형 N]` 으로 시작하는데, 그건 답의 형태가 아니라 **원본 시험지의
 * 배점 구획 머리표**다. 이관이 그걸 그대로 problemType 에 옮겼다.
 * 실제로 문장 답을 요구하는 건 463건(8.7%)뿐이고 2,730건은 "구하시오" 로
 * 끝나는 단답형이다(2026-08-15 실측, 표본 15건 중 12건 정상 풀이).
 */
const ESSAY_REQ =
  /설명하[시여]|서술하[시여]|까닭을|이유를|증명하[시여]|보여라|나타내는 과정을/;
/** 단답 요구. 위와 함께 있으면 "풀이 과정 + 답" 이라 최종 답은 뽑을 수 있다. */
const SHORT_ANSWER_REQ =
  /구하[시여]|값은|몇 개|몇 명|얼마|을 쓰[시여]|를 쓰[시여]/;
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

    let rows = all.filter((r) => {
      const hasFigure =
        r.figureUrls.length > 0 ||
        r.content.includes("[그림") ||
        FIGURE_REF.test(r.content);
      if (hasFigure && !includeFigure) return false;
      // 순수 설명형만 뺀다. 단답 요구가 함께 있으면 "풀이 과정 + 답" 이라
      // 최종 답은 뽑을 수 있다. problemType 라벨은 보지 않는다 — 못 믿는다.
      if (
        !includeEssay &&
        ESSAY_REQ.test(r.content) &&
        !SHORT_ANSWER_REQ.test(r.content)
      ) {
        return false;
      }
      return true;
    });
    // 이미 풀어 둔 문항은 다시 내보내지 않는다. 로더가 보기 미렌더로 보류한
    // 문항은 DB 에 정답이 안 들어가 여기 다시 걸리는데, 다시 푸는 건 낭비다.
    const solvedDir = "scripts/qa/reports/answer-solved";
    const already = new Set<string>();
    try {
      for (const f of await readdir(solvedDir)) {
        if (!f.endsWith(".json")) continue;
        const items: Array<{ id: string; ok?: boolean }> = JSON.parse(
          await readFile(`${solvedDir}/${f}`, "utf-8"),
        );
        for (const it of items) if (it.ok !== false) already.add(it.id);
      }
    } catch {
      // 답안 디렉토리가 아직 없으면 그냥 전부 내보낸다.
    }
    const beforeSolved = rows.length;
    rows = rows.filter((r) => !already.has(r.id));
    if (beforeSolved !== rows.length) {
      console.log(`이미 푼 문항 제외: ${beforeSolved} → ${rows.length}`);
    }

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
