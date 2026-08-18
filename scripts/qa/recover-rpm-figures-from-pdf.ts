/**
 * RPM 그림 2차 회수 — **원본 교재 PDF 에서 좌표대로 오려온다.**
 *
 *   npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts              계획만(내려받기 없음)
 *   npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts --fetch      원본 PDF 내려받기
 *   npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts --attach     오려낸 것을 DB 에 붙이기
 *      (붙이기는 ALLOW_SHARED_IMPORT=1 이 있어야 실제로 쓴다)
 *
 * 오려내기 자체는 파이썬이 한다(PyMuPDF):
 *   python scripts/figure/crop-rpm-from-pdf.py
 *
 * ## 왜 이 길인가 — 「고갈」은 한 테이블 얘기였다
 *
 * `recover-rpm-figures.ts` 는 원본 `diagram_assets` 를 훑어 1,182문항을 가져왔고 거기서 끝났다.
 * 남은 문항은 그 테이블에 행이 **정말로 없다**(직접 세어 0 확인). 그래서 「회수 경로 고갈」이
 * 맞다고 적었는데 — **그건 그 테이블 얘기였다.** 원본에는 다른 길이 있었다:
 *
 *   `questions.source_coords` = `{"x0":56.67,"x1":296.48,"y0":635.94,"y1":713.39,"page":42}`
 *
 * 문항마다 **원본 PDF 의 어느 페이지 어느 사각형**인지가 그대로 적혀 있다(667/671 보유).
 * 필요한 원본은 교재 6권뿐이다. 기출에 쓴 것과 **같은 방식**(원본 오려오기, 재작도 0)이다.
 *
 * ## 지키는 것
 *
 * - 원본 DB 는 **읽기만** 한다. 세션을 읽기 전용으로 잠근다.
 * - 내려받은 PDF 는 저장소에 넣지 않는다 — `.rpm-src/` (gitignore).
 * - 오려낸 그림이 **파일로 실재할 때만** DB 에 붙인다. 깨진 이미지는 그림 없음보다 나쁘다.
 * - 붙인 뒤에는 `apply-missing-figure-lock.ts --revert --recovered` 로 잠금을 푼다.
 *   회수와 해제는 한 세트다(문서 16 §3.1).
 */
import { mkdir, writeFile, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { readEnvFile } from "../import/readEnvFile";
import {
  classifyFigureNeed,
  MENTIONS_FIGURE_WHERE,
  NO_FIGURE_WHERE,
} from "./missingFigureRule";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
/** sumaek 원본 업로드 버킷. 공개가 아니라 서비스 키가 필요하다. */
const BUCKET = "sources";
/** 내려받은 교재 PDF 를 두는 곳 — 저장소에 넣지 않는다. */
const SRC_DIR = ".rpm-src";
const PLAN = "scripts/qa/reports/rpm-crop-plan.json";
const CROP_RESULT = "scripts/qa/reports/rpm-crop-result.json";

/**
 * 로컬에 둘 파일 이름. `storage_path` 가 `local:RPM 중학 1-1 학생용.pdf` 처럼
 * **`local:` 접두사**로 오는데(스토리지에 올라간 적이 없다는 뜻), 그대로 쓰면 윈도우에서
 * 만들 수 없는 이름이 된다. 원장님이 교재 PDF 를 `.rpm-src/` 에 **그냥 떨어뜨리면**
 * 맞아떨어지도록 원본 파일명을 쓴다.
 */
function localName(fileName: string, storagePath: string): string {
  const raw = fileName?.trim() || storagePath.replace(/^local:/, "");
  return path.basename(raw.replace(/^local:/, ""));
}

const FETCH = process.argv.includes("--fetch");
const ATTACH = process.argv.includes("--attach");
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const prisma = new PrismaClient();

type SqlClient = {
  unsafe: (q: string) => Promise<Array<Record<string, unknown>>>;
  end: () => Promise<void>;
};

type PlanItem = {
  problemId: string;
  externalId: string;
  pdf: string;
  page: number;
  /** PDF 좌표계 사각형 — 파이썬이 그대로 `fitz.Rect` 로 쓴다. */
  rect: [number, number, number, number];
  out: string;
};

async function sumaekEnv() {
  const env = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  const databaseUrl =
    process.env.SUMAEK_DATABASE_URL?.trim() || env?.DATABASE_URL?.trim();
  const supabaseUrl =
    process.env.SUMAEK_SUPABASE_URL?.trim() ||
    env?.NEXT_PUBLIC_SUPABASE_URL?.trim();
  const serviceKey =
    process.env.SUMAEK_SERVICE_ROLE_KEY?.trim() ||
    env?.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (!databaseUrl) throw new Error("원본 접속 정보가 없다 (DATABASE_URL).");
  return { databaseUrl, supabaseUrl, serviceKey };
}

async function connect(url: string): Promise<SqlClient> {
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: (u: string, o: unknown) => SqlClient;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "recover-rpm-figures-from-pdf-readonly" },
  });
  await sql.unsafe("SET default_transaction_read_only = on");
  await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
  return sql;
}

