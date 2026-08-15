/**
 * 수정된 `convertRpmExtractedRow()` 를 **원본 6,151행 실데이터**에 돌려 검증한다.
 * 합성 픽스처가 아니라 실제 sumaek 행으로 다음 네 가지를 잰다.
 *
 *   1. 정답 채움률 — `(정답 없음)` 이 아닌 비율 (원본 정답 보유 6,057행이 기준)
 *   2. 객관식 정답이 **보기 번호(①~⑤)** 로 나오는 비율 (원장님 확정 규칙)
 *   3. 본문에 보기 마커가 실려 `parseProblemContent` 가 보기를 가르는 비율
 *   4. 지금 DB 의 `transformed` 행(원본에서 복구해 넣은 것)과 결과가 같은지
 *
 * 읽기 전용이다. 원본에는 SELECT 만 하고, 우리 DB 도 조회만 한다.
 *
 *   npx tsx scripts/qa/verify-convert-rpm.ts
 */
import { pathToFileURL } from "node:url";

import { PrismaClient } from "@prisma/client";

import { convertRpmExtractedRow } from "../../src/lib/import/convertRpm";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";
import { readEnvFile } from "../import/readEnvFile";

const DEFAULT_SUMAEK_ENV = "C:\\Creative\\sumaek\\.env";
const DEFAULT_POSTGRES_JS =
  "C:\\Creative\\sumaek\\packages\\db\\node_modules\\postgres\\src\\index.js";
const SENTINEL = "(정답 없음)";
const MARKER_ONLY = /^[①②③④⑤⑥⑦⑧⑨⑩](\s*,\s*[①②③④⑤⑥⑦⑧⑨⑩])*$/;

