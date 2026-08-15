/**
 * RPM(sumaek) 원본 정답 복구.
 *
 * 배경: `src/lib/import/convertRpm.ts` 가 원본 `question_versions.answer` 를
 * `flattenStructured()` 로 폈는데, 그 함수는 `text/latex/value/runs/content/items/rows`
 * 만 훑는다. 원본 정답의 키는 `correctChoiceIds`(객관식) / `accepted`(주관식)라
 * 한 건도 걸리지 않아 4,862행이 통째로 `(정답 없음)` 으로 적재됐다.
 * 해설(`explanation`)만 살아남은 것이 그 증거다. 그래서 이건 AI 로 풀 일이 아니라
 * 원본에서 **되가져올** 일이다.
 *
 * 짝짓기: 적재 때 `externalId` 를 버려서 키 조인이 안 된다. 대신 원본 body+choices 를
 * 적재 때와 **같은 함수로** 펴면 우리 `Problem.content` 와 문자열이 같아진다(실측 100%).
 * 다만 `restore-choice-markers.ts` 로 보기 마커를 복원한 문항은 본문이 바뀌어 이 일치가
 * 깨진다. 그래서 원본 한 행마다 **적재 당시 형태와 마커 복원 형태를 모두** 키로 걸고,
 * 각 형태의 원문/정규화(마커·중복 보기·공백 제거) 키를 함께 본다 — 복원 전 문항과 복원 후
 * 문항이 같은 코드로 다 잡힌다. 어느 키로든 원본 후보가 둘 이상이면 건드리지 않는다.
 *
 * 접속 정보는 저장소에 넣지 않는다 — `SUMAEK_DATABASE_URL` 환경변수를 먼저 보고,
 * 없으면 `SUMAEK_ENV_PATH`(기본 `C:\Creative\sumaek\.env`)를 파싱한다.
 * 원본에는 **SELECT 만** 한다(`SET TRANSACTION READ ONLY`).
 *
 *   npx tsx scripts/qa/recover-rpm-answers.ts                     드라이런
 *   npx tsx scripts/qa/recover-rpm-answers.ts --fix-existing      교정 대상까지 집계
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/recover-rpm-answers.ts --apply
 */
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { isDirectScript } from "../import/isDirectScript";
import { readEnvFile } from "../import/readEnvFile";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
const SENTINEL = "정답 없음";
/** `①`~`⑩`, 복수 정답은 `②, ⑤` 처럼 쉼표로 잇는다. */
const MARKER_ONLY = /^[①②③④⑤⑥⑦⑧⑨⑩](\s*,\s*[①②③④⑤⑥⑦⑧⑨⑩])*$/;

