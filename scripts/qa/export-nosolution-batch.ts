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
 * 우선순위: ① 학년 (원장님 지시 2026-08-22: 중1→중2→중3→고1→고2 순.
 *    미확정 학년(초등·미적분2 등 고3)은 뒤로) ② 실제 시험에 나갔던 것
 *    ③ 그림 없는 것 전부 (문항코드순).
 * 그림 있는 문항은 제외 — 그림 품질 트랙 뒤에 한다 (원장님 확정).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const p = new PrismaClient();
const OUT_DIR = path.join("scripts", "qa", "nosol-out");

/** 「중1→중2→중3→고1→고2」(원장님 지시). `unit.grade` 는 2022 개정 교육과정
 *  과목명 — 공통수학1·2=고1, 대수·미적분1·확률과 통계·기하=고2, 미적분2=고3
 *  (prisma/seed-data/units.ts 등장 순서가 정본). 목록에 없는 값(초등 등)은
 *  마지막 순위. */
const GRADE_PRIORITY = [
  "중1",
  "중2",
  "중3",
  "공통수학1",
  "공통수학2",
  "대수",
  "미적분1",
  "확률과 통계",
  "기하",
  "미적분2",
];

/** 이미 시도해서 못 채운 문항(답 불일치·건너뜀)은 다시 내보내지 않는다 —
 *  채워진 문항은 WHERE 가 거르지만, 이들은 여전히 「해설 없음」이라 매 배치
 *  맨 앞에 되돌아온다(정렬이 같으므로). 원장 둘에서 id 를 모아 뺀다. */
function attemptedIds(): string[] {
  const out: string[] = [];
  for (const f of ["ai-solution-mismatch.json", "ai-solution-skip.json"]) {
    const fp = path.join("scripts", "qa", "reports", f);
    if (!existsSync(fp)) continue;
    for (const r of JSON.parse(readFileSync(fp, "utf8")) as Array<{
      id: string;
    }>)
      out.push(r.id);
  }
  return out;
}

async function main() {
  const count = Number(process.argv[2] ?? 60);
  const skip = Number(process.argv[3] ?? 0);
  const tag = process.argv[4] ?? `b${skip}`;
  const exclude = attemptedIds();
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
       ${exclude.length > 0 ? `AND pr.id NOT IN (${exclude.map((i) => `'${i}'`).join(",")})` : ""}
     ORDER BY CASE u.grade
       ${GRADE_PRIORITY.map((g, i) => `WHEN '${g}' THEN ${i}`).join(" ")}
       ELSE ${GRADE_PRIORITY.length}
     END, used DESC, pr.problem_code ASC
     OFFSET ${skip} LIMIT ${count}`,
  );
  mkdirSync(OUT_DIR, { recursive: true });
  const items = rows.map((r) => ({
    id: r.id,
    code: r.problem_code,
    unit: r.unit_name,
    type: r.question_type,
    content: r.content,
  }));
  const file = path.join(OUT_DIR, `todo-${tag}.json`);
  writeFileSync(file, JSON.stringify(items, null, 1), "utf8");
  // 조각 파일 — 에이전트가 제 몫 20문항만 읽는다 (전체 파일을 n번 중복으로
  // 읽으면 그 토큰이 전부 낭비다. 2026-08-22 토큰 절약 지시). 이름은 번호
  // (01, 02…) — 글자(a~h, 8개)로는 8조각을 넘기면 undefined 파일이 나왔다
  // (2026-08-22 실측 버그, 200문항/10조각에서 발견).
  const SLICE = 20;
  const sliceCount = Math.ceil(items.length / SLICE);
  const pad = String(sliceCount).length;
  for (let i = 0; i * SLICE < items.length; i += 1) {
    const idx = String(i + 1).padStart(pad, "0");
    writeFileSync(
      path.join(OUT_DIR, `todo-${tag}-${idx}.json`),
      JSON.stringify(items.slice(i * SLICE, (i + 1) * SLICE), null, 1),
      "utf8",
    );
  }
  console.log(
    file,
    "←",
    rows.length,
    "문항 (조각",
    Math.ceil(items.length / SLICE),
    "· 실제 출제됐던 것",
    rows.filter((r) => Number(r.used) > 0).length,
    "· 기시도 제외",
    exclude.length,
    ")",
  );
}
main().finally(() => p.$disconnect());