const SOURCE_SELECT = `
SELECT
  q.id::text AS id,
  q.kind,
  q.printed_number,
  q.source_ref,
  qv.body,
  qv.choices,
  qv.answer,
  qv.explanation,
  qv.difficulty,
  qv.question_type_tags
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

const squeeze = (value: string): string => value.replace(/\s+/g, "");
const normAnswer = (value: string): string =>
  squeeze(value).replace(/[$]/g, "").replace(/\\/g, "");

async function readSource(): Promise<Array<Record<string, unknown>>> {
  const url =
    process.env.SUMAEK_DATABASE_URL?.trim() ||
    (await readEnvFile(process.env.SUMAEK_ENV_PATH ?? DEFAULT_SUMAEK_ENV))
      ?.DATABASE_URL;
  if (!url) throw new Error("원본 접속 정보 없음 (SUMAEK_DATABASE_URL)");
  const driverPath = process.env.SUMAEK_POSTGRES_JS ?? DEFAULT_POSTGRES_JS;
  const loaded = (await import(pathToFileURL(driverPath).href)) as {
    default: PostgresFactory;
  };
  const sql = loaded.default(url, {
    max: 1,
    prepare: false,
    connection: { application_name: "verify-convert-rpm-readonly" },
  });
  try {
    await sql.unsafe("SET default_transaction_read_only = on");
    await sql.unsafe("SET SESSION CHARACTERISTICS AS TRANSACTION READ ONLY");
    return await sql.unsafe(SOURCE_SELECT);
  } finally {
    await sql.end();
  }
}

interface ChoiceItem {
  marker: string;
  text: string;
}

function sourceChoices(raw: unknown): ChoiceItem[] {
  if (!Array.isArray(raw)) return [];
  const items: Array<{ order: number; marker: string; text: string }> = [];
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
  const tail = squeeze(items.map((item) => item.text).join(""));
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

function main(): Promise<void> {
  return run();
}

async function run(): Promise<void> {
  const detail = process.argv.includes("--detail");
  const questionDiffIds: string[] = [];
  const answerDiffPairs: string[] = [];
  const dbOnlyPairs: string[] = [];
  const convOnlyPairs: string[] = [];
  const rows = await readSource();
  const prisma = new PrismaClient();
  try {
    // ── 원본 → 수정된 변환기 ────────────────────────────────────────────────
    const stats = {
      total: rows.length,
      sourceHasAnswer: 0,
      filled: 0,
      missedWithSourceAnswer: 0,
      mcRows: 0,
      mcFilled: 0,
      mcMarkerForm: 0,
      mcValueForm: 0,
      saRows: 0,
      saFilled: 0,
      withChoices: 0,
      choicesParsed: 0,
      duplicatedChoiceBlock: 0,
    };
    const missedByKind = new Map<string, number>();

    interface Converted {
      id: string;
      answer: string;
      content: string;
      legacyKey: string;
      restoredKey: string;
    }
    const converted: Converted[] = [];

    for (const row of rows) {
      const answerJson = asRecord(row.answer);
      const kind =
        typeof answerJson?.kind === "string" ? answerJson.kind : "(none)";
      const hasSourceAnswer = Boolean(
        (Array.isArray(answerJson?.correctChoiceIds) &&
          answerJson.correctChoiceIds.length > 0) ||
        (Array.isArray(answerJson?.accepted) && answerJson.accepted.length > 0),
      );
      if (hasSourceAnswer) stats.sourceHasAnswer += 1;

      const draft = convertRpmExtractedRow({
        id: String(row.id),
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

      const filled = draft.answer !== SENTINEL && draft.answer.trim() !== "";
      if (filled) stats.filled += 1;
      if (hasSourceAnswer && !filled) {
        stats.missedWithSourceAnswer += 1;
        missedByKind.set(kind, (missedByKind.get(kind) ?? 0) + 1);
      }

      if (kind === "multiple_choice") {
        stats.mcRows += 1;
        if (filled) {
          stats.mcFilled += 1;
          if (MARKER_ONLY.test(draft.answer.trim())) stats.mcMarkerForm += 1;
          else stats.mcValueForm += 1;
        }
      } else if (kind === "short_answer") {
        stats.saRows += 1;
        if (filled) stats.saFilled += 1;
      }

      const choices = sourceChoices(row.choices);
      if (choices.length >= 2) {
        stats.withChoices += 1;
        const parsed = parseProblemContent(draft.content);
        if (parsed.choices.length >= 2) stats.choicesParsed += 1;
        // 지문에 보기 값이 한 번 더 남아 있는지 (적재 원본 body 결함)
        const stem = stripDuplicatedChoiceTail(
          flattenStructured(row.body).content,
          choices,
        );
        if (squeeze(stem) !== squeeze(flattenStructured(row.body).content)) {
          stats.duplicatedChoiceBlock += 1;
        }
      }

      const body = flattenStructured(row.body).content;
      const legacy = [body, flattenStructured(row.choices).content]
        .filter(Boolean)
        .join("\n\n");
      const stem = stripDuplicatedChoiceTail(body, choices);
      const block = choices.map((c) => `${c.marker} ${c.text}`).join("\n\n");
      converted.push({
        id: String(row.id),
        answer: draft.answer,
        content: draft.content,
        legacyKey: squeeze(legacy),
        restoredKey: squeeze([stem, block].filter(Boolean).join("\n\n")),
      });
    }

    // ── 적재본(우리 DB)과 대조 ──────────────────────────────────────────────
    const byKey = new Map<string, Set<Converted>>();
    for (const row of converted) {
      for (const key of new Set([row.legacyKey, row.restoredKey])) {
        if (!key) continue;
        const bucket = byKey.get(key) ?? new Set<Converted>();
        bucket.add(row);
        byKey.set(key, bucket);
      }
    }

    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, answer: true, content: true },
    });

    const cmp = {
      dbRows: problems.length,
      matched: 0,
      ambiguous: 0,
      unmatched: 0,
      answerSame: 0,
      answerDiffDbMissing: 0,
      answerDiffConvMissing: 0,
      answerDiffBoth: 0,
      choicesSame: 0,
      choicesConvOnly: 0,
      choicesDbOnly: 0,
      choicesNeither: 0,
      questionDiff: 0,
    };

    for (const problem of problems) {
      const candidates = byKey.get(squeeze(problem.content));
      if (!candidates) {
        cmp.unmatched += 1;
        continue;
      }
      if (candidates.size > 1) {
        cmp.ambiguous += 1;
        continue;
      }
      cmp.matched += 1;
      const [conv] = [...candidates];

      const dbMissing =
        !problem.answer.trim() || problem.answer.includes("정답 없음");
      const convMissing = conv.answer === SENTINEL || !conv.answer.trim();
      if (!dbMissing && !convMissing) {
        if (normAnswer(problem.answer) === normAnswer(conv.answer))
          cmp.answerSame += 1;
        else {
          cmp.answerDiffBoth += 1;
          if (detail && answerDiffPairs.length < 40) {
            answerDiffPairs.push(
              `${problem.id} | DB=${JSON.stringify(problem.answer.slice(0, 60))} | 원본=${JSON.stringify(conv.answer.slice(0, 60))}`,
            );
          }
        }
      } else if (dbMissing && !convMissing) {
        cmp.answerDiffDbMissing += 1;
        if (detail && convOnlyPairs.length < 10) {
          convOnlyPairs.push(
            `${problem.id} | 원본=${JSON.stringify(conv.answer.slice(0, 40))}`,
          );
        }
      } else if (!dbMissing && convMissing) {
        cmp.answerDiffConvMissing += 1;
        if (detail && dbOnlyPairs.length < 10) {
          dbOnlyPairs.push(
            `${problem.id} | DB=${JSON.stringify(problem.answer.slice(0, 40))}`,
          );
        }
      }

      const dbParsed = parseProblemContent(problem.content);
      const convParsed = parseProblemContent(conv.content);
      const dbOk = dbParsed.choices.length >= 2;
      const convOk = convParsed.choices.length >= 2;
      if (dbOk && convOk) {
        const same =
          dbParsed.choices.length === convParsed.choices.length &&
          dbParsed.choices.every(
            (choice, index) =>
              squeeze(choice) === squeeze(convParsed.choices[index] ?? ""),
          );
        if (same) cmp.choicesSame += 1;
        else cmp.choicesDbOnly += 1;
        if (squeeze(dbParsed.question) !== squeeze(convParsed.question)) {
          cmp.questionDiff += 1;
          if (detail && questionDiffIds.length < 20) {
            questionDiffIds.push(
              `${problem.id} db지문=${squeeze(dbParsed.question).length}자/보기${dbParsed.choices.length}개` +
                ` conv지문=${squeeze(convParsed.question).length}자/보기${convParsed.choices.length}개` +
                ` 포함관계=${
                  squeeze(convParsed.question).includes(
                    squeeze(dbParsed.question),
                  )
                    ? "conv⊃db"
                    : squeeze(dbParsed.question).includes(
                          squeeze(convParsed.question),
                        )
                      ? "db⊃conv"
                      : "무관"
                }`,
            );
          }
        }
      } else if (convOk && !dbOk) cmp.choicesConvOnly += 1;
      else if (dbOk && !convOk) cmp.choicesDbOnly += 1;
      else cmp.choicesNeither += 1;
    }

    console.log("── convertRpmExtractedRow 실데이터 검증 ──");
    console.log(
      `1) 정답 채움 ${stats.filled}/${stats.total}` +
        ` (원본 정답 보유 ${stats.sourceHasAnswer})` +
        ` · 원본엔 있는데 못 채운 행 ${stats.missedWithSourceAnswer}`,
    );
    if (missedByKind.size > 0) {
      console.log(`   못 채운 행 분해: ${[...missedByKind.entries()]}`);
    }
    console.log(
      `   객관식 ${stats.mcRows} → 채움 ${stats.mcFilled}` +
        ` · 주관식 ${stats.saRows} → 채움 ${stats.saFilled}`,
    );
    console.log(
      `2) 객관식 정답 번호 형태 ${stats.mcMarkerForm}/${stats.mcRows}` +
        ` · 값 형태 ${stats.mcValueForm}`,
    );
    console.log(
      `3) 보기 2개 이상인 원본 ${stats.withChoices} 중` +
        ` 본문이 보기로 갈리는 행 ${stats.choicesParsed}` +
        ` · 원본 body 에 보기가 겹쳐 있는 행 ${stats.duplicatedChoiceBlock}`,
    );
    console.log(
      `4) DB transformed ${cmp.dbRows} — 짝지음 ${cmp.matched}` +
        ` · 후보중복 ${cmp.ambiguous} · 매칭실패 ${cmp.unmatched}`,
    );
    console.log(
      `   정답: 같음 ${cmp.answerSame} · 둘 다 있는데 다름 ${cmp.answerDiffBoth}` +
        ` · DB만 있음 ${cmp.answerDiffConvMissing}` +
        ` · 변환본만 있음 ${cmp.answerDiffDbMissing}`,
    );
    console.log(
      `   보기: 양쪽 동일 ${cmp.choicesSame} · 변환본만 갈림 ${cmp.choicesConvOnly}` +
        ` · DB만 갈림/내용 다름 ${cmp.choicesDbOnly} · 양쪽 다 못 가름 ${cmp.choicesNeither}`,
    );
    console.log(`   지문(보기 제외)이 다른 행 ${cmp.questionDiff}`);
    if (detail) {
      console.log("── 상세 ──");
      questionDiffIds.forEach((line) => console.log("  지문차이", line));
      dbOnlyPairs.forEach((line) => console.log("  DB만 정답", line));
      convOnlyPairs.forEach((line) => console.log("  변환본만 정답", line));
      answerDiffPairs.forEach((line) => console.log("  정답차이", line));
    }
  } finally {
    await prisma.$disconnect();
  }
}

void main();
