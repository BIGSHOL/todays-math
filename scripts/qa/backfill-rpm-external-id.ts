/**
 * RPM(sumaek) 이관분 4,862행의 `externalId` 채우기 — **AI 0 · 토큰 0**.
 *
 * 배경: `convertRpmExtractedRow()` 는 처음부터 `externalId: row.id` 를 실어 보냈는데
 * 적재 단계가 그 값을 버렸다(2026-08-14, `1ed51df` 이전). 그래서 `source='transformed'`
 * 4,862행은 "원본 어디서 왔나" 를 물을 수 없다. 원본 역추적이 막히면 중복 판정·그림
 * 연결·폐기 판단 셋이 같이 막힌다(트랙 C 참조).
 *
 * 짝짓기: 적재 때 키를 버렸으니 본문으로 되짚는다. 원본 `body + choices` 를 **적재 때와
 * 같은 함수로** 펴면 우리 `Problem.content` 와 문자열이 같아진다. 다만
 * `restore-choice-markers.ts` 로 보기 마커를 복원한 문항은 본문이 바뀌어 그 일치가
 * 깨지므로, 원본 한 행마다 **적재 당시 형태와 마커 복원 형태를 둘 다** 키로 건다
 * (`recover-rpm-answers.ts` 의 `toSourceRow`/`keysOf` 를 그대로 쓴다 — 같은 규칙이
 * 두 벌 있으면 반드시 갈라진다).
 *
 * ⚠️ **정확히 한 건에만 대응될 때만 채운다.**
 *   - 원본 후보가 둘 이상이면 미상(`ambiguous`). 본문이 같고 `printed_number` 만
 *     다른 쌍둥이가 실제로 있다 — 어느 쪽인지 모르는 채로 찍으면 그 뒤의 중복 판단이
 *     전부 그 위에 쌓인다.
 *   - 한 원본을 두 DB 행이 차지해도 미상(`contested`). `externalId` 는 `@unique` 라
 *     둘 중 하나는 어차피 못 넣고, 그 전에 근거가 없다.
 *
 * `--resolve-by-solution` 은 미상 그룹을 **해설(`explanation`) 대조**로 한 번 더 가른다.
 * 해설도 적재 때 같은 원본 행에서 온 값이라 추측이 아니라 두 번째 정확 키다. 다만
 * `backfill-answers-from-twins.ts` 가 해설이 비어 있던 행에 쌍둥이 해설을 복사한 적이
 * 있어 **단사(injective)인 그룹만** 인정한다. 기본은 꺼져 있다 — 이 233건은 원장님
 * 결정 대기 대상이라(트랙 C-2) 자동으로 손대지 않는다.
 *
 * 이 스크립트는 `externalId` **외의 컬럼을 절대 쓰지 않고, 행을 지우지 않는다.**
 * 이미 값이 있는 행은 건너뛴다(멱등).
 *
 *   npx tsx scripts/qa/backfill-rpm-external-id.ts                    드라이런
 *   npx tsx scripts/qa/backfill-rpm-external-id.ts --json out.json    매칭표까지 파일로
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-rpm-external-id.ts --apply
 */
import { PrismaClient } from "@prisma/client";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { isDirectScript } from "../import/isDirectScript";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";
import { writeJson } from "../import/writeJson";
import {
  keysOf,
  readSource,
  resolveSourceUrl,
  toSourceRow,
  type SourceRow,
} from "./recover-rpm-answers";

