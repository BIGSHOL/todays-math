/**
 * RPM 이관의 **실데이터 회귀 검사**. 합성 픽스처를 쓰지 않는다.
 *
 * 왜 이렇게까지 하나 — 이 이관은 세 번 샜는데 **테스트는 세 번 다 초록이었다**:
 *
 *   | 결함 | 규모 | 원인 |
 *   |---|---|---|
 *   | 객관식 정답 유실 | 4,862 | 원본 키가 `choiceId` 인데 `id` 로 읽었다 |
 *   | 보기 마커 ①~⑤ 유실 | 1,319 | 평문화하며 번호를 떨어뜨렸다 |
 *   | 그림 미조회 | 1,014 | `diagram_assets` 를 아예 안 봤다 |
 *
 * 셋 다 **픽스처가 원본과 다른 키를 써서** 통과했다. 그래서 이 검사는 sumaek 원본
 * 6,151행과 우리 DB 에 **직접** 물린다.
 *
 * ## 조용한 통과 금지
 *
 * 원본이나 DB 에 못 붙으면 **skip 을 찍고 종료코드 2로 끝난다**(성공 아님).
 * 정말 건너뛰어도 되는 자리에서만 `--allow-skip` 을 준다. 이 사달의 원인이
 * "없으면 조용히 통과" 였다.
 *
 * ## 검사가 실제로 빨강이 되는지 스스로 증명한다
 *
 * `--fault <이름>` 은 지난 결함을 **일부러 되돌려** 검사가 정말 잡는지 본다.
 * 운영 코드를 고치지 않는다 — 변환기 소스를 임시 파일로 복사해 그 자리에서
 * 망가뜨린 뒤 그것을 불러 돌린다.
 *
 *   npx tsx scripts/qa/verify-convert-rpm.ts                  전체 검사
 *   npx tsx scripts/qa/verify-convert-rpm.ts --detail         실패 표본까지
 *   npx tsx scripts/qa/verify-convert-rpm.ts --fault all      결함 4종을 되돌려 빨강 확인
 *   npx tsx scripts/qa/verify-convert-rpm.ts --update-baseline
 *
 * 종료코드: 0 통과 · 1 실패 · 2 skip(원본/DB 없음).
 */
