import { PrismaClient } from "@prisma/client";
const p = new PrismaClient();
(async () => {
  const col = (await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM information_schema.columns WHERE table_name='problem' AND column_name='choice_figure_index'`,
  )) as { n: number }[];
  const tot = (await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM problem`,
  )) as { n: number }[];
  const ver = (await p.$queryRawUnsafe(`SHOW server_version`)) as {
    server_version: string;
  }[];
  const locked = (await p.$queryRawUnsafe(
    `SELECT count(*)::int AS n FROM problem WHERE direct_use_allowed = false`,
  )) as { n: number }[];
  console.log("choice_figure_index 컬럼 존재:", col[0]!.n > 0);
  console.log("problem 행수:", tot[0]!.n);
  console.log("PostgreSQL:", ver[0]!.server_version);
  console.log("지금 출제 제외(false) 행수:", locked[0]!.n);
  await p.$disconnect();
})();
