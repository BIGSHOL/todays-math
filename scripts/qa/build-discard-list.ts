/**
 * **폐기 후보 문항 목록**을 만든다. 원장님이 직접 검수하실 자료다.
 *
 * 정답 백필에서 담당자가 "정답을 낼 수 없다"고 판정한 문항을 모아, 사유별로
 * 나누고 **어느 시험지 몇 번인지** 원본 위치를 붙인다. 문항 본문은 싣지 않는다.
 *
 * ⚠️ 목록은 **한 번 만들고 끝나는 게 아니다.** 정답이 채워지거나 그림이 새로
 * 붙으면 후보에서 빠져야 한다. 실제로 첫 목록 948건 중 366건은 그 사이 정답이
 * 채워졌고 109건은 그림이 붙었다 — 그대로 뒀으면 이미 살아난 문항까지 검수하시게
 * 된다. 그래서 일회성 분석이 아니라 **다시 돌릴 수 있는 스크립트**로 남긴다.
 *
 *   npx tsx scripts/qa/build-discard-list.ts
 *   → scripts/qa/reports/discard-candidates.json   (기계용 전량)
 *   → docs/planning/12-discard-candidates.md       (원장님용 문서)
 *
 * 원본 위치는 두 갈래로 찾는다.
 *  - 기출: `externalId` 가 `<examId>-<번호>` 다. exam_index.db 에서 N드라이브
 *    원본 경로·학교·연도·차수를 가져온다.
 *  - RPM: `externalId` 가 없다. 본문 완전일치로 sumaek 을 역추적해 교재·문항번호를
 *    가져온다(`recover-rpm-answers.ts` 의 매칭을 그대로 재사용).
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";

import {
  keysOf,
  readSource,
  resolveSourceUrl,
  toSourceRow,
  type SourceRow,
} from "./recover-rpm-answers";

const SOLVED_DIRS = [
  "scripts/qa/reports/answer-solved",
  "scripts/qa/reports/answer-solved-fig",
  "scripts/qa/reports/answer-solved-r3",
];
const PAIRS = "scripts/qa/reports/final-pairs.json";
const JSON_OUT = "scripts/qa/reports/discard-candidates.json";
const DOC_OUT = "docs/planning/12-discard-candidates.md";
const SENTINEL = "정답 없음";
const PER_SECTION = 50;

/** `why` 한 줄을 사유로 가른다. 순서가 곧 우선순위 — 위에서부터 먼저 걸린다. */
const CATEGORIES: Array<{ name: string; test: RegExp; note: string }> = [
  {
    name: "해설지 적재",
    test: /해설|풀이문|정답지/,
    note: "문항이 아니라 해설·풀이문이 들어왔다. 문제가 아니므로 뺀다.",
  },
  {
    name: "문항 병합",
    test: /병합|합쳐|여러 문항|두 문항/,
    note: "여러 문항이 한 레코드에 뭉쳐 있다. 쪼개거나 뺀다.",
  },
  {
    name: "원본 모순",
    test: /모순|성립하지|충돌|불가능한 조건/,
    note: "원본 시험지의 조건이 서로 충돌해 풀리지 않는다.",
  },
  {
    name: "증명·작도형",
    test: /증명|작도|그리시오|설명하|서술하/,
    note: "결함이 아니라 성격이다 — 단답 정답이 없는 문항. 일일테스트에 쓰지 않을 것이면 빼고, 서술형으로 쓸 것이면 남긴다.",
  },
  {
    name: "그림 없음",
    test: /그림|그래프|표|산점도|도형|자료/,
    note: "본문은 그림·표를 가리키는데 그림이 붙어 있지 않다.",
  },
  {
    name: "수식 OCR 훼손",
    test: /수식|식이|OCR|깨[졌재]|훼손|복원/,
    note: "식이 깨져 복원이 안 된다.",
  },
  {
    name: "본문 결손",
    test: /누락|잘림|잘려|없[어음]|비어|공란|결손/,
    note: "물음·조건·보기가 통째로 빠져 문제가 성립하지 않는다.",
  },
];

interface Failed {
  id: string;
  why: string;
}

