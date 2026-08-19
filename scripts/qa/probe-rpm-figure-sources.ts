/**
 * RPM 그림 671건 — **회수할 길이 남아 있는지 한 번에 묻는다.** 읽기만 한다.
 *
 *   npx tsx scripts/qa/probe-rpm-figure-sources.ts
 *
 * ## 왜 이 조사인가
 *
 * `recover-rpm-figures.ts` 가 원본 `diagram_assets` 를 두 차례 훑어 1,182문항을 가져왔고,
 * 남은 문항은 **그 테이블에 행이 아예 없다**(원본 6,151 중 그림 보유 1,531).
 * 그래서 「그 길은 고갈」이 맞다. 다만 sumaek 스키마에는 아무도 안 본 다른 길이 있다:
 *
 *   · `questions.source_file_id` / `source_page_id` / `source_coords`(crop bbox)
 *   · `source_pages.image_path` — 렌더된 페이지 raster
 *   · `source_files.storage_path` — 원본 PDF (버킷 `sources`)
 *   · `question_assets` — `kind = image_crop | table_image | …`
 *
 * 하나라도 채워져 있으면 기출에 쓴 것과 **같은 방식**(원본에서 오려오기)이 열린다.
 * 비어 있으면 재작도나 폐기밖에 없다. 그 답을 SELECT 몇 개로 확정한다.
 *
 * ## 지키는 것
 *
 * - 원본은 **읽기만** 한다. 세션을 읽기 전용으로 잠그고 시작한다.
 * - 우리 DB 도 읽기만 한다. 이 스크립트는 아무것도 쓰지 않는다.
 * - 접속 정보는 저장소에 넣지 않는다 — `recover-rpm-figures.ts` 와 같은 규칙으로
 *   `SUMAEK_DATABASE_URL` → `SUMAEK_ENV_PATH`(기본 `C:\Creative\sumaek\.env`) 순으로 본다.
 */
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { readEnvFile } from "../import/readEnvFile";
import {
  classifyFigure,
  MENTIONS_FIGURE_WHERE,
  NO_FIGURE_WHERE,
} from "../../src/lib/figure/missingFigureRule";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";

const prisma = new PrismaClient();

type SqlClient = {
  unsafe: (query: string) => Promise<Array<Record<string, unknown>>>;
  end: () => Promise<void>;
};

async function connect(): Promise<SqlClient> {
  const envFile = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  const url =
    process.env.SUMAEK_DATABASE_URL?.trim() || envFile?.DATABASE_URL?.trim();
  if (!url) {
    throw new Error(
      "원본 접속 정보가 없다 — SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하라.",
    );
  }
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: (u: string, o: unknown) => SqlClient;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "probe-rpm-figure-sources-readonly" },
  });
  // 원본은 읽기만 한다 — 세션 자체를 읽기 전용으로 잠근다.
  await sql.unsafe("SET default_transaction_read_only = on");
  await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  return sql;
}

