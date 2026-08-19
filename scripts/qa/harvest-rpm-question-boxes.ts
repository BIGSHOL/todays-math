/**
 * RPM 교재 6권의 **문항 좌표를 통째로** 받아 온다. 읽기만 한다.
 *
 *   npx tsx scripts/qa/harvest-rpm-question-boxes.ts
 *
 * 산출: `scripts/qa/reports/rpm-question-boxes.json`
 *   `{ 책이름: { 쪽번호: [ {id, printed, rect, figureBoxes, column}, … ] } }`
 *
 * ## 왜 전량인가
 *
 * 그림이 유실된 362행의 `source_coords` 는 대개 **소문항 한 줄**만 담고 있다
 * (폭 중앙값 156pt · 높이 중앙값 30pt). 교과서문제 지면은 `[0014~0017]` 처럼
 * **여러 소문항이 한 발문과 한 그림을 나눠 쓰는** 구조라, 그림은 어느 소문항의
 * 상자에도 안 들어 있다. 그림을 찾으려면 **그 무리 전체가 차지한 띠**를 알아야
 * 하고, 그러려면 우리 대상 행뿐 아니라 **같은 쪽의 모든 문항 상자**가 필요하다.
 *
 * 곁들여 `source_ref.figureBoxes` 도 받는다 — 추출기가 그림 사각형을 **적어 둔**
 * 문항이 있다(대상 362행 중 39행). 추측보다 이쪽이 강한 근거다.
 *
 * ## 지키는 것
 *
 * - 원본 DB 는 **읽기만** 한다. 세션을 읽기 전용으로 잠근다.
 * - 접속 정보는 저장소에 넣지 않는다 — `SUMAEK_DATABASE_URL` →
 *   `SUMAEK_ENV_PATH`(기본 `C:\Creative\sumaek\.env`) 순으로 본다.
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { readEnvFile } from "../import/readEnvFile";

const DEFAULT_SUMAEK_ENV = "C:/Creative/sumaek/.env";
const DEFAULT_POSTGRES_JS =
  "C:/Creative/sumaek/packages/db/node_modules/postgres/src/index.js";
const OUT = "scripts/qa/reports/rpm-question-boxes.json";

type SqlClient = {
  unsafe: (q: string) => Promise<Array<Record<string, unknown>>>;
  end: () => Promise<void>;
};

type Box = {
  id: string;
  printed: string | null;
  rect: [number, number, number, number];
  figureBoxes: Array<[number, number, number, number]>;
  column: number | null;
};

async function connect(): Promise<SqlClient> {
  const env = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  const url =
    process.env.SUMAEK_DATABASE_URL?.trim() || env?.DATABASE_URL?.trim();
  if (!url) throw new Error("원본 접속 정보가 없다 (DATABASE_URL).");
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: (u: string, o: unknown) => SqlClient;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "harvest-rpm-question-boxes-readonly" },
  });
  await sql.unsafe("SET default_transaction_read_only = on");
  await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  return sql;
}

function num(v: unknown): number | null {
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

async function main() {
  const sql = await connect();
  try {
    const rows = await sql.unsafe(`
      SELECT q.id::text AS id, q.printed_number AS printed, f.file_name AS file,
             q.source_coords::text AS coords,
             coalesce(q.source_ref->'figureBoxes', '[]'::jsonb)::text AS fig,
             q.source_ref->>'column' AS col
      FROM questions q JOIN source_files f ON f.id = q.source_file_id
      WHERE f.file_name LIKE 'RPM %'
        AND q.source_coords IS NOT NULL
    `);
    const out: Record<string, Record<string, Box[]>> = {};
    let skipped = 0;
    for (const r of rows) {
      const c = JSON.parse(String(r.coords)) as Record<string, unknown>;
      const x0 = num(c.x0);
      const y0 = num(c.y0);
      const x1 = num(c.x1);
      const y1 = num(c.y1);
      const page = num(c.page);
      if (
        x0 === null ||
        y0 === null ||
        x1 === null ||
        y1 === null ||
        page === null
      ) {
        skipped += 1;
        continue;
      }
      const figs: Array<[number, number, number, number]> = [];
      for (const f of JSON.parse(String(r.fig)) as Array<
        Record<string, unknown>
      >) {
        const a = num(f.x0);
        const b = num(f.y0);
        const cc = num(f.x1);
        const d = num(f.y1);
        if (
          a !== null &&
          b !== null &&
          cc !== null &&
          d !== null &&
          cc > a &&
          d > b
        ) {
          figs.push([a, b, cc, d]);
        }
      }
      const file = String(r.file);
      (out[file] ??= {})[String(page)] ??= [];
      out[file][String(page)].push({
        id: String(r.id),
        printed: r.printed === null ? null : String(r.printed),
        rect: [x0, y0, x1, y1],
        figureBoxes: figs,
        column: num(r.col),
      });
    }
    for (const file of Object.keys(out)) {
      for (const page of Object.keys(out[file])) {
        out[file][page].sort(
          (a, b) => a.rect[1] - b.rect[1] || a.rect[0] - b.rect[0],
        );
      }
    }
    await mkdir(path.dirname(OUT), { recursive: true });
    await writeFile(OUT, JSON.stringify(out), "utf8");
    const total = Object.values(out)
      .flatMap((p) => Object.values(p))
      .reduce((s, v) => s + v.length, 0);
    console.log(
      `책 ${Object.keys(out).length}권 · 문항 ${total}개 (좌표 불량 제외 ${skipped}) → ${OUT}`,
    );
    for (const [file, pages] of Object.entries(out)) {
      const n = Object.values(pages).reduce((s, v) => s + v.length, 0);
      const withFig = Object.values(pages)
        .flat()
        .filter((b) => b.figureBoxes.length > 0).length;
      console.log(
        `   ${file}: ${n}문항 · ${Object.keys(pages).length}쪽 · figureBoxes ${withFig}`,
      );
    }
  } finally {
    await sql.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});