export const SOURCE_SELECT = `
SELECT
  q.id::text AS id,
  q.printed_number,
  q.source_ref,
  qv.body,
  qv.choices,
  qv.answer
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

export interface SourceRow {
  id: string;
  /** 원본 교재의 인쇄 문항 번호. 쌍둥이 문항을 가르는 유일한 키다. */
  printedNumber: string | null;
  /** 원본 교재·단원 정보. 폐기 목록에서 "어느 교재 몇 번"을 적을 때 쓴다. */
  sourceRef: Record<string, unknown> | null;
  /** 적재 당시 형태 — `body + choices` 를 편 문자열. */
  content: string;
  /** `restore-choice-markers.ts` 가 만들어 넣는 형태 — `지문 + 마커 보기`. */
  restoredContent: string;
  answer: string;
  isChoice: boolean;
  /** 원본이 들고 있는 보기 마커 개수 — 본문에서 마커가 벗겨진 문항의 복구 여지. */
  markerCount: number;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/** `correctChoiceIds` → 보기 번호(①~⑤). 원장님 확정: 객관식은 항상 번호다. */
function markersFor(choices: unknown, correctIds: string[]): string {
  if (!Array.isArray(choices)) return "";
  const picked: Array<{ order: number; marker: string }> = [];
  for (const raw of choices) {
    const choice = asRecord(raw);
    if (!choice) continue;
    const id = typeof choice.choiceId === "string" ? choice.choiceId : "";
    if (!id || !correctIds.includes(id)) continue;
    const marker = typeof choice.marker === "string" ? choice.marker : "";
    const order = typeof choice.order === "number" ? choice.order : 0;
    if (marker) picked.push({ order, marker });
  }
  return picked
    .sort((a, b) => a.order - b.order)
    .map((c) => c.marker)
    .join(", ");
}

/** `accepted[].value` → 값. 여러 개면 쉼표로 잇는다. */
function acceptedValues(accepted: unknown): string {
  if (!Array.isArray(accepted)) return "";
  return accepted
    .map((raw) => {
      const item = asRecord(raw);
      const value = item?.value;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean)
    .join(", ");
}

interface ChoiceItem {
  order: number;
  marker: string;
  text: string;
}

/** 원본 보기 배열 → `{order, marker, text}`. `restore-choice-markers.ts` 와 같은 규칙. */
function toChoiceItems(raw: unknown): ChoiceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: ChoiceItem[] = [];
  raw.forEach((entry, index) => {
    const record = asRecord(entry);
    if (!record) return;
    const marker =
      typeof record.marker === "string" ? record.marker.trim() : "";
    const order = typeof record.order === "number" ? record.order : index + 1;
    const text = flattenStructured(record.content).content.trim();
    if (!marker || !text) return;
    items.push({ order, marker, text });
  });
  return items.sort((a, b) => a.order - b.order);
}

/** 지문 뒤에 마커 없이 겹쳐 붙은 보기 값 — 완전일치일 때만 잘라 낸다. */
function stripDuplicatedChoiceTail(body: string, items: ChoiceItem[]): string {
  if (items.length === 0) return body;
  const tail = items
    .map((item) => item.text)
    .join("")
    .replace(/\s+/g, "");
  if (!tail) return body;
  const segments = body.split("\n\n");
  for (let take = segments.length; take > 0; take -= 1) {
    const candidate = segments
      .slice(segments.length - take)
      .join("")
      .replace(/\s+/g, "");
    if (candidate === tail) {
      return segments
        .slice(0, segments.length - take)
        .join("\n\n")
        .trimEnd();
    }
  }
  return body;
}

export function toSourceRow(row: Record<string, unknown>): SourceRow | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const body = flattenStructured(row.body);
  const choices = flattenStructured(row.choices);
  // 적재 때(convertRpmExtractedRow)와 같은 조립 순서라야 본문이 일치한다.
  const content = [body.content, choices.content].filter(Boolean).join("\n\n");

  const answer = asRecord(row.answer);
  const kind = typeof answer?.kind === "string" ? answer.kind : "";
  const isChoice = kind === "multiple_choice";
  const correctIds = Array.isArray(answer?.correctChoiceIds)
    ? answer.correctChoiceIds.filter(
        (value): value is string => typeof value === "string",
      )
    : [];
  const text = isChoice
    ? markersFor(row.choices, correctIds)
    : acceptedValues(answer?.accepted);

  const choiceItems = toChoiceItems(row.choices);
  const stem = stripDuplicatedChoiceTail(body.content, choiceItems);
  const block = choiceItems
    .map((choice) => `${choice.marker} ${choice.text}`)
    .join("\n\n");

  return {
    id,
    printedNumber:
      typeof row.printed_number === "string" ? row.printed_number : null,
    sourceRef: asRecord(row.source_ref),
    content,
    // 마커 복원본과 **글자 단위로 같은** 문자열이라야 복원 후에도 짝이 맞는다.
    restoredContent: [stem, block].filter(Boolean).join("\n\n"),
    answer: text.trim(),
    isChoice,
    markerCount: choiceItems.length,
  };
}

export async function resolveSourceUrl(): Promise<string | null> {
  const direct = process.env.SUMAEK_DATABASE_URL?.trim();
  if (direct) return direct;
  const envFile = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  return envFile?.DATABASE_URL?.trim() || null;
}

/**
 * 원본에서 문항을 읽는다. `select` 를 주면 컬럼을 더 넣은 질의를 쓸 수 있다
 * (`backfill-rpm-external-id.ts` 가 `explanation` 을 같이 받는다).
 * 어느 경우든 **SELECT 만** 한다 — 세션 자체를 읽기 전용으로 잠근다.
 */
export async function readSource(
  url: string,
  select: string = SOURCE_SELECT,
): Promise<Array<Record<string, unknown>>> {
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: PostgresFactory;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "recover-rpm-answers-readonly" },
  });
  try {
    // 원본 저장소는 읽기만 한다 — 세션 자체를 읽기 전용으로 잠근다.
    await sql.unsafe("SET default_transaction_read_only = on");
    await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return await sql.unsafe(select);
  } finally {
    await sql.end();
  }
}

const normalizeContent = (value: string): string => value.replace(/\s+/g, "");
const normalizeAnswer = (value: string): string =>
  value.replace(/\s+/g, "").replace(/[$]/g, "");

/**
 * 보기 마커 복원 전/후 **양쪽에 걸리는** 짝짓기 키.
 *
 * `restore-choice-markers.ts` 가 본문을 `지문 + 마커 보기` 로 바꾸면 원본 문자열과의
 * 완전일치가 깨진다(실측 1,487건 전부 매칭실패). 그래서 양쪽 다 `parseProblemContent`
 * 로 한 번 걸러 **마커·중복 보기 블록·공백을 제거한 알맹이**를 키로 쓴다.
 *   - 복원 전: 마커가 없어 보기가 안 갈리지만 `dropDuplicatedTail` 이 중복 꼬리를 지운다.
 *   - 복원 후: 지문과 보기로 갈리고 마커는 파서가 떼어 낸다.
 * 두 경우 모두 `지문 + 보기들` 이 같은 문자열로 모인다.
 */
export function canonicalKey(content: string): string {
  const parsed = parseProblemContent(content);
  return normalizeContent(parsed.question + parsed.choices.join(""));
}

/** 원문 그대로의 키와 정규화 키를 함께 쓴다 — 한쪽만 맞아도 후보로 잡는다. */
export function keysOf(content: string): string[] {
  return [
    ...new Set([normalizeContent(content), canonicalKey(content)]),
  ].filter(Boolean);
}

/** 번호 정답은 시험지에 보기가 찍혀야 학생이 대조할 수 있다(load-answer-backfill 과 같은 규칙). */
function rendersChoices(content: string): boolean {
  const parsed = parseProblemContent(content);
  return parsed.choices.length >= 2;
}

interface Update {
  id: string;
  answer: string;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const fixExisting = process.argv.includes("--fix-existing");

  const sourceUrl = await resolveSourceUrl();
  if (!sourceUrl) {
    console.log(
      "원본 접속 정보가 없습니다 — SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하세요.",
    );
    return;
  }

  const rawRows = await readSource(sourceUrl);
  const sourceRows = rawRows
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);
  const withAnswer = sourceRows.filter((row) => row.answer).length;

  const byKey = new Map<string, Set<SourceRow>>();
  for (const row of sourceRows) {
    for (const key of [
      ...new Set([...keysOf(row.content), ...keysOf(row.restoredContent)]),
    ]) {
      const bucket = byKey.get(key) ?? new Set<SourceRow>();
      bucket.add(row);
      byKey.set(key, bucket);
    }
  }

  /** 어떤 키로든 걸린 원본 후보. 둘 이상이면 어느 쪽인지 모르므로 쓰지 않는다. */
  function candidatesFor(content: string): SourceRow[] {
    const found = new Set<SourceRow>();
    for (const key of keysOf(content)) {
      for (const row of byKey.get(key) ?? []) found.add(row);
    }
    return [...found];
  }

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, answer: true, content: true },
    });

    const fills: Update[] = [];
    const corrections: Update[] = [];
    const conflicts: Array<{ id: string; ours: string; source: string }> = [];
    let matchedUnique = 0;
    let duplicateContent = 0;
    let unmatched = 0;
    let sourceEmpty = 0;
    let fillHeldNoChoices = 0;
    let fixHeldNoChoices = 0;
    let heldButSourceHasMarkers = 0;
    let alreadyAgrees = 0;

    for (const problem of problems) {
      const candidates = candidatesFor(problem.content);
      if (candidates.length === 0) {
        unmatched += 1;
        continue;
      }
      if (candidates.length > 1) {
        // 본문이 겹치는데 원본 답이 갈리면 어느 쪽인지 모른다 — 건드리지 않는다.
        duplicateContent += 1;
        continue;
      }
      matchedUnique += 1;
      const source = candidates[0];
      if (!source.answer) {
        sourceEmpty += 1;
        continue;
      }

      const ours = problem.answer.trim();
      const missing = !ours || ours.includes(SENTINEL);
      if (missing) {
        if (source.isChoice && !rendersChoices(problem.content)) {
          fillHeldNoChoices += 1;
          if (source.markerCount >= 2) heldButSourceHasMarkers += 1;
          continue;
        }
        fills.push({ id: problem.id, answer: source.answer });
        continue;
      }

      if (normalizeAnswer(ours) === normalizeAnswer(source.answer)) {
        alreadyAgrees += 1;
        continue;
      }
      if (!source.isChoice) continue;
      if (MARKER_ONLY.test(ours)) {
        // 번호끼리 어긋난다 — 자동 교정하지 않는다. 사람이 본다.
        conflicts.push({ id: problem.id, ours, source: source.answer });
        continue;
      }
      // 값으로 들어간 객관식 정답 → 원본 번호로 교정 대상.
      if (!rendersChoices(problem.content)) {
        fixHeldNoChoices += 1;
        if (source.markerCount >= 2) heldButSourceHasMarkers += 1;
        continue;
      }
      corrections.push({ id: problem.id, answer: source.answer });
    }

    console.log("── RPM 원본 정답 복구 ──");
    console.log(
      `원본 행 ${sourceRows.length} · 정답 환원됨 ${withAnswer}` +
        ` · 우리 transformed ${problems.length}`,
    );
    console.log(
      `본문 매칭 — 유일 ${matchedUnique} · 본문중복 제외 ${duplicateContent}` +
        ` · 매칭실패 ${unmatched}`,
    );
    console.log(
      `무정답 채우기 대상 ${fills.length}` +
        ` (보기 미렌더로 보류 ${fillHeldNoChoices} · 원본에도 정답 없음 ${sourceEmpty})`,
    );
    console.log(
      `교정 대상(값→번호) ${corrections.length}` +
        ` (보기 미렌더로 보류 ${fixHeldNoChoices})` +
        `${fixExisting ? "" : " — 적용하려면 --fix-existing"}`,
    );
    console.log(
      `보류분 중 원본에 보기 마커가 남아 있는 문항 ${heldButSourceHasMarkers}` +
        " — 본문 보기 마커를 복원하면 그만큼 더 채울 수 있습니다.",
    );
    console.log(`이미 원본과 같은 답 ${alreadyAgrees}`);
    console.log(`번호 충돌 ${conflicts.length}건 — 자동 교정하지 않습니다:`);
    for (const conflict of conflicts) {
      console.log(
        `  ${conflict.id} · 우리 ${conflict.ours} · 원본 ${conflict.source}`,
      );
    }

    const targets = fixExisting ? [...fills, ...corrections] : fills;
    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 적용하려면 --apply (대상 ${targets.length})`,
      );
      return;
    }

    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `\n차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      return;
    }
    let updated = 0;
    for (const target of targets) {
      await prisma.problem.update({
        where: { id: target.id },
        data: { answer: target.answer },
      });
      updated += 1;
    }
    console.log(`\n복구 완료 — ${updated}건`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
