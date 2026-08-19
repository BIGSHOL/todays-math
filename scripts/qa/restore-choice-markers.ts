/**
 * RPM(sumaek) 원본에서 **보기 마커(①②③④⑤) 복원**.
 *
 * 배경: 적재 때 `flattenStructured()` 가 `choices` 를 펴면서 각 보기의 `marker` 를
 * 버렸다. 정답이 통째로 날아간 것과 같은 원인이다. 그래서 시험지에 보기 번호가
 * 안 찍히고, 번호 정답(`③`)을 넣어도 학생이 대조할 대상이 없다.
 *
 * 이 스크립트는 **추측으로 쪼개지 않는다.** 원본이 들고 있는 보기 배열을 그대로
 * 가져와 `marker + 보기 본문` 형태로 다시 붙인다. 반복 구간을 n등분하는 복구가
 * 아니므로 오분해 위험이 없다.
 *
 * 지면 안전 규칙 — 본문은 학생이 보는 지면이라 바꾸기 전/후를 문항마다 검증한다:
 *   1. 지문(보기 앞부분)은 원본 body 그대로. 새 지문은 기존 본문의 접두사여야 한다.
 *   2. 새 본문이 `parseProblemContent` 로 원본 보기 **개수만큼** 분해돼야 한다.
 *   3. 분해된 보기 문자열이 원본 보기와 **순서까지** 일치해야 한다.
 *   하나라도 어긋나면 그 문항은 건너뛴다(숫자로 보고).
 *
 * 이미 보기가 정상 분해되는 문항은 손대지 않는다.
 *
 * 접속 정보는 저장소에 넣지 않는다 — `SUMAEK_DATABASE_URL` 을 먼저 보고,
 * 없으면 `SUMAEK_ENV_PATH`(기본 `C:\Creative\sumaek\.env`)를 파싱한다.
 * 원본에는 **SELECT 만** 한다.
 *
 *   npx tsx scripts/qa/restore-choice-markers.ts              드라이런
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/restore-choice-markers.ts --apply
 */
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";
import { ANSWER_CIRCLED_CLASS } from "../../src/lib/math/circledNumber";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { readEnvFile } from "../import/readEnvFile";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
const SENTINEL = "정답 없음";
// 계열은 `circledNumber.ts` 한 곳에서 온다.
const MARKER_ONLY = new RegExp(
  String.raw`^[${ANSWER_CIRCLED_CLASS}](\s*,\s*[${ANSWER_CIRCLED_CLASS}])*$`,
);

