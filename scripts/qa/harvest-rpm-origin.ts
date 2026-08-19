/**
 * RPM 교재본의 **출처를 한 번에 걷어와 우리 것으로 만든다.** 이 뒤로 sumaek 은 필요 없다.
 *
 *   npx tsx scripts/qa/harvest-rpm-origin.ts --schema   # 원본에 무슨 칸이 있는지 먼저 본다
 *   npx tsx scripts/qa/harvest-rpm-origin.ts            # 전량 수확 → 스냅샷
 *
 * 출력: `scripts/qa/reports/rpm-origin.json`  (**커밋한다** — 이게 정본이 된다)
 *
 * ## 왜 끊나
 *
 * RPM 4,862행은 `externalId`(sumaek 행 id) **하나로만** 원본에 매달려 있다. 책·쪽·문항번호가
 * 전부 NULL 이라, 그림을 다시 오리거나 「몇 쪽 몇 번 문항인가」를 물으려면 매번 sumaek 에
 * 접속해야 한다. 그 접속은 **저장소 밖 두 가지**에 의존한다:
 *   · `C:\Creative\sumaek\.env`                              (접속 정보)
 *   · `C:\Creative\sumaek\packages\db\node_modules\postgres`  (드라이버)
 * 둘 다 다른 컴퓨터엔 없다. 즉 지금 구조로는 **이 컴퓨터에서만** RPM 작업이 된다.
 *
 * 그래서 **한 번만 더 접속해서 필요한 것을 전부 가져오고**, 그 뒤로는 우리 스냅샷과
 * 우리 DB 칸만 본다. 원본이 사라져도 우리가 계속 굴릴 수 있어야 한다.
 *
 * ## 무엇을 가져오나
 *
 * · 책(`source_files.file_name`) · 쪽(`source_pages.page_number`) · 좌표(`source_coords`)
 * · 교재 문항번호(`printed_number`) — 「0988」 같은 그 번호
 * · 책 제목·학교급·학년대(`books.title`/`school_level`/`grade_band`)와 판(`book_editions`)
 * · **부모 문항**: 소문항은 좌표 상자가 번호 칸뿐이라 그림을 못 찾는다. 같은 쪽에서
 *   바로 위의 큰 상자를 부모로 잡으면 그 그림이 곧 소문항의 그림이다(문서 16 §4.1).
 *   부모 후보를 여기서 **전량 좌표째로** 가져와야 나중에 sumaek 없이 계산할 수 있다.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { readEnvFile } from "../import/readEnvFile";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
const OUT = "scripts/qa/reports/rpm-origin.json";

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
  if (!url)
    throw new Error("원본 접속 정보가 없다 — SUMAEK_DATABASE_URL 를 지정하라.");
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const mod = (await import(pathToFileURL(path.resolve(driverPath)).href)) as {
    default: (url: string, opts: Record<string, unknown>) => SqlClient;
  };
  const sql = mod.default(url, { max: 1, prepare: false });
  // **읽기만 한다.** 원본을 바꿀 일이 없으므로 세션째 잠근다.
  await sql.unsafe("SET default_transaction_read_only = on");
  return sql;
}

/** 한 번에 넣을 수 있는 id 개수. IN 목록이 너무 길면 서버가 거부한다. */
const CHUNK = 500;

type Ref = {
  unit?: { title?: string; number?: string } | null;
  chapter?: { title?: string; number?: string } | null;
  section?: string | null;
  column?: number | null;
  figureBoxes?: unknown[] | null;
};

/**
 * `source_ref` 에서 **우리가 쓸 것만** 남긴다. 통째로 담으면 bbox·book·edition·
 * printedNumber 가 바깥 칸과 중복돼 스냅샷이 7.3MB 가 된다(같은 값이 두 번 들어간다).
 *
 * `figureBoxes` 는 문항 상자가 아니라 **그림 자체의 사각형**이다 — 채워져 있으면
 * 검출을 건너뛰고 바로 오릴 수 있다(실측 1,348행).
 * `figureLabels` 는 안 담는다 — 표본을 보니 그림 라벨이 아니라 **해설 조각**이었다.
 */
function slimRef(raw: unknown): Record<string, unknown> {
  if (!raw) return {};
  const r = JSON.parse(String(raw)) as Ref;
  const out: Record<string, unknown> = {};
  if (r.unit?.title) out.unit = r.unit;
  if (r.chapter?.title) out.chapter = r.chapter;
  if (r.section) out.section = r.section;
  if (typeof r.column === "number") out.column = r.column;
  if (r.figureBoxes?.length) out.figureBoxes = r.figureBoxes;
  return out;
}