/** `recover-rpm-answers` 의 질의에 `explanation` 만 더한 것 — 미상 그룹을 가르는 데 쓴다. */
const SELECT_WITH_EXPLANATION = `
SELECT
  q.id::text AS id,
  q.printed_number,
  q.source_ref,
  qv.body,
  qv.choices,
  qv.answer,
  qv.explanation
FROM questions q
JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

const squeeze = (value: string): string => value.replace(/\s+/g, "");

/** 미상 사유 — 완료 보고에 "왜 못 채웠나" 를 숫자로 적기 위한 구분이다. */
export type UnresolvedReason =
  /** 본문이 같은 원본 행이 둘 이상 — 어느 쪽인지 모른다. */
  | "ambiguous"
  /** 유일 매칭이지만 같은 원본을 다른 DB 행도 차지했다. */
  | "contested"
  /** 원본에 대응하는 행이 없다. */
  | "unmatched"
  /** 이 원본 id 를 다른 문항이 이미 `externalId` 로 쓰고 있다. */
  | "external-id-taken";

export interface MatchResult {
  /** 채울 수 있는 것 — `problemId → sourceId`. */
  fills: Array<{ problemId: string; sourceId: string; basis: "content" | "solution" }>;
  /** 못 채운 것과 사유. */
  unresolved: Array<{ problemId: string; reason: UnresolvedReason; candidates: string[] }>;
  /** 이미 `externalId` 가 있어 건드리지 않은 행. */
  alreadySet: number;
}

interface DbRow {
  id: string;
  content: string;
  solution: string | null;
  externalId: string | null;
}

/**
 * 본문(+선택적으로 해설)으로 DB 행 ↔ 원본 행을 짝짓는다.
 * 순수 함수라 테스트가 실데이터 없이도 규칙을 검증할 수 있다.
 */
export function matchProblems(
  problems: DbRow[],
  sources: SourceRow[],
  options: {
    /** `sourceId → 해설(공백 제거)`. 미상 그룹을 가를 때만 쓴다. */
    explanationById?: Map<string, string>;
    resolveBySolution?: boolean;
    /** 이미 다른 문항이 점유한 `externalId` 집합. */
    takenExternalIds?: Set<string>;
  } = {},
): MatchResult {
  const byKey = new Map<string, Set<SourceRow>>();
  for (const row of sources) {
    for (const key of new Set([
      ...keysOf(row.content),
      ...keysOf(row.restoredContent),
    ])) {
      if (!key) continue;
      const bucket = byKey.get(key) ?? new Set<SourceRow>();
      bucket.add(row);
      byKey.set(key, bucket);
    }
  }
  const candidatesFor = (content: string): SourceRow[] => {
    const found = new Set<SourceRow>();
    for (const key of keysOf(content)) {
      for (const row of byKey.get(key) ?? []) found.add(row);
    }
    return [...found];
  };

  const result: MatchResult = { fills: [], unresolved: [], alreadySet: 0 };
  // 1차 — 후보가 정확히 하나인 것만 잠정 배정한다.
  const claims = new Map<string, string[]>(); // sourceId → problemId[]
  const ambiguous: Array<{ problem: DbRow; candidates: SourceRow[] }> = [];

  for (const problem of problems) {
    if (problem.externalId) {
      result.alreadySet += 1;
      continue;
    }
    const candidates = candidatesFor(problem.content);
    if (candidates.length === 0) {
      result.unresolved.push({
        problemId: problem.id,
        reason: "unmatched",
        candidates: [],
      });
      continue;
    }
    if (candidates.length > 1) {
      ambiguous.push({ problem, candidates });
      continue;
    }
    const claimed = claims.get(candidates[0].id) ?? [];
    claimed.push(problem.id);
    claims.set(candidates[0].id, claimed);
  }

  // 2차 — 미상 그룹을 해설로 한 번 더 가른다(옵션). 단사인 그룹만 인정한다.
  const solved = new Map<string, string>(); // problemId → sourceId
  if (options.resolveBySolution && options.explanationById) {
    const explanations = options.explanationById;
    const groups = new Map<string, Array<{ problem: DbRow; candidates: SourceRow[] }>>();
    for (const entry of ambiguous) {
      const key = entry.candidates
        .map((row) => row.id)
        .sort()
        .join("|");
      const bucket = groups.get(key) ?? [];
      bucket.push(entry);
      groups.set(key, bucket);
    }
    for (const [key, members] of groups) {
      const sourceIds = key.split("|");
      // 원본 해설이 서로 갈리지 않으면 애초에 가를 수 없다.
      const distinct = new Set(sourceIds.map((id) => explanations.get(id) ?? ""));
      if (distinct.size !== sourceIds.length) continue;
      const pairing = new Map<string, string>(); // sourceId → problemId
      let ok = true;
      for (const member of members) {
        const mine = squeeze(member.problem.solution ?? "");
        if (!mine) {
          ok = false;
          break;
        }
        const hits = sourceIds.filter((id) => explanations.get(id) === mine);
        // 정확히 한 원본에만 대응하고, 그 원본을 다른 DB 행이 이미 집지 않았어야 한다.
        if (hits.length !== 1 || pairing.has(hits[0])) {
          ok = false;
          break;
        }
        pairing.set(hits[0], member.problem.id);
      }
      if (!ok) continue;
      for (const [sourceId, problemId] of pairing) solved.set(problemId, sourceId);
    }
  }

  for (const entry of ambiguous) {
    const sourceId = solved.get(entry.problem.id);
    if (sourceId) {
      const claimed = claims.get(sourceId) ?? [];
      claimed.push(entry.problem.id);
      claims.set(sourceId, claimed);
      continue;
    }
    result.unresolved.push({
      problemId: entry.problem.id,
      reason: "ambiguous",
      candidates: entry.candidates.map((row) => row.id),
    });
  }

  const taken = options.takenExternalIds ?? new Set<string>();
  const basisOf = (problemId: string): "content" | "solution" =>
    solved.has(problemId) ? "solution" : "content";
  for (const [sourceId, problemIds] of claims) {
    if (problemIds.length > 1) {
      // 한 원본을 여럿이 차지한다 — `externalId` 는 @unique 다. 근거도 없다.
      for (const problemId of problemIds) {
        result.unresolved.push({
          problemId,
          reason: "contested",
          candidates: [sourceId],
        });
      }
      continue;
    }
    if (taken.has(sourceId)) {
      result.unresolved.push({
        problemId: problemIds[0],
        reason: "external-id-taken",
        candidates: [sourceId],
      });
      continue;
    }
    result.fills.push({
      problemId: problemIds[0],
      sourceId,
      basis: basisOf(problemIds[0]),
    });
  }
  return result;
}

function jsonArg(): string | null {
  const index = process.argv.indexOf("--json");
  if (index < 0) return null;
  return process.argv[index + 1] ?? "scripts/qa/reports/rpm-external-id.json";
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const resolveBySolution = process.argv.includes("--resolve-by-solution");

  // 게이트를 **네트워크·DB 접근 앞**에 둔다 — 쓰기 의도가 막혀 있으면 원본도 안 읽는다.
  if (apply) {
    const inspection = await inspectDatabaseTargets();
    if (
      !inspection.selected.canMigrateOrLoad &&
      !allowSharedImport(inspection.selected)
    ) {
      console.log(
        `차단 — ${inspection.selected.reason}\nALLOW_SHARED_IMPORT=1 을 명시하세요.`,
      );
      process.exitCode = 1;
      return;
    }
  }

  const sourceUrl = await resolveSourceUrl();
  if (!sourceUrl) {
    console.log(
      "원본 접속 정보가 없습니다 — SUMAEK_DATABASE_URL 또는 SUMAEK_ENV_PATH 를 지정하세요.",
    );
    process.exitCode = 1;
    return;
  }

  const rawRows = await readSource(sourceUrl, SELECT_WITH_EXPLANATION);
  const sources = rawRows
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);
  const explanationById = new Map<string, string>();
  for (const row of rawRows) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    explanationById.set(id, squeeze(flattenStructured(row.explanation).content));
  }

  const prisma = new PrismaClient();
  try {
    // ⚠️ 본문 대조는 **`source='transformed'` 행에만** 건다.
    // 트랙 D(HWP 재추출)가 `past_exam` 본문을 갈아끼울 수 있으므로 그 본문을
    // 짝짓기 키로 쓰면 안 된다 — 여기서는 아예 읽지 않는다.
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: { id: true, content: true, solution: true, externalId: true },
    });
    // 다른 이관(기출·자작)이 같은 문자열을 쓰고 있으면 @unique 에 걸린다 — 먼저 본다.
    // **`externalId` 문자열만** 읽는다(본문 아님). 기출의 `externalId` 는
    // `{exam_id}-{문항번호}` 라 본문 재추출과 무관하다.
    const others = await prisma.problem.findMany({
      where: { NOT: { externalId: null }, source: { not: "transformed" } },
      select: { externalId: true },
    });
    const taken = new Set(
      others
        .map((row) => row.externalId)
        .filter((value): value is string => Boolean(value)),
    );

    const result = matchProblems(problems, sources, {
      explanationById,
      resolveBySolution,
      takenExternalIds: taken,
    });

    const byReason = new Map<UnresolvedReason, number>();
    for (const row of result.unresolved) {
      byReason.set(row.reason, (byReason.get(row.reason) ?? 0) + 1);
    }
    const bySolution = result.fills.filter((f) => f.basis === "solution").length;

    console.log("── RPM externalId 되짚기 (AI 0 · 토큰 0) ──");
    console.log(
      `원본 행 ${sources.length} · 우리 transformed ${problems.length}` +
        ` (이미 채워진 행 ${result.alreadySet})`,
    );
    console.log(
      `채울 수 있음 ${result.fills.length}` +
        (resolveBySolution ? ` (본문 ${result.fills.length - bySolution} · 해설 ${bySolution})` : ""),
    );
    console.log(`미상 ${result.unresolved.length}`);
    for (const reason of [
      "ambiguous",
      "contested",
      "unmatched",
      "external-id-taken",
    ] as UnresolvedReason[]) {
      const count = byReason.get(reason) ?? 0;
      if (count > 0) console.log(`  ${reason} ${count}`);
    }
    if (!resolveBySolution) {
      console.log(
        "  (미상 그룹을 해설로 더 가르려면 --resolve-by-solution — 원장님 결정 대기분이라 기본은 끔)",
      );
    }

    const jsonPath = jsonArg();
    if (jsonPath) {
      await writeJson(jsonPath, {
        generatedFrom: "scripts/qa/backfill-rpm-external-id.ts",
        sourceRows: sources.length,
        dbRows: problems.length,
        resolveBySolution,
        fills: result.fills,
        unresolved: result.unresolved,
      });
      console.log(`매칭표 기록 — ${jsonPath}`);
    }

    if (!apply) {
      console.log(
        `\n드라이런 — 변경 없음. 적용하려면 --apply (대상 ${result.fills.length})`,
      );
      return;
    }

    let updated = 0;
    for (const fill of result.fills) {
      // `externalId` 외의 컬럼은 건드리지 않는다. 이미 값이 있으면 위에서 걸러졌다.
      await prisma.problem.update({
        where: { id: fill.problemId },
        data: { externalId: fill.sourceId },
      });
      updated += 1;
    }
    console.log(`\n채움 완료 — ${updated}건`);
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  void main();
}