import { readFile, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { convertRpmExtractedRow } from "../../src/lib/import/convertRpm";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { isDirectScript } from "../import/isDirectScript";
import { readEnvFile } from "../import/readEnvFile";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
const BASELINE_PATH = "scripts/qa/verify-convert-rpm.baseline.json";
export const CONVERTER_PATH = "src/lib/import/convertRpm.ts";
/**
 * 상대 import 가 그대로 풀리게 **같은 디렉터리**에 만든다. 끝나면 지운다.
 * 결함마다 **파일 이름을 달리한다** — 같은 경로를 덮어쓰면 tsx 의 변환 캐시가
 * 앞 결함의 코드를 그대로 돌려줘서, 뒤 결함이 조용히 초록으로 통과한다(실제로 겪음).
 */
const faultPath = (name: string): string =>
  `src/lib/import/_convertRpm.fault.${name}.ts`;

const SENTINEL = "(정답 없음)";
const MARKER_ONLY = /^[①②③④⑤⑥⑦⑧⑨⑩](\s*,\s*[①②③④⑤⑥⑦⑧⑨⑩])*$/;
const squeeze = (value: string): string => value.replace(/\s+/g, "");

/** `diagram_assets` 는 `question_version_id` 로 붙는다 — 그림 유무의 유일한 근거다. */
const SOURCE_SELECT = `
SELECT
  q.id::text AS id,
  q.kind::text AS kind,
  q.printed_number,
  q.source_ref,
  qv.body,
  qv.choices,
  qv.answer,
  qv.explanation,
  qv.difficulty,
  qv.question_type_tags,
  (
    SELECT count(*)::int FROM diagram_assets d
    WHERE d.question_version_id = q.current_version_id
  ) AS diagram_count
FROM questions q
JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

interface SqlClient {
  unsafe: (query: string) => Promise<Array<Record<string, unknown>>>;
  end: () => Promise<void>;
}
type PostgresFactory = (
  url: string,
  options?: Record<string, unknown>,
) => SqlClient;

type ConvertFn = typeof convertRpmExtractedRow;

export interface Check {
  id: string;
  label: string;
  /** 통과한 행 수 / 대상 행 수. */
  passed: number;
  total: number;
  /** `exact` 는 전수 통과라야 한다. `baseline` 은 기준선 이상이면 된다. */
  mode: "exact" | "baseline";
  samples: string[];
}

export interface Baseline {
  note: string;
  measuredAt: string;
  checks: Record<string, { passed: number; total: number }>;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

interface SourceChoice {
  order: number;
  marker: string;
  text: string;
}

/** 원본 보기 배열 → `{order, marker, text}`. 마커나 본문이 없는 항목은 세지 않는다. */
function sourceChoices(raw: unknown): SourceChoice[] {
  if (!Array.isArray(raw)) return [];
  const items: SourceChoice[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const marker = typeof record.marker === "string" ? record.marker.trim() : "";
    const order = typeof record.order === "number" ? record.order : index + 1;
    const text = flattenStructured(record.content).content.trim();
    if (!marker || !text) return;
    items.push({ order, marker, text });
  });
  return items.sort((a, b) => a.order - b.order);
}

async function readSource(): Promise<Array<Record<string, unknown>> | null> {
  const url =
    process.env.SUMAEK_DATABASE_URL?.trim() ||
    (await readEnvFile(process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV))
      ?.DATABASE_URL;
  if (!url) return null;
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  let loaded: { default: PostgresFactory };
  try {
    loaded = (await import(pathToFileURL(driverPath).href)) as {
      default: PostgresFactory;
    };
  } catch {
    return null;
  }
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "verify-convert-rpm-readonly" },
  });
  try {
    // 원본 저장소는 읽기만 한다.
    await sql.unsafe("SET default_transaction_read_only = on");
    await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return await sql.unsafe(SOURCE_SELECT);
  } finally {
    await sql.end();
  }
}

/**
 * 변환기 계약 검사 — 원본만 있으면 된다(우리 DB 불필요).
 * 지난 결함 셋 중 둘(정답 유실·마커 유실)이 여기서 잡힌다.
 */
export function sourceChecks(
  rows: Array<Record<string, unknown>>,
  convert: ConvertFn,
): Check[] {
  const mk = (id: string, label: string, mode: Check["mode"]): Check => ({
    id,
    label,
    passed: 0,
    total: 0,
    mode,
    samples: [],
  });
  const noLoss = mk("choice-no-loss", "보기 유실 없음 (변환 후 보기 ≥ 원본 보기)", "exact");
  const sameCount = mk("choice-count", "원본 보기 개수 = 변환 후 보기 개수", "baseline");
  const answerFilled = mk("answer-filled", "원본에 정답이 있으면 변환 후에도 있다", "exact");
  const markerForm = mk("answer-marker-form", "객관식 정답이 보기 번호(①~⑤) 형태", "exact");
  const markerAlive = mk("choice-marker-alive", "보기 마커 ①~⑤ 가 본문에 살아 있다", "exact");
  const externalId = mk("external-id", "`externalId` 가 원본 id 로 채워진다", "exact");

  const note = (check: Check, line: string): void => {
    if (check.samples.length < 5) check.samples.push(line);
  };

  for (const row of rows) {
    const id = String(row.id);
    const draft = convert({
      id,
      kind: typeof row.kind === "string" ? row.kind : null,
      printed_number:
        typeof row.printed_number === "string" ? row.printed_number : null,
      source_ref: asRecord(row.source_ref),
      body: row.body,
      choices: row.choices,
      answer: row.answer,
      explanation: row.explanation,
      difficulty: row.difficulty,
      question_type_tags: row.question_type_tags,
      concepts: [],
    });

    externalId.total += 1;
    if (draft.externalId === id) externalId.passed += 1;
    else note(externalId, `${id.slice(0, 8)} externalId=${JSON.stringify(draft.externalId)}`);

    const answer = asRecord(row.answer);
    const hasSourceAnswer =
      (Array.isArray(answer?.correctChoiceIds) &&
        answer.correctChoiceIds.length > 0) ||
      (Array.isArray(answer?.accepted) && answer.accepted.length > 0);
    if (hasSourceAnswer) {
      answerFilled.total += 1;
      if (draft.answer !== SENTINEL && draft.answer.trim()) {
        answerFilled.passed += 1;
      } else {
        note(answerFilled, `${id.slice(0, 8)} kind=${String(answer?.kind)} → ${JSON.stringify(draft.answer)}`);
      }
    }

    if (answer?.kind === "multiple_choice") {
      markerForm.total += 1;
      if (MARKER_ONLY.test(draft.answer.trim())) markerForm.passed += 1;
      else note(markerForm, `${id.slice(0, 8)} 정답=${JSON.stringify(draft.answer.slice(0, 24))}`);
    }

    const choices = sourceChoices(row.choices);
    if (choices.length >= 2) {
      const parsed = parseProblemContent(draft.content);
      noLoss.total += 1;
      if (parsed.choices.length >= choices.length) noLoss.passed += 1;
      else note(noLoss, `${id.slice(0, 8)} 원본 ${choices.length} → 변환 ${parsed.choices.length}`);

      sameCount.total += 1;
      if (parsed.choices.length === choices.length) sameCount.passed += 1;
      else note(sameCount, `${id.slice(0, 8)} 원본 ${choices.length} → 변환 ${parsed.choices.length}`);

      markerAlive.total += 1;
      const content = squeeze(draft.content);
      if (choices.every((choice) => content.includes(choice.marker))) {
        markerAlive.passed += 1;
      } else {
        const missing = choices
          .filter((choice) => !content.includes(choice.marker))
          .map((choice) => choice.marker)
          .join("");
        note(markerAlive, `${id.slice(0, 8)} 빠진 마커 ${missing}`);
      }
    }
  }
  return [noLoss, sameCount, answerFilled, markerForm, markerAlive, externalId];
}

/**
 * 적재 결과 검사 — 우리 DB 가 필요하다.
 * 지난 결함 셋 중 나머지 하나(그림 미조회)와, 이번에 채운 `externalId` 가 여기서 잡힌다.
 */
export async function dbChecks(
  rows: Array<Record<string, unknown>>,
  prisma: PrismaClient,
  fault: { externalIdBlind?: boolean; figureBlind?: boolean } = {},
): Promise<Check[]> {
  const problems = await prisma.problem.findMany({
    where: { source: "transformed" },
    select: { id: true, externalId: true, figureUrls: true },
  });
  const externalIdFilled: Check = {
    id: "db-external-id",
    label: "적재된 RPM 행에 `externalId` 가 있다",
    passed: 0,
    total: problems.length,
    mode: "baseline",
    samples: [],
  };
  const figureLinked: Check = {
    id: "db-figure-linked",
    label: "원본에 `diagram_assets` 가 있는 문항은 `figureUrls` 가 비지 않는다",
    passed: 0,
    total: 0,
    mode: "exact",
    samples: [],
  };

  const withDiagram = new Set(
    rows
      .filter((row) => Number(row.diagram_count ?? 0) > 0)
      .map((row) => String(row.id)),
  );
  for (const problem of problems) {
    const externalId = fault.externalIdBlind ? null : problem.externalId;
    if (externalId) externalIdFilled.passed += 1;
    if (!externalId || !withDiagram.has(externalId)) continue;
    figureLinked.total += 1;
    const figureUrls = fault.figureBlind ? [] : problem.figureUrls;
    if (figureUrls.length > 0) figureLinked.passed += 1;
    else if (figureLinked.samples.length < 5) {
      figureLinked.samples.push(`${problem.id.slice(0, 8)} ← 원본 ${externalId.slice(0, 8)}`);
    }
  }
  return [externalIdFilled, figureLinked];
}

/** 지난 결함을 되돌리는 치환 — 운영 코드가 아니라 임시 사본에 건다. */
export const FAULTS: Record<string, { why: string; from: string; to: string; expect: string[] }> = {
  "choice-id": {
    why: "원본 키가 `choiceId` 인데 `id` 로만 읽던 결함 (정답 4,862건 유실)",
    from: `      id:
        (typeof record.choiceId === "string" && record.choiceId) ||
        (typeof record.id === "string" && record.id) ||
        String(index),`,
    to: `      id: (typeof record.id === "string" && record.id) || String(index),`,
    expect: ["answer-filled", "answer-marker-form"],
  },
  "marker-drop": {
    why: "평문화하며 보기 번호를 떨어뜨리던 결함 (마커 1,319건 유실)",
    from: "          .map((choice) => `${choice.marker} ${choice.text}`.trim())",
    to: "          .map((choice) => `${choice.text}`.trim())",
    expect: ["choice-marker-alive"],
  },
  "answer-flatten": {
    why: "`flattenStructured` 만으로 정답을 펴던 결함 (`correctChoiceIds`/`accepted` 를 못 봄)",
    from: "    answer: rpmAnswer(row.answer, choiceList) || \"(정답 없음)\",",
    to: "    answer: flattenStructured(row.answer).content || \"(정답 없음)\",",
    expect: ["answer-filled", "answer-marker-form"],
  },
};

/** DB 쪽 결함은 소스를 고치는 게 아니라 **그 시절의 DB 상태**를 재현해 본다. */
export const DB_FAULTS: Record<string, { why: string; flag: "externalIdBlind" | "figureBlind"; expect: string }> = {
  "figure-blind": {
    why: "`diagram_assets` 를 안 봐서 그림이 한 장도 안 붙던 상태 (1,014건)",
    flag: "figureBlind",
    expect: "db-figure-linked",
  },
  "external-id-blind": {
    why: "적재가 `externalId` 를 버리던 상태 (RPM 4,862건 역추적 불가)",
    flag: "externalIdBlind",
    expect: "db-external-id",
  },
};

/** 변환기 소스를 임시 사본에 망가뜨려 불러온다. 운영 파일은 건드리지 않는다. */
async function loadFaultyConverter(name: string): Promise<ConvertFn> {
  const fault = FAULTS[name];
  // 저장소 파일이 CRLF 라 그대로 비교하면 여러 줄 치환이 조용히 빗나간다.
  const original = (await readFile(CONVERTER_PATH, "utf8")).replace(/\r\n/g, "\n");
  if (!original.includes(fault.from)) {
    throw new Error(
      `결함 주입 실패 — '${name}' 의 치환 대상 문자열이 ${CONVERTER_PATH} 에 없습니다.` +
        " 변환기가 바뀌었으면 FAULTS 도 같이 고쳐야 합니다(조용히 통과하면 안 됩니다).",
    );
  }
  const target = faultPath(name);
  await writeFile(target, original.replace(fault.from, fault.to), "utf8");
  const url = pathToFileURL(path.resolve(target)).href;
  const faulty = (await import(url)) as {
    convertRpmExtractedRow: ConvertFn;
  };
  return faulty.convertRpmExtractedRow;
}

function verdict(check: Check, baseline: Baseline | null): "pass" | "fail" {
  if (check.mode === "exact") return check.passed === check.total ? "pass" : "fail";
  const previous = baseline?.checks[check.id];
  if (!previous) return "pass";
  // 기준선은 **비율**로 본다 — 원본이 늘어도 품질이 떨어지면 잡아야 한다.
  const now = check.total === 0 ? 1 : check.passed / check.total;
  const then = previous.total === 0 ? 1 : previous.passed / previous.total;
  return now + 1e-9 >= then ? "pass" : "fail";
}

function printChecks(checks: Check[], baseline: Baseline | null, detail: boolean): boolean {
  let ok = true;
  for (const check of checks) {
    const state = verdict(check, baseline);
    if (state === "fail") ok = false;
    const ratio = check.total === 0 ? "—" : `${((check.passed / check.total) * 100).toFixed(2)}%`;
    const previous = baseline?.checks[check.id];
    const base =
      check.mode === "baseline" && previous
        ? ` (기준선 ${previous.passed}/${previous.total})`
        : "";
    console.log(
      `  ${state === "pass" ? "✔" : "✘"} ${check.label} — ${check.passed}/${check.total} ${ratio}${base}`,
    );
    if (detail || state === "fail") {
      for (const sample of check.samples) console.log(`      ${sample}`);
    }
  }
  return ok;
}

async function loadBaseline(): Promise<Baseline | null> {
  try {
    return JSON.parse(await readFile(BASELINE_PATH, "utf8")) as Baseline;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const detail = process.argv.includes("--detail");
  const allowSkip = process.argv.includes("--allow-skip");
  const updateBaseline = process.argv.includes("--update-baseline");
  const faultIndex = process.argv.indexOf("--fault");
  const faultArg = faultIndex >= 0 ? process.argv[faultIndex + 1] : null;

  const rows = await readSource();
  if (!rows) {
    console.log("── RPM 실데이터 회귀 검사 ──");
    console.log(
      "SKIP — sumaek 원본에 붙지 못했습니다 (SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH).",
    );
    console.log(
      "이 검사는 합성 픽스처로 대체할 수 없습니다. 원본 없이 초록으로 넘어가면 지난 세 결함이 그대로 재발합니다.",
    );
    process.exitCode = allowSkip ? 0 : 2;
    return;
  }

  const baseline = await loadBaseline();
  if (!baseline) {
    console.log(`(기준선 없음 — ${BASELINE_PATH}. --update-baseline 으로 만듭니다.)`);
  }

  if (faultArg) {
    const names =
      faultArg === "all"
        ? [...Object.keys(FAULTS), ...Object.keys(DB_FAULTS)]
        : [faultArg];
    console.log("── 결함 되돌리기 — 검사가 실제로 빨강이 되는지 ──");
    let allCaught = true;
    const prisma = new PrismaClient();
    try {
      for (const name of names) {
        const sourceFault = FAULTS[name];
        const dbFault = DB_FAULTS[name];
        if (!sourceFault && !dbFault) {
          throw new Error(
            `알 수 없는 결함 이름 '${name}'. 쓸 수 있는 것: ${[...Object.keys(FAULTS), ...Object.keys(DB_FAULTS)].join(", ")}`,
          );
        }
        console.log(`\n[${name}] ${(sourceFault ?? dbFault).why}`);
        let checks: Check[];
        let expected: string[];
        if (sourceFault) {
          try {
            checks = sourceChecks(rows, await loadFaultyConverter(name));
          } finally {
            await unlink(faultPath(name)).catch(() => {});
          }
          expected = sourceFault.expect;
        } else {
          checks = await dbChecks(rows, prisma, { [dbFault.flag]: true });
          expected = [dbFault.expect];
        }
        const failed = checks
          .filter((check) => verdict(check, baseline) === "fail")
          .map((check) => check.id);
        const caught = expected.filter((id) => failed.includes(id));
        const missed = expected.filter((id) => !failed.includes(id));
        printChecks(
          checks.filter((check) => expected.includes(check.id)),
          baseline,
          false,
        );
        if (missed.length > 0) {
          allCaught = false;
          console.log(`  → ✘ 잡지 못한 검사: ${missed.join(", ")} — 검사가 결함을 못 본다.`);
        } else {
          console.log(`  → 잡음 (${caught.join(", ")})`);
        }
      }
    } finally {
      await prisma.$disconnect();
    }
    console.log(
      `\n결함 되돌리기 ${allCaught ? "전부 빨강 — 검사가 살아 있다." : "일부가 초록으로 통과했다 — 검사를 고쳐야 한다."}`,
    );
    process.exitCode = allCaught ? 0 : 1;
    return;
  }

  console.log("── RPM 실데이터 회귀 검사 (sumaek 원본 직결) ──");
  console.log(`원본 ${rows.length}행`);
  const checks = sourceChecks(rows, convertRpmExtractedRow);
  console.log("\n[변환기 계약]");
  let ok = printChecks(checks, baseline, detail);

  const prisma = new PrismaClient();
  let dbResults: Check[] = [];
  try {
    dbResults = await dbChecks(rows, prisma);
    console.log("\n[적재 결과]");
    if (!printChecks(dbResults, baseline, detail)) ok = false;
  } catch (error) {
    console.log("\n[적재 결과]");
    console.log(`  SKIP — 우리 DB 에 붙지 못했습니다: ${(error as Error).message}`);
    process.exitCode = allowSkip ? process.exitCode : 2;
    if (!allowSkip) {
      await prisma.$disconnect();
      return;
    }
  } finally {
    await prisma.$disconnect();
  }

  if (updateBaseline) {
    const next: Baseline = {
      note:
        "실데이터 회귀 검사 기준선. `mode:baseline` 검사는 이 비율 아래로 떨어지면 실패한다." +
        " 값이 올라갔으면 --update-baseline 으로 갱신할 것.",
      measuredAt: new Date().toISOString().slice(0, 10),
      checks: Object.fromEntries(
        [...checks, ...dbResults].map((check) => [
          check.id,
          { passed: check.passed, total: check.total },
        ]),
      ),
    };
    await writeFile(BASELINE_PATH, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    console.log(`\n기준선 갱신 — ${BASELINE_PATH}`);
  }

  console.log(`\n${ok ? "통과" : "실패 — 위의 ✘ 를 보라."}`);
  if (!ok) process.exitCode = 1;
}

if (isDirectScript(import.meta.url)) {
  void main();
}
