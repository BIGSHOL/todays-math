/**
 * 해설 없는 문항 내보내기 — Claude 서브에이전트 해설 생성용 (2026-08-22, 원장님 지시).
 *
 *   npx tsx --env-file=.env scripts/qa/export-nosolution-batch.ts <개수> [건너뜀]
 *
 * 산출: scripts/qa/nosol-out/todo-<시작번호>.json (git 무시 — 재생성 가능)
 *
 * 🔴 **정답을 내보내지 않는다.** 에이전트가 기록된 정답을 보면 그쪽으로 꿰맞춘
 *    풀이를 쓴다 — 독립 검산이 죽는다. 답 대조는 적용 스크립트가 한다.
 *
 * 우선순위: ① 실제 시험에 나갔던 것 ② 그림 없는 것 전부 (문항코드순).
 * 그림 있는 문항은 제외 — 그림 품질 트랙 뒤에 한다 (원장님 확정).
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const OUT_DIR = path.join("scripts", "qa", "nosol-out");

async function main() {
  const count = Number(process.argv[2] ?? 60);
  const skip = Number(process.argv[3] ?? 0);
  const rows = await p.$queryRawUnsafe<
    Array<{
      id: string;
      problem_code: string;
      content: string;
      question_type: string | null;
      unit_name: string | null;
      used: bigint;
    }>
  >(
    `SELECT pr.id, pr.problem_code, pr.content, pr.question_type,
            (u.grade || ' ' || u.section) unit_name,
            (SELECT COUNT(*) FROM test_problem tp WHERE tp.problem_id = pr.id) used
     FROM problem pr
     LEFT JOIN unit u ON u.id = pr.unit_id
     WHERE (pr.solution IS NULL OR pr.solution = '')
       AND pr.direct_use_allowed = true
       AND pr.answer IS NOT NULL AND pr.answer <> ''
       AND cardinality(pr.figure_urls) = 0
       AND (pr.figure_svg IS NULL OR pr.figure_svg = '')
     ORDER BY used DESC, pr.problem_code ASC
     OFFSET ${skip} LIMIT ${count}`,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const file = path.join(OUT_DIR, `todo-${skip}.json`);
  writeFileSync(
    file,
    JSON.stringify(
      rows.map((r) => ({
        id: r.id,
        code: r.problem_code,
        unit: r.unit_name,
        type: r.question_type,
        content: r.content,
      })),
      null,
      1,
    ),
    "utf8",
  );
  console.log(
    file,
    "←",
    rows.length,
    "문항 (실제 출제됐던 것",
    rows.filter((r) => Number(r.used) > 0).length,
    ")",
  );
}
main().finally(() => p.$disconnect());
