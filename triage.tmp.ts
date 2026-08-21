import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();

async function main() {
  // ④ 컬러 SVG (65°, M·N, 외접원) — figure_svg 는 0이었으니 파일 쪽이다
  const colored = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null; figure_urls: unknown }>
  >(
    `SELECT id, problem_code, figure_urls FROM problem
     WHERE direct_use_allowed = true AND content LIKE '%65%' AND content LIKE '%외접원%' LIMIT 5`,
  );
  console.log("== ④ 컬러 SVG 후보:");
  for (const r of colored)
    console.log("  ", r.problem_code, JSON.stringify(r.figure_urls));

  // ⑥ ABCD 원 O 외접 12cm/8cm
  const two1 = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null; figure_urls: unknown }>
  >(
    `SELECT id, problem_code, figure_urls FROM problem
     WHERE content LIKE '%ABCD%' AND content LIKE '%외접%' AND content LIKE '%12%' AND content LIKE '%8%' LIMIT 5`,
  );
  console.log("== ⑥ 해설그림 혼입 후보 (ABCD 외접):");
  for (const r of two1)
    console.log(
      "  ",
      r.problem_code,
      r.id.slice(0, 8),
      JSON.stringify(r.figure_urls),
    );

  // ⑩ 반원 O 접선 16cm
  const two2 = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null; figure_urls: unknown }>
  >(
    `SELECT id, problem_code, figure_urls FROM problem
     WHERE content LIKE '%반원%' AND content LIKE '%접선%' AND content LIKE '%16%' LIMIT 5`,
  );
  console.log("== ⑩ 해설그림 혼입 후보 (반원):");
  for (const r of two2)
    console.log(
      "  ",
      r.problem_code,
      r.id.slice(0, 8),
      JSON.stringify(r.figure_urls),
    );

  // ⑨ 소문항 번호 이중 (⑴ 뒤에 곧바로 (1))
  const dup = await p.$queryRawUnsafe<
    Array<{ id: string; problem_code: string | null }>
  >(
    `SELECT id, problem_code FROM problem
     WHERE content LIKE '%접시%' AND content LIKE '%중심%' LIMIT 3`,
  );
  console.log("== ⑨ 번호 이중 (접시 문항):");
  for (const r of dup) console.log("  ", r.problem_code, r.id.slice(0, 8));
  const dupCnt = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) n FROM problem WHERE direct_use_allowed = true AND (content ~ '⑴\\s*\\(1\\)' OR content ~ '⑵\\s*\\(2\\)')`,
  );
  console.log("  같은 부류(출제 가능):", Number(dupCnt[0]!.n), "건");

  // 그림 2장 이상 문항 — 해설 그림 혼입 의심 분모
  const multi = await p.$queryRawUnsafe<Array<{ n: bigint }>>(
    `SELECT COUNT(*) n FROM problem WHERE direct_use_allowed = true AND jsonb_array_length(figure_urls) >= 2`,
  );
  console.log("== 그림 2장 이상(출제 가능):", Number(multi[0]!.n), "건");
}
main().finally(() => p.$disconnect());