/** 우리 DB 에서 「그림 유실 RPM 문항」의 원본 id 를 뽑는다. */
async function targets(): Promise<Map<string, string>> {
  const rows = await prisma.problem.findMany({
    where: {
      ...MENTIONS_FIGURE_WHERE,
      ...NO_FIGURE_WHERE,
      source: "transformed",
    },
    select: { id: true, externalId: true, content: true },
  });
  const map = new Map<string, string>();
  for (const r of rows) {
    if (classifyFigureNeed(r.content) !== "유실") continue;
    if (r.externalId && UUID.test(r.externalId)) map.set(r.externalId, r.id);
  }
  return map;
}

async function buildPlan(): Promise<PlanItem[]> {
  const byExternal = await targets();
  console.log(`그림 유실 RPM ${byExternal.size}건 (원본 id 보유)`);
  const { databaseUrl } = await sumaekEnv();
  const sql = await connect(databaseUrl);
  try {
    const list = [...byExternal.keys()].map((v) => `'${v}'`).join(",");
    const rows = await sql.unsafe(`
      SELECT q.id::text AS id, q.source_coords::text AS coords,
             f.storage_path, f.file_name
      FROM questions q
      JOIN source_files f ON f.id = q.source_file_id
      WHERE q.id IN (${list}) AND q.source_coords IS NOT NULL
    `);
    const plan: PlanItem[] = [];
    let bad = 0;
    for (const r of rows) {
      const c = JSON.parse(String(r.coords)) as Record<string, number>;
      // 좌표가 온전하지 않으면 **오려내지 않는다** — 엉뚱한 자리를 오리면 그림 없음보다 나쁘다.
      const ok =
        [c.x0, c.y0, c.x1, c.y1, c.page].every((v) => typeof v === "number") &&
        c.x1! > c.x0! &&
        c.y1! > c.y0!;
      if (!ok) {
        bad += 1;
        continue;
      }
      const externalId = String(r.id);
      plan.push({
        problemId: byExternal.get(externalId)!,
        externalId,
        pdf: path.join(
          SRC_DIR,
          localName(String(r.file_name), String(r.storage_path)),
        ),
        page: c.page!,
        rect: [c.x0!, c.y0!, c.x1!, c.y1!],
        out: path.join("public", "figures", "rpm", externalId, "0.png"),
      });
    }
    if (bad > 0) console.log(`⚠️ 좌표가 온전하지 않아 제외 ${bad}건`);

    const files = await sql.unsafe(`
      SELECT DISTINCT f.storage_path, f.file_name
      FROM questions q JOIN source_files f ON f.id = q.source_file_id
      WHERE q.id IN (${list})
    `);
    await mkdir(path.dirname(PLAN), { recursive: true });
    await writeFile(
      PLAN,
      JSON.stringify(
        {
          기준: "questions.source_coords 로 원본 교재 PDF 를 오려낸다",
          문항수: plan.length,
          원본: files.map((f) => ({
            storagePath: String(f.storage_path),
            local: path.join(
              SRC_DIR,
              localName(String(f.file_name), String(f.storage_path)),
            ),
            fileName: String(f.file_name),
          })),
          목록: plan,
        },
        null,
        1,
      ),
      "utf8",
    );
    console.log(`계획 ${plan.length}건 · 원본 ${files.length}개 → ${PLAN}`);
    return plan;
  } finally {
    await sql.end();
  }
}