/** SQL 리터럴로 안전하게 넣기 위한 UUID 검증 — 아닌 것은 애초에 버린다. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function main() {
  // 1) 우리 DB — 그림이 유실된 RPM 문항의 원본 id(`externalId`)
  const rows = await prisma.problem.findMany({
    where: {
      ...MENTIONS_FIGURE_WHERE,
      ...NO_FIGURE_WHERE,
      source: "transformed",
    },
    select: { externalId: true, content: true },
  });
  const broken = rows.filter((r) => classifyFigure(r.content) === "유실");
  const ids = broken
    .map((r) => r.externalId)
    .filter((v): v is string => Boolean(v) && UUID.test(v!));

  console.log(
    `RPM 그림 유실 ${broken.length}건 · 원본 id 있는 것 ${ids.length}건`,
  );
  if (ids.length === 0) {
    console.log("원본 id 가 없어 조회할 수 없다.");
    return;
  }
  const list = ids.map((v) => `'${v}'`).join(",");

  const sql = await connect();
  try {
    // 2) 원본에 그 문항이 있나 + 오려낼 좌표/페이지/파일이 채워져 있나
    const [cover] = await sql.unsafe(`
      SELECT
        count(*)                                        AS 원본에_있음,
        count(q.source_file_id)                         AS source_file_id,
        count(q.source_page_id)                         AS source_page_id,
        count(q.source_coords)                          AS source_coords,
        count(p.image_path)                             AS 페이지_raster,
        count(f.storage_path)                           AS 원본파일_경로
      FROM questions q
      LEFT JOIN source_pages p ON p.id = q.source_page_id
      LEFT JOIN source_files f ON f.id = q.source_file_id
      WHERE q.id IN (${list})
    `);
    console.log("\n■ 오려오기 경로 (questions → source_pages / source_files)");
    for (const [k, v] of Object.entries(cover ?? {})) {
      console.log(`   ${k.padEnd(16)} ${v}`);
    }

    // 3) question_assets — 그림이 다른 이름으로 들어 있을 수 있다
    const assets = await sql.unsafe(`
      SELECT a.kind, count(*) AS n, count(DISTINCT q.id) AS 문항수
      FROM question_assets a
      JOIN question_versions v ON v.id = a.question_version_id
      JOIN questions q ON q.id = v.question_id
      WHERE q.id IN (${list})
      GROUP BY a.kind ORDER BY n DESC
    `);
    console.log("\n■ question_assets (kind 별)");
    if (assets.length === 0) console.log("   없음");
    for (const a of assets)
      console.log(`   ${String(a.kind).padEnd(16)} ${a.n} (문항 ${a.문항수})`);

    // 4) diagram_assets — 「고갈」이 지금도 맞는지 다시 센다.
    //    남의 보고를 믿지 않고 이 자리에서 확인한다.
    const [diag] = await sql.unsafe(`
      SELECT count(*) AS n, count(DISTINCT q.id) AS 문항수
      FROM diagram_assets da
      JOIN question_versions v ON v.id = da.question_version_id
      JOIN questions q ON q.id = v.question_id
      WHERE q.id IN (${list})
    `);
    console.log(`\n■ diagram_assets  행 ${diag?.n} · 문항 ${diag?.문항수}`);

    // 4-1) 오려내려면 좌표의 **모양**과 원본 파일의 **크기**를 알아야 한다.
    //      좌표계(원점·단위)를 모르면 엉뚱한 자리를 오린다.
    const shape = await sql.unsafe(`
      SELECT q.id::text AS id, q.source_coords::text AS coords, q.printed_number,
             p.page_number, f.file_name, f.mime_type, f.byte_size, f.page_count
      FROM questions q
      JOIN source_pages p ON p.id = q.source_page_id
      JOIN source_files f ON f.id = q.source_file_id
      WHERE q.id IN (${list}) LIMIT 3
    `);
    console.log("\n■ 좌표·원본 파일 표본");
    for (const s of shape) console.log(`   ${JSON.stringify(s)}`);

    const perFile = await sql.unsafe(`
      SELECT f.file_name, f.byte_size, f.page_count, count(*) AS 문항수
      FROM questions q JOIN source_files f ON f.id = q.source_file_id
      WHERE q.id IN (${list})
      GROUP BY f.file_name, f.byte_size, f.page_count
      ORDER BY 문항수 DESC
    `);
    const totalBytes = perFile.reduce((s, r) => s + Number(r.byte_size), 0);
    console.log(
      `\n■ 내려받아야 할 원본 ${perFile.length}개 · 합계 ${Math.round(totalBytes / 1048576)} MB`,
    );
    for (const r of perFile.slice(0, 10)) {
      console.log(
        `   ${String(r.문항수).padStart(4)}문항 · ${String(Math.round(Number(r.byte_size) / 1048576)).padStart(4)}MB · ${r.file_name}`,
      );
    }
    if (perFile.length > 10) console.log(`   … 그 외 ${perFile.length - 10}개`);

    // 5) 대조군 — **이미 회수된 문항**은 위 값들이 어떻게 생겼나.
    //    유실분만 보면 「원래 다 비어 있는 것」인지 「유실분만 비어 있는 것」인지 못 가른다.
    const done = await prisma.problem.findMany({
      where: { source: "transformed", NOT: { figureUrls: { isEmpty: true } } },
      select: { externalId: true },
      take: 400,
    });
    const doneIds = done
      .map((d) => d.externalId)
      .filter((v): v is string => Boolean(v) && UUID.test(v!));
    if (doneIds.length > 0) {
      const [ref] = await sql.unsafe(`
        SELECT count(*) AS 원본에_있음, count(q.source_coords) AS source_coords,
               count(q.source_page_id) AS source_page_id
        FROM questions q WHERE q.id IN (${doneIds.map((v) => `'${v}'`).join(",")})
      `);
      console.log(
        `\n■ 대조군(이미 그림 회수된 ${doneIds.length}문항): ` +
          `원본에 ${ref?.원본에_있음} · source_coords ${ref?.source_coords} · source_page_id ${ref?.source_page_id}`,
      );
    }
  } finally {
    await sql.end();
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