async function main(): Promise<void> {
  const wantSchema = process.argv.includes("--schema");
  const rows = await prisma.problem.findMany({
    where: {
      source: "transformed",
      originProblemId: null,
      externalId: { not: null },
    },
    select: { id: true, externalId: true },
  });
  console.log(`우리 RPM 행 ${rows.length}`);

  const sql = await connect();
  try {
    if (wantSchema) {
      const cols = await sql.unsafe(`
        SELECT table_name, column_name, data_type
        FROM information_schema.columns
        WHERE table_name IN ('questions','source_files','source_pages','book_editions','books')
        ORDER BY table_name, ordinal_position
      `);
      const by: Record<string, string[]> = {};
      for (const c of cols) {
        const t = String(c.table_name);
        (by[t] ??= []).push(`${c.column_name}:${c.data_type}`);
      }
      for (const [t, cs] of Object.entries(by))
        console.log(`\n■ ${t}\n   ${cs.join("\n   ")}`);
      return;
    }

    const out: Record<string, unknown>[] = [];
    for (let i = 0; i < rows.length; i += CHUNK) {
      const slice = rows.slice(i, i + CHUNK);
      const list = slice.map((r) => `'${r.externalId}'`).join(",");
      const got = await sql.unsafe(`
        SELECT q.id::text            AS "externalId",
               q.printed_number      AS "printedNumber",
               q.source_coords::text AS coords,
               p.page_number         AS page,
               f.file_name           AS book,
               f.page_count          AS "bookPages",
               b.title               AS "bookTitle",
               b.school_level        AS "schoolLevel",
               b.grade_band          AS "gradeBand",
               e.edition_label       AS edition,
               e.published_year      AS "publishedYear",
               q.source_ref::text    AS "sourceRef"
        FROM questions q
        LEFT JOIN source_pages p ON p.id = q.source_page_id
        LEFT JOIN source_files f ON f.id = q.source_file_id
        LEFT JOIN book_editions e ON e.id = q.book_edition_id
        LEFT JOIN books b ON b.id = e.book_id
        WHERE q.id IN (${list})
      `);
      out.push(...got);
      if ((i / CHUNK) % 4 === 0)
        console.log(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}`);
    }

    // 부모 후보 — 같은 책·같은 쪽의 **모든** 문항 좌표. 소문항의 그림을 찾을 때 쓴다.
    const pages = [
      ...new Set(
        out
          .filter((o) => o.book && o.page)
          .map((o) => `${o.book}\u0000${o.page}`),
      ),
    ];
    console.log(`쪽 ${pages.length}개의 이웃 문항을 걷는다`);
    const neighbours: Record<string, unknown>[] = [];
    for (let i = 0; i < pages.length; i += 100) {
      const cond = pages
        .slice(i, i + 100)
        .map((k) => {
          const [book, page] = k.split("\u0000");
          return `(f.file_name = '${book!.replace(/'/g, "''")}' AND p.page_number = ${Number(page)})`;
        })
        .join(" OR ");
      const got = await sql.unsafe(`
        SELECT q.id::text AS "externalId", q.printed_number AS "printedNumber",
               q.source_coords::text AS coords, p.page_number AS page, f.file_name AS book
        FROM questions q
        JOIN source_pages p ON p.id = q.source_page_id
        JOIN source_files f ON f.id = q.source_file_id
        WHERE ${cond}
      `);
      neighbours.push(...got);
    }

    const byExternal = new Map(rows.map((r) => [r.externalId!, r.id]));
    const 목록 = out.map((o) => ({
      problemId: byExternal.get(String(o.externalId)) ?? null,
      externalId: o.externalId,
      book: o.book ?? null,
      bookPages: o.bookPages ?? null,
      page: o.page ?? null,
      printedNumber: o.printedNumber ?? null,
      bookTitle: o.bookTitle ?? null,
      schoolLevel: o.schoolLevel ?? null,
      gradeBand: o.gradeBand ?? null,
      edition: o.edition ?? null,
      publishedYear: o.publishedYear ?? null,
      ...slimRef(o.sourceRef),
      rect: o.coords
        ? (JSON.parse(String(o.coords)) as Record<string, number>)
        : null,
    }));

    mkdirSync("scripts/qa/reports", { recursive: true });
    writeFileSync(
      OUT,
      JSON.stringify(
        {
          기준: "sumaek questions/source_files/source_pages 1회 수확 — 이 뒤로 원본 접속 없음",
          수확시각: new Date().toISOString(),
          우리행: rows.length,
          원본에있음: 목록.length,
          이웃문항: neighbours.length,
          목록,
          이웃: neighbours.map((n) => ({
            externalId: n.externalId,
            book: n.book,
            page: n.page,
            printedNumber: n.printedNumber,
            rect: n.coords
              ? (JSON.parse(String(n.coords)) as Record<string, number>)
              : null,
          })),
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(
      `\n수확 ${목록.length}행 · 이웃 ${neighbours.length}행 → ${OUT}`,
    );
  } finally {
    await sql.end();
    await prisma.$disconnect();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