/** Supabase Storage 의 비공개 버킷에서 내려받는다. 서비스 키는 **헤더로만** 쓴다. */
async function fetchSources() {
  const { supabaseUrl, serviceKey } = await sumaekEnv();
  if (!supabaseUrl || !serviceKey) {
    throw new Error(
      "스토리지 주소 또는 서비스 키가 없다 — SUMAEK_SUPABASE_URL / SUMAEK_SERVICE_ROLE_KEY 를 지정하라.",
    );
  }
  const plan = JSON.parse(
    await (await import("node:fs/promises")).readFile(PLAN, "utf8"),
  ) as {
    원본: Array<{ storagePath: string; local: string; fileName: string }>;
  };

  await mkdir(SRC_DIR, { recursive: true });
  for (const f of plan.원본) {
    try {
      const s = await stat(f.local);
      if (s.size > 0) {
        console.log(
          `  이미 있음 ${f.fileName} (${Math.round(s.size / 1048576)}MB)`,
        );
        continue;
      }
    } catch {
      /* 없으면 받는다 */
    }
    const url = `${supabaseUrl}/storage/v1/object/${BUCKET}/${f.storagePath}`;
    const res = await fetch(url, {
      headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` },
    });
    if (!res.ok) {
      console.log(`  ✗ ${f.fileName} — HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    // PDF 매직 바이트 — 오류 페이지를 PDF 로 저장하면 오려내기가 조용히 헛돈다.
    if (!buf.subarray(0, 4).equals(Buffer.from("%PDF"))) {
      console.log(`  ✗ ${f.fileName} — PDF 가 아니다 (${buf.length}B)`);
      continue;
    }
    await writeFile(f.local, buf);
    console.log(`  ✓ ${f.fileName} ${Math.round(buf.length / 1048576)}MB`);
  }
}

/** 오려낸 결과를 DB 에 붙인다. **파일이 실재하는 것만.** */
async function attach() {
  const { readFile } = await import("node:fs/promises");
  const result = JSON.parse(await readFile(CROP_RESULT, "utf8")) as {
    성공: Array<{ problemId: string; publicPath: string }>;
  };
  console.log(`오려내기 성공 ${result.성공.length}건`);

  const alive: typeof result.성공 = [];
  for (const r of result.성공) {
    try {
      await stat(path.join("public", r.publicPath.replace(/^\//, "")));
      alive.push(r);
    } catch {
      /* 파일이 없으면 붙이지 않는다 */
    }
  }
  console.log(`파일이 실재하는 것 ${alive.length}건`);

  if (process.env.ALLOW_SHARED_IMPORT !== "1") {
    console.log(
      "\n공유 DB 쓰기가 막혀 있다. 붙이려면 ALLOW_SHARED_IMPORT=1 을 붙여라.",
    );
    return;
  }
  let done = 0;
  for (const r of alive) {
    await prisma.problem.update({
      where: { id: r.problemId },
      data: { figureUrls: [r.publicPath], figureSource: "source" },
    });
    done += 1;
    if (done % 200 === 0) console.log(`  … ${done}/${alive.length}`);
  }
  console.log(`붙였다: ${done}건`);
  console.log(
    "이제 잠금을 푼다: ALLOW_UNIT_FIX=1 npx tsx scripts/qa/apply-missing-figure-lock.ts --revert --recovered",
  );
}

async function main() {
  if (ATTACH) return attach();
  await buildPlan();
  if (FETCH) {
    console.log("\n── 원본 내려받기 ──");
    await fetchSources();
    console.log("\n다음: python scripts/figure/crop-rpm-from-pdf.py");
  } else {
    console.log("\n원본을 받으려면 --fetch 를 붙여라.");
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