interface Candidate {
  id: string;
  source: string;
  externalId: string | null;
  category: string;
  why: string;
  unit: string | null;
  /**
   * 완료본 HWP 원본 경로. **있으면 폐기 대상이 아니라 재추출 대상이다.**
   * 이관은 본문을 PDF 텍스트 레이어에서 뽑았는데(extract-final-batch.py 180행)
   * HWP 에는 stem·보기·정답·소단원·배점·해설이 온전히 들어 있다 —
   * 여기 실린 "OCR 훼손"·"본문 결손"·"해설만 들어 있음" 의 상당수가 그 탓이다.
   */
  hwp: string | null;
  origin: {
    kind: "past_exam" | "rpm" | "unknown";
    label: string;
    srcPath?: string;
    questionNumber?: number;
    sumaekId?: string;
    printedNumber?: string | null;
    match?: "unique" | "ambiguous";
  };
}

/** examId → 완료본 HWP 경로. 짝 2,950편 중 2,944편에 HWP 가 있다. */
async function loadHwpPaths(): Promise<Map<number, string>> {
  const out = new Map<number, string>();
  try {
    const doc = JSON.parse(await readFile(PAIRS, "utf-8")) as {
      pairs: Array<{ examId: number; hwp: string | null }>;
    };
    for (const p of doc.pairs) if (p.hwp) out.set(p.examId, p.hwp);
  } catch {
    // 짝 파일이 없으면 전부 재추출 불가로 본다 — 없는 근거를 지어내지 않는다.
  }
  return out;
}

function categorize(why: string): string {
  for (const c of CATEGORIES) if (c.test.test(why)) return c.name;
  return "기타";
}

/** 답안 파일들에서 `ok:false` 인 것만 모은다. 뒤 회차가 앞 회차를 덮는다. */
async function collectFailures(): Promise<Map<string, Failed>> {
  const out = new Map<string, Failed>();
  for (const dir of SOLVED_DIRS) {
    let files: string[] = [];
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
    } catch {
      continue;
    }
    for (const f of files) {
      const rows: Array<{
        id: string;
        ok?: boolean;
        answer?: string | null;
        why?: string;
      }> = JSON.parse(await readFile(`${dir}/${f}`, "utf-8"));
      for (const r of rows) {
        const solved = r.ok !== false && (r.answer ?? "").trim();
        // 뒤 회차에서 풀렸으면 후보에서 뺀다 — 그림이 붙어 다시 풀린 것이 실제로 많다.
        if (solved) out.delete(r.id);
        else
          out.set(r.id, { id: r.id, why: (r.why ?? "").trim() || "사유 없음" });
      }
    }
  }
  return out;
}

/**
 * `node:sqlite` 는 아직 실험 기능이라 @types/node 에 타입이 없다.
 * 런타임에는 있으므로 동적 import 로 가져와 필요한 모양만 좁게 선언한다.
 */
interface SqliteRow {
  [key: string]: unknown;
}
interface SqliteDb {
  prepare: (sql: string) => { all: () => SqliteRow[] };
  close: () => void;
}
type SqliteCtor = new (path: string, opts?: { readOnly?: boolean }) => SqliteDb;

async function openSqlite(path: string): Promise<SqliteDb | null> {
  try {
    // 리터럴로 쓰면 tsc 가 해석을 시도해 "모듈 없음" 으로 막는다.
    // 런타임에만 필요하므로 지정자를 변수로 만들어 컴파일 시점 해석을 피한다.
    const specifier = ["node", "sqlite"].join(":");
    const mod = (await import(specifier)) as unknown as {
      DatabaseSync: SqliteCtor;
    };
    return new mod.DatabaseSync(path, { readOnly: true });
  } catch {
    return null;
  }
}

async function examIndexPath(): Promise<string> {
  const candidates = [
    process.env.EXAM_INDEX_DB,
    "F:\\시험지변환기\\db\\exam_index.db",
    "D:\\시험지 한글화\\db\\exam_index.db",
  ].filter((v): v is string => Boolean(v));
  for (const c of candidates) {
    const db = await openSqlite(c);
    if (db) {
      db.close();
      return c;
    }
  }
  return "";
}

