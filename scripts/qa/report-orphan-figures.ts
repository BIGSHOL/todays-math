/**
 * `public/figures/**` 에 있는데 **DB 가 아무도 안 가리키는** 그림 파일을 센다.
 *
 *   npx tsx scripts/qa/report-orphan-figures.ts            # 전체
 *   npx tsx scripts/qa/report-orphan-figures.ts hwppdf-    # 이름이 이걸로 시작하는 것만
 *
 * ⚠️ **공유 DB(D-31) 라 매번 다시 세라.** 다른 세션이 그 사이 붙였으면 고아가 아니다.
 *    이 스크립트는 **세기만 한다** — 지우지 않는다. 지우는 것은 원장님 판단이다.
 */
import fs from "node:fs";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

const ROOT = "public/figures";

function walk(dir: string, out: string[]): void {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else out.push("/" + path.relative("public", p).split(path.sep).join("/"));
  }
}

async function main(): Promise<void> {
  const prefix = process.argv[2] ?? "";
  const all: string[] = [];
  walk(ROOT, all);
  const files = all.filter((f) => path.basename(f).startsWith(prefix));
  const prisma = new PrismaClient();
  // 컬럼을 손으로 적되, **DB 를 훑어 실제와 다르면 멈춘다**는 원칙은
  // `checkDeployedFigures.ts` 에 있다. 여기서는 그 스크립트가 보는 것과 같은
  // 컬럼(`figureUrls`)만 본다 — 파일을 가리키는 컬럼이 늘면 여기도 같이 고쳐라.
  const used = new Set<string>();
  const rows = await prisma.problem.findMany({ select: { figureUrls: true } });
  for (const r of rows) for (const u of r.figureUrls) used.add(u);
  const orphan = files.filter((f) => !used.has(f));
  console.log(
    `그림 파일 ${files.length}장${prefix ? ` (이름 ${prefix}*)` : ""}` +
      ` · DB 가 가리키는 것 ${files.length - orphan.length} · 고아 ${orphan.length}`,
  );
  for (const o of orphan.slice(0, 60)) console.log("   고아 " + o);
  if (orphan.length > 60) console.log(`   … 그리고 ${orphan.length - 60}장 더`);
  await prisma.$disconnect();
}

void main();