const SOURCE_SELECT = `
SELECT
  q.id::text AS id,
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

interface Choice {
  order: number;
  marker: string;
  text: string;
}

interface SourceRow {
  id: string;
  /** 적재 때와 같은 방식으로 편 본문 — 우리 `Problem.content` 와 문자열이 같다. */
  content: string;
  /** 보기를 뺀 지문 부분. */
  stem: string;
  /** 지문 뒤에 마커 없는 보기 값이 겹쳐 있어 잘라 냈는지. */
  duplicateTrimmed: boolean;
  choices: Choice[];
  answer: string;
  isChoiceAnswer: boolean;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function toChoices(raw: unknown): Choice[] {
  if (!Array.isArray(raw)) return [];
  const items: Choice[] = [];
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

function answerText(
  answer: Record<string, unknown> | null,
  choices: Choice[],
  rawChoices: unknown,
): { text: string; isChoice: boolean } {
  const kind = typeof answer?.kind === "string" ? answer.kind : "";
  if (kind === "multiple_choice") {
    const ids = Array.isArray(answer?.correctChoiceIds)
      ? answer.correctChoiceIds.filter(
          (value): value is string => typeof value === "string",
        )
      : [];
    const markers: Array<{ order: number; marker: string }> = [];
    if (Array.isArray(rawChoices)) {
      rawChoices.forEach((entry, index) => {
        const record = asRecord(entry);
        const id = typeof record?.choiceId === "string" ? record.choiceId : "";
        const marker =
          typeof record?.marker === "string" ? record.marker.trim() : "";
        const order =
          typeof record?.order === "number" ? record.order : index + 1;
        if (id && marker && ids.includes(id)) markers.push({ order, marker });
      });
    }
    return {
      text: markers
        .sort((a, b) => a.order - b.order)
        .map((m) => m.marker)
        .join(", "),
      isChoice: true,
    };
  }
  const accepted = Array.isArray(answer?.accepted) ? answer.accepted : [];
  const text = accepted
    .map((entry) => {
      const value = asRecord(entry)?.value;
      return typeof value === "string" ? value.trim() : "";
    })
    .filter(Boolean)
    .join(", ");
  return { text, isChoice: false };
}

const squeeze = (value: string): string => value.replace(/\s+/g, "");

/**
 * 지문 뒤에 보기 값이 마커 없이 한 번 더 붙어 있는 경우(적재 때 body 와 choices 가
 * 겹쳐 저장된 결함)를 잘라 낸다. 겹치지 않으면 body 를 그대로 쓴다.
 */
function stripDuplicatedChoiceTail(body: string, choices: Choice[]): string {
  if (choices.length === 0) return body;
  const tail = squeeze(choices.map((c) => c.text).join(""));
  if (!tail) return body;
  const segments = body.split("\n\n");
  for (let take = segments.length; take > 0; take -= 1) {
    const candidate = squeeze(segments.slice(segments.length - take).join(""));
    if (candidate === tail) {
      return segments
        .slice(0, segments.length - take)
        .join("\n\n")
        .trimEnd();
    }
  }
  return body;
}

function toSourceRow(row: Record<string, unknown>): SourceRow | null {
  const id = typeof row.id === "string" ? row.id : "";
  if (!id) return null;
  const body = flattenStructured(row.body).content;
  const flatChoices = flattenStructured(row.choices).content;
  // 적재 때(convertRpmExtractedRow)와 같은 조립 순서라야 본문이 일치한다.
  const content = [body, flatChoices].filter(Boolean).join("\n\n");
  const choices = toChoices(row.choices);
  const { text, isChoice } = answerText(
    asRecord(row.answer),
    choices,
    row.choices,
  );
  const stem = stripDuplicatedChoiceTail(body, choices);
  return {
    id,
    content,
    stem,
    duplicateTrimmed: squeeze(stem) !== squeeze(body),
    choices,
    answer: text,
    isChoiceAnswer: isChoice,
  };
}

async function resolveSourceUrl(): Promise<string | null> {
  const direct = process.env.SUMAEK_DATABASE_URL?.trim();
  if (direct) return direct;
  const envFile = await readEnvFile(
    process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV,
  );
  return envFile?.DATABASE_URL?.trim() || null;
}

async function readSource(
  url: string,
): Promise<Array<Record<string, unknown>>> {
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: PostgresFactory;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "restore-choice-markers-readonly" },
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

/** 지문 + `마커 보기` 블록. 보기는 줄 머리에 와야 `parseProblemContent` 가 잡는다. */
function rebuild(source: SourceRow): string {
  const block = source.choices
    .map((choice) => `${choice.marker} ${choice.text}`)
    .join("\n\n");
  return [source.stem, block].filter(Boolean).join("\n\n");
}

/** 바꾼 본문이 안전한지 문항마다 확인한다. 하나라도 어긋나면 건드리지 않는다. */
function verify(
  before: string,
  after: string,
  source: SourceRow,
): { ok: boolean; reason: string } {
  const parsed = parseProblemContent(after);
  if (parsed.choices.length !== source.choices.length) {
    return { ok: false, reason: "보기 개수 불일치" };
  }
  if (parsed.choices.length < 2) return { ok: false, reason: "보기 2개 미만" };
  if (!parsed.question.trim()) return { ok: false, reason: "지문이 비었음" };
  for (let i = 0; i < parsed.choices.length; i += 1) {
    if (squeeze(parsed.choices[i]) !== squeeze(source.choices[i].text)) {
      return { ok: false, reason: "보기 내용/순서 불일치" };
    }
  }
  // 지문은 원본 body 그대로다 — 기존 본문의 접두사가 아니면 무언가 만들어 낸 것이다.
  if (!squeeze(before).startsWith(squeeze(source.stem))) {
    return { ok: false, reason: "지문이 기존 본문의 접두사가 아님" };
  }
  return { ok: true, reason: "" };
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const sourceUrl = await resolveSourceUrl();
  if (!sourceUrl) {
    console.log(
      "원본 접속 정보가 없습니다 — SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하세요.",
    );
    return;
  }

  const sourceRows = (await readSource(sourceUrl))
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);

  const byContent = new Map<string, SourceRow[]>();
  for (const row of sourceRows) {
    const key = squeeze(row.content);
    if (!key) continue;
    byContent.set(key, [...(byContent.get(key) ?? []), row]);
  }

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, answer: true, content: true },
    });

    const updates: Array<{ id: string; content: string }> = [];
    const failures = new Map<string, number>();
    let matchedUnique = 0;
    let duplicateContent = 0;
    let unmatched = 0;
    let alreadyFine = 0;
    let noSourceChoices = 0;
    let duplicateTailTrimmed = 0;
    let unblockFill = 0;
    let unblockFix = 0;

    for (const problem of problems) {
      const candidates = byContent.get(squeeze(problem.content));
      if (!candidates) {
        unmatched += 1;
        continue;
      }
      if (candidates.length > 1) {
        // 본문이 겹쳐 원본이 갈리면 어느 쪽 보기인지 모른다 — 건드리지 않는다.
        duplicateContent += 1;
        continue;
      }
      matchedUnique += 1;
      const source = candidates[0];

      if (parseProblemContent(problem.content).choices.length >= 2) {
        alreadyFine += 1;
        continue;
      }
      if (source.choices.length < 2) {
        noSourceChoices += 1;
        continue;
      }

      const rebuilt = rebuild(source);
      const check = verify(problem.content, rebuilt, source);
      if (!check.ok) {
        failures.set(check.reason, (failures.get(check.reason) ?? 0) + 1);
        continue;
      }
      if (source.duplicateTrimmed) duplicateTailTrimmed += 1;
      updates.push({ id: problem.id, content: rebuilt });

      // 마커가 살아나면 정답 백필에서 보류됐던 번호 정답이 들어갈 수 있다.
      if (source.isChoiceAnswer && source.answer) {
        const ours = problem.answer.trim();
        if (!ours || ours.includes(SENTINEL)) unblockFill += 1;
        else if (
          !MARKER_ONLY.test(ours) &&
          squeeze(ours) !== squeeze(source.answer)
        ) {
          unblockFix += 1;
        }
      }
    }

    console.log("── 보기 마커 복원 ──");
    console.log(
      `원본 행 ${sourceRows.length} · 우리 transformed ${problems.length}`,
    );
    console.log(
      `본문 매칭 — 유일 ${matchedUnique} · 본문중복 제외 ${duplicateContent}` +
        ` · 매칭실패 ${unmatched}`,
    );
    console.log(
      `이미 보기가 분해되는 문항 ${alreadyFine}(손대지 않음)` +
        ` · 원본에 보기 없음 ${noSourceChoices}`,
    );
    console.log(
      `복원 대상 ${updates.length + [...failures.values()].reduce((a, b) => a + b, 0)}` +
        ` — 검증 통과 ${updates.length} · 검증 실패 건너뜀 ${[...failures.values()].reduce((a, b) => a + b, 0)}`,
    );
    for (const [reason, count] of failures) {
      console.log(`    실패 사유 ${reason}: ${count}`);
    }
    console.log(`중복 보기 블록 1회로 정리 ${duplicateTailTrimmed}`);
    console.log(
      `복원 후 정답 백필로 추가로 채워질 문항 ${unblockFill}` +
        ` · 값→번호 교정이 풀리는 문항 ${unblockFix}`,
    );

    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 적용하려면 --apply (대상 ${updates.length})`,
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
    for (const update of updates) {
      await prisma.problem.update({
        where: { id: update.id },
        data: { content: update.content },
      });
      updated += 1;
    }
    console.log(`\n복원 완료 — ${updated}건`);
  } finally {
    await prisma.$disconnect();
  }
}

void main();