function examLabel(row: Record<string, unknown>): string {
  const parts = [
    row.school,
    row.grade ? `${row.grade}학년` : null,
    row.year && row.semester ? `${row.year}-${row.semester}` : null,
    row.round,
    row.subject,
  ].filter(Boolean);
  return parts.join(" ") || "시험지 미상";
}

function renderDoc(items: Candidate[], alreadySolved: number): string {
  const byCat = new Map<string, Candidate[]>();
  for (const c of items) {
    const list = byCat.get(c.category) ?? [];
    list.push(c);
    byCat.set(c.category, list);
  }
  const order = [...CATEGORIES.map((c) => c.name), "기타"].filter((n) =>
    byCat.has(n),
  );
  const note = (name: string) =>
    CATEGORIES.find((c) => c.name === name)?.note ?? "규칙으로 못 가른 것.";
  const count = (list: Candidate[], kind: string) =>
    list.filter((c) => c.origin.kind === kind).length;

  const recoverable = items.filter((c) => c.hwp);
  const lines: string[] = [];
  lines.push("# 폐기 후보 문항 목록");
  lines.push("");
  lines.push(
    "정답 백필에서 담당자가 **정답을 낼 수 없다**고 판정한 문항이다. 문항 본문은 싣지 않았다 — **어느 시험지 몇 번인지**와 **왜 못 쓰는지**만 있다.",
  );
  lines.push("");
  if (recoverable.length > 0) {
    lines.push(
      `> ## ⚠️ 지금 판단하지 마십시오 — ${recoverable.length}건은 되살아날 수 있습니다`,
    );
    lines.push("> ");
    lines.push(
      "> 이 목록의 사유 상당수가 **원본 결손이 아니라 우리 이관 실수**로 밝혀졌다. 이관은 본문을 완료본 **PDF 텍스트 레이어**에서 뽑았는데(`extract-final-batch.py` 180행), 완료본 **HWP** 에는 문제 본문·보기·정답·소단원·배점·해설이 온전히 들어 있다. 본문을 PDF 에서 뽑을 이유가 처음부터 없었다.",
    );
    lines.push("> ");
    lines.push(
      '> 실측 사례 — 국제고 2697 은 원본이 8문항인데 DB 2건이 둘 다 **해설 지면 텍스트**였고, 강북고 2928 은 1~12번 본문이 통째로 `정답` 두 글자였다. 현풍고 2900-18 은 "OCR 훼손" 으로 적혀 있으나 HWP 원문 그대로였다 — **그 판정은 틀렸다.**',
    );
    lines.push("> ");
    lines.push(
      `> **${recoverable.length}건에 완료본 HWP 원본이 있다.** 트랙 D 가 재추출 중이다(\`docs/planning/tracks/track-d-hwp.md\`). 끝난 뒤 이 문서를 다시 만들어 보시는 게 맞다.`,
    );
    lines.push("");
  }
  lines.push(
    `- 총 **${items.length}건** — 그중 **재추출 대기 ${recoverable.length}건**, 원본이 없어 판단이 필요한 것 ${items.length - recoverable.length}건.`,
  );
  lines.push(
    `- 판정 실패 후 **정답이 채워진 ${alreadySolved}건은 뺐다** — 그림이 새로 붙어 다시 풀린 것이 많다.`,
  );
  lines.push(
    `- 원본 위치 — 기출 ${count(items, "past_exam")}건 · RPM ${count(items, "rpm")}건 · 미상 ${count(items, "unknown")}건`,
  );
  lines.push("");
  lines.push(
    "> 이 문서는 `npx tsx scripts/qa/build-discard-list.ts` 로 다시 만든다. 정답이 채워지거나 그림이 붙거나 HWP 재추출이 끝나면 후보가 줄어드니, **판단하시기 직전에 한 번 더 돌리는 게 좋다.**",
  );
  lines.push("");
  lines.push("## 사유별 건수");
  lines.push("");
  lines.push("| 사유 | 건수 | HWP 있음 | 기출 | RPM | 미상 | 어떤 문제인가 |");
  lines.push("|---|---:|---:|---:|---:|---:|---|");
  for (const name of order) {
    const list = byCat.get(name) ?? [];
    const rec = list.filter((c) => c.hwp).length;
    lines.push(
      `| ${name} | ${list.length} | ${rec} | ${count(list, "past_exam")} | ${count(list, "rpm")} | ${count(list, "unknown")} | ${note(name)} |`,
    );
  }
  lines.push(
    `| **합계** | **${items.length}** | **${recoverable.length}** | | | | |`,
  );
  lines.push("");
  lines.push(
    "「HWP 있음」은 **완료본 HWP 원본이 남아 있어 재추출로 되살아날 수 있는 것**이다. 폐기를 판단하실 대상이 아니다.",
  );
  lines.push("");

  for (const name of order) {
    const list = byCat.get(name) ?? [];
    lines.push(`## ${name} (${list.length}건)`);
    lines.push("");
    lines.push(note(name));
    lines.push("");
    // 원본이 없어 **정말로 판단이 필요한 것**을 앞에 놓는다.
    const sorted = [...list].sort(
      (a, b) => Number(Boolean(a.hwp)) - Number(Boolean(b.hwp)),
    );
    for (const c of sorted.slice(0, PER_SECTION)) {
      const tag = c.hwp ? " — **재추출 대기(HWP 있음)**" : "";
      lines.push(
        `- **${c.origin.label}**${c.unit ? ` · ${c.unit}` : ""} · ${c.why}${tag}`,
      );
      // 되살릴 수 있는 것은 **HWP 경로**를 보여 준다 — 그게 정본이다.
      if (c.hwp) lines.push(`  - HWP \`${c.hwp}\``);
      else if (c.origin.srcPath) lines.push(`  - \`${c.origin.srcPath}\``);
    }
    if (list.length > PER_SECTION) {
      lines.push(
        `- … 외 ${list.length - PER_SECTION}건. 전량은 \`scripts/qa/reports/discard-candidates.json\` 에 있다.`,
      );
    }
    lines.push("");
  }

  lines.push("## 어떻게 쓰나");
  lines.push("");
  lines.push(
    "뺄 문항을 정하시면 처리 도구를 만들겠다. **삭제보다 출제 풀 제외를 권한다** — 삭제는 되돌릴 수 없지만 `reviewStatus` 를 내리면 출제에서만 빠지고 나중에 복구할 수 있다. 원본 시험지 자체가 잘못된 것(원본 모순)만 삭제 대상으로 보는 게 안전하다.",
  );
  lines.push("");
  lines.push(
    '그리고 **「재추출 대기」로 표시된 것은 아직 보지 마십시오.** 그건 문항이 나쁜 게 아니라 우리가 잘못 옮긴 것이고, 트랙 D 가 끝나면 상당수가 이 목록에서 사라진다. "원본 모순" 으로 적힌 것도 그 판정 자체를 다시 봐야 한다 — 현풍고 2900-18 이 그렇게 잘못 적혔다.',
  );
  lines.push("");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const failures = await collectFailures();
  const prisma = new PrismaClient();
  try {
    const ids = [...failures.keys()];
    const rows: Array<{
      id: string;
      source: string;
      externalId: string | null;
      answer: string;
      content: string;
      unit: { grade: string; chapter: string; section: string } | null;
    }> = [];
    for (let i = 0; i < ids.length; i += 2000) {
      rows.push(
        ...(await prisma.problem.findMany({
          where: { id: { in: ids.slice(i, i + 2000) } },
          select: {
            id: true,
            source: true,
            externalId: true,
            answer: true,
            content: true,
            unit: { select: { grade: true, chapter: true, section: true } },
          },
        })),
      );
    }

    // 이미 정답이 채워진 행은 후보가 아니다. 목록을 다시 만드는 이유가 이것이다.
    const live = rows.filter((r) => r.answer.includes(SENTINEL));
    const alreadySolved = rows.length - live.length;

    // ── 기출: exam_index 로 원본 위치 ─────────────────────────────
    const idxPath = await examIndexPath();
    const examMeta = new Map<number, Record<string, unknown>>();
    const idxDb = idxPath ? await openSqlite(idxPath) : null;
    if (idxDb) {
      const all = idxDb
        .prepare(
          "select id, school, grade, year, semester, round, subject, src_path from exams",
        )
        .all();
      for (const row of all) examMeta.set(Number(row.id), row);
      idxDb.close();
    }

    // ── RPM: 본문 매칭으로 sumaek 역추적 ──────────────────────────
    const byKey = new Map<string, SourceRow[]>();
    const sourceUrl = await resolveSourceUrl();
    if (sourceUrl) {
      const raw = await readSource(sourceUrl);
      for (const r of raw) {
        const row = toSourceRow(r);
        if (!row) continue;
        const keys = [
          ...new Set([...keysOf(row.content), ...keysOf(row.restoredContent)]),
        ];
        for (const key of keys) {
          const list = byKey.get(key) ?? [];
          if (!list.some((x) => x.id === row.id)) list.push(row);
          byKey.set(key, list);
        }
      }
    }

    const hwpPaths = await loadHwpPaths();
    const candidates: Candidate[] = [];
    for (const row of live) {
      const why = failures.get(row.id)?.why ?? "사유 없음";
      const unit = row.unit
        ? `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`
        : null;
      let origin: Candidate["origin"] = { kind: "unknown", label: "원본 미상" };
      let hwp: string | null = null;

      if (row.externalId) {
        const cut = row.externalId.lastIndexOf("-");
        const examId = Number(row.externalId.slice(0, cut));
        hwp = hwpPaths.get(examId) ?? null;
        const number = Number(row.externalId.slice(cut + 1));
        const meta = examMeta.get(examId);
        if (meta) {
          origin = {
            kind: "past_exam",
            label: `${examLabel(meta)} ${number}번`,
            srcPath:
              typeof meta.src_path === "string" ? meta.src_path : undefined,
            questionNumber: number,
          };
        }
      } else if (row.source === "transformed") {
        const hits = new Map<string, SourceRow>();
        for (const key of keysOf(row.content)) {
          for (const hit of byKey.get(key) ?? []) hits.set(hit.id, hit);
        }
        const list = [...hits.values()];
        if (list.length > 0) {
          const ref = list[0].sourceRef ?? {};
          const book =
            (typeof ref.book === "string" && ref.book) ||
            (typeof ref.unit === "string" && ref.unit) ||
            "RPM";
          const numbers = list
            .map((h) => h.printedNumber)
            .filter(Boolean)
            .join(", ");
          origin = {
            kind: "rpm",
            label:
              list.length === 1
                ? `RPM ${book} ${numbers || "번호미상"}번`
                : `RPM ${book} — 후보 ${list.length}곳 (${numbers})`,
            sumaekId: list[0].id,
            printedNumber: list[0].printedNumber,
            match: list.length === 1 ? "unique" : "ambiguous",
          };
        }
      }

      candidates.push({
        id: row.id,
        source: row.source,
        externalId: row.externalId,
        category: categorize(why),
        why,
        unit,
        hwp,
        origin,
      });
    }

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(JSON_OUT, JSON.stringify(candidates, null, 1), "utf-8");
    await writeFile(DOC_OUT, renderDoc(candidates, alreadySolved), "utf-8");

    const byCat = new Map<string, number>();
    for (const c of candidates) {
      byCat.set(c.category, (byCat.get(c.category) ?? 0) + 1);
    }
    console.log("── 폐기 후보 목록 ──");
    console.log(
      `판정 실패 ${failures.size} · 그 사이 정답이 채워짐 ${alreadySolved}` +
        ` · 남은 후보 ${candidates.length}`,
    );
    for (const [k, v] of [...byCat].sort((a, b) => b[1] - a[1])) {
      console.log(`  ${k.padEnd(14)} ${v}`);
    }
    const located = candidates.filter(
      (c) => c.origin.kind !== "unknown",
    ).length;
    console.log(`원본 위치 부착 ${located} / ${candidates.length}`);
    console.log(`→ ${JSON_OUT}`);
    console.log(`→ ${DOC_OUT}`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
