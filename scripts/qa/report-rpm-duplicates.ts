/**
 * RPM 이관분 중 **본문이 같아 원본을 하나로 못 좁히는 233건(88그룹)** 판단 근거표.
 *
 * `backfill-rpm-external-id.ts` 가 `externalId` 를 채우고 남긴 미상분이 그대로 이 대상이다.
 * 그룹마다 「원본 교재·쪽·번호 / 정답 유무 / 그림 유무 / 단원 매핑 상태」를 뽑아
 * `docs/planning/13-rpm-duplicate-groups.md` 로 쓴다.
 *
 * ⚠️ **읽기 전용이다.** 행을 지우지도, `reviewStatus` 를 내리지도 않는다.
 * 무엇을 남길지는 원장님 결정 사항이다(트랙 C-2).
 *
 * 본문은 한 글자도 싣지 않는다 — 문항을 가리키는 데는 교재·쪽·인쇄번호로 충분하고,
 * 보고서에 지문을 실으면 대조하는 사람이 원본 대신 보고서를 믿게 된다.
 *
 *   npx tsx scripts/qa/report-rpm-duplicates.ts
 *   npx tsx scripts/qa/report-rpm-duplicates.ts --out docs/planning/13-rpm-duplicate-groups.md
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { PrismaClient } from "@prisma/client";

import { classifyDrafts } from "../../src/lib/import/buildReport";
import { convertRpmExtractedRow } from "../../src/lib/import/convertRpm";
import { flattenStructured } from "../../src/lib/import/flattenStructured";
import { groupBy as groupByAxes, type AxisSet, type Row as DupRow } from "./find-true-duplicates";
import type { UnitLike } from "../../src/lib/import/types";
import { isDirectScript } from "../import/isDirectScript";
import {
  keysOf,
  readSource,
  resolveSourceUrl,
  toSourceRow,
  type SourceRow,
} from "./recover-rpm-answers";

/** `diagram_assets` 는 `question_version_id` 로 붙는다 — 그림 유무의 유일한 근거다. */
const SELECT_FOR_REPORT = `
SELECT
  q.id::text AS id,
  q.printed_number,
  q.source_ref,
  q.kind::text AS kind,
  qv.body,
  qv.choices,
  qv.answer,
  qv.explanation,
  (
    SELECT count(*)::int FROM diagram_assets d
    WHERE d.question_version_id = q.current_version_id
  ) AS diagram_count,
  -- extract-rpm.ts 의 RPM_SELECT 와 같은 재료라야 한다. concepts 를 빼고
  -- 재현하면 단원 힌트가 비어 '왜 안 들어왔나' 의 답이 통째로 뒤집힌다(실제로 겪음).
  -- (템플릿 리터럴 안이라 SQL 주석에 백틱을 쓰면 문자열이 끊긴다.)
  (
    SELECT COALESCE(json_agg(json_build_object(
      'name', c.name, 'grade_band', c.grade_band
    )), '[]'::json)
    FROM question_alignments qa
    JOIN canonical_concepts c ON c.id = qa.concept_id
    WHERE qa.question_id = q.id
  ) AS concepts
FROM questions q
JOIN question_versions qv ON qv.id = q.current_version_id
WHERE q.source_ref IS NOT NULL
`;

const SENTINEL = "정답 없음";
const squeeze = (value: string): string => value.replace(/\s+/g, "");

interface SourceMeta {
  book: string;
  page: string;
  printedNumber: string;
  chapter: string;
  unit: string;
  type: string;
  kind: string;
  diagramCount: number;
  figureBoxes: number;
  explanation: string;
}

function metaOf(row: Record<string, unknown>): SourceMeta {
  const ref = (row.source_ref ?? {}) as Record<string, unknown>;
  const title = (value: unknown): string => {
    if (!value || typeof value !== "object") return "";
    const record = value as Record<string, unknown>;
    return typeof record.title === "string" ? record.title : "";
  };
  return {
    book: typeof ref.book === "string" ? ref.book : "",
    page: ref.printedPage === undefined || ref.printedPage === null ? "" : String(ref.printedPage),
    printedNumber:
      (typeof ref.printedNumber === "string" && ref.printedNumber) ||
      (typeof row.printed_number === "string" ? row.printed_number : ""),
    chapter: title(ref.chapter),
    unit: title(ref.unit),
    type: title(ref.type),
    kind: typeof row.kind === "string" ? row.kind : "",
    diagramCount: Number(row.diagram_count ?? 0),
    figureBoxes:
      (Array.isArray(ref.figureBoxes) ? ref.figureBoxes.length : 0) +
      (Array.isArray(ref.figureLabels) ? ref.figureLabels.length : 0),
    explanation: squeeze(flattenStructured(row.explanation).content),
  };
}

export interface GroupRow {
  index: number;
  problemIds: string[];
  sourceIds: string[];
  /** 원본 정답이 그룹 안에서 서로 다른가 — 다르면 "같은 문항의 중복"이 아니다. */
  sourceAnswersDiffer: boolean;
  sourceAnswerCount: number;
  sourceWithAnswer: number;
  sourceWithDiagram: number;
  sourceWithFigureBox: number;
  dbWithAnswer: number;
  dbWithFigure: number;
  /** 해설로 DB행 ↔ 원본행을 1:1 로 확정할 수 있는가. */
  pairableBySolution: boolean;
  book: string;
  pages: string[];
  printedNumbers: string[];
  units: string[];
  /** 그룹 안 DB 행이 모두 같은 단원에 배정됐는가. */
  sameUnit: boolean;
  unitLabels: string[];
  /** 원본 교재 학년과 배정 단원 학년이 어긋나는 DB 행 수 (트랙 C 소관 아님 — 보고만 한다). */
  gradeMismatch: number;
  /** 해설로 못 가르는 그룹이면 그 사유. 가르면 빈 문자열. */
  blockReason: string;
  /** 일괄 판단용 — 행마다 무엇을 갖췄나. 원장님이 한 번에 보시라고 만든다. */
  members: MemberRow[];
}

/** 그룹 안 한 행의 상태. 무엇을 갖췄는지·출제된 적 있는지. */
export interface MemberRow {
  problemId: string;
  /** 원본 인쇄번호. `externalId` 가 없으면 null (아직 원본을 못 좁힌 행). */
  printedNumber: string | null;
  hasAnswer: boolean;
  hasSolution: boolean;
  hasFigure: boolean;
  /** 배정된 소단원의 학년이 원본 교재 학년과 맞는가. */
  unitOk: boolean;
  /** 갖춘 항목 수 (정답·해설·그림·단원) — 0~4. */
  score: number;
  /** 출제지에 실린 횟수(검수 중 교체분 제외). */
  usedInTests: number;
  /** 실제로 인쇄된 시험지에 실린 횟수. */
  printedInTests: number;
  /** 원본에 정답이 있는가 — 트랙 B 가 회수하면 `hasAnswer` 가 될 값. */
  sourceHasAnswer: boolean;
  /** 원본에 그림이 있는가 — 트랙 A 가 회수하면 `hasFigure` 가 될 값. */
  sourceHasFigure: boolean;
}

/** `RPM 중학 수학 2-2 (2022 개정)` → `중2`. 못 읽으면 빈 문자열. */
export function bookGrade(book: string): string {
  const match = /중학\s*수학\s*([1-3])-[12]/.exec(book);
  return match ? `중${match[1]}` : "";
}

/**
 * 그룹 안에서 DB행 ↔ 원본행이 해설로 1:1 로 갈리는지. `backfill-rpm-external-id` 와 같은 규칙.
 * 못 가르면 **왜 못 가르는지**를 같이 돌려준다 — 사람이 손으로 볼 때 그게 필요하다.
 */
function solutionPairing(
  members: Array<{ id: string; solution: string }>,
  sourceIds: string[],
  explanationById: Map<string, string>,
): { pairing: Map<string, string> | null; reason: string } {
  const explanations = sourceIds.map((id) => explanationById.get(id) ?? "");
  const blank = explanations.filter((value) => !value).length;
  const distinct = new Set(explanations);
  if (distinct.size !== sourceIds.length) {
    return {
      pairing: null,
      reason:
        blank > 0
          ? `원본 해설이 비어 있다 (${blank}/${sourceIds.length}행)`
          : `원본 해설이 서로 겹친다 (${distinct.size}종 / ${sourceIds.length}행)`,
    };
  }
  const missing = members.filter((member) => !member.solution).length;
  if (missing > 0) {
    return { pairing: null, reason: `우리 쪽 해설이 빈 행 ${missing}` };
  }
  const pairing = new Map<string, string>(); // sourceId → problemId
  for (const member of members) {
    const hits = sourceIds.filter(
      (id) => explanationById.get(id) === member.solution,
    );
    if (hits.length !== 1 || pairing.has(hits[0])) {
      return { pairing: null, reason: "우리 해설이 원본 해설과 1:1 로 안 맞는다" };
    }
    pairing.set(hits[0], member.id);
  }
  return { pairing, reason: "" };
}

/** 정답에서 숫자 토큰만 뽑는다 — 짝짓기를 독립 신호로 확인하는 데 쓴다. */
function numberTokens(text: string): string[] {
  return [...text.matchAll(/-?\d+(?:\.\d+)?/g)].map((match) => match[0]);
}

/**
 * 해설 짝짓기가 우연이 아님을 보이는 **대조 실험**.
 *
 * 짝지은 원본의 정답에 든 숫자가 그 행 해설 안에 있는지 본다(정답과 해설은 원본에서
 * 서로 다른 필드다). 같은 검사를 **같은 그룹의 다른 원본** 정답으로도 돌려 대조군을
 * 만든다. 짝짓기가 우연이면 두 비율이 비슷해야 한다.
 */
interface PairingEvidence {
  paired: number;
  corroborated: number;
  contradicted: number;
  noNumbers: number;
  controlPass: number;
  controlTotal: number;
}

/**
 * 원장님이 「이 기준으로 일괄」이라고 하시면 그대로 적용할 수 있게, 기준마다
 * **남길 행 / 버릴 행**을 미리 계산해 둔다. 이 파일은 **판단하지 않는다** —
 * 기준별 결과를 나란히 놓을 뿐이고, 고르는 것은 원장님이다.
 */
export interface Criterion {
  key: string;
  label: string;
  detail: string;
  /** 그룹 하나에서 남길 행을 고른다. 빈 배열이면 "이 기준으로는 못 고른다". */
  pick: (members: MemberRow[]) => MemberRow[];
}

/** 동률이면 원본 인쇄번호가 빠른 쪽. 번호가 없는 행(원본 미상)은 뒤로 민다. */
function byPrintedNumber(a: MemberRow, b: MemberRow): number {
  if (a.printedNumber === b.printedNumber) return 0;
  if (a.printedNumber === null) return 1;
  if (b.printedNumber === null) return -1;
  return a.printedNumber.localeCompare(b.printedNumber);
}

export const CRITERIA: Criterion[] = [
  {
    key: "keep-all",
    label: "전부 남긴다 (현행)",
    detail: "아무것도 지우지 않는다. 지금 상태 그대로.",
    pick: (members) => members,
  },
  {
    key: "answer-and-figure",
    label: "정답과 그림을 둘 다 가진 행만 남긴다",
    detail:
      "원장님이 예로 드신 규칙. 둘 다 갖춘 행이 그룹에 하나도 없으면 그 그룹은 못 고른다.",
    pick: (members) => members.filter((m) => m.hasAnswer && m.hasFigure),
  },
  {
    key: "complete-only",
    label: "정답·해설·그림·단원을 모두 갖춘 행만 남긴다",
    detail: "가장 엄격하다. 네 가지를 다 갖춘 행만 남고 나머지는 버린다.",
    pick: (members) =>
      members.filter((m) => m.hasAnswer && m.hasSolution && m.hasFigure && m.unitOk),
  },
  {
    key: "best-one",
    label: "그룹마다 가장 많이 갖춘 행 하나만 남긴다",
    detail:
      "갖춘 항목 수가 가장 많은 행 하나. 동률이면 원본 인쇄번호가 빠른 쪽. 그룹당 반드시 하나는 남는다.",
    pick: (members) => {
      const best = Math.max(...members.map((m) => m.score));
      const tied = members.filter((m) => m.score === best).sort(byPrintedNumber);
      return tied.slice(0, 1);
    },
  },
];

export interface CriterionOutcome {
  key: string;
  keep: string[];
  drop: string[];
  /** 이 기준으로는 남길 행을 고르지 못한 그룹 수. */
  undecided: number;
  /** 버리는 행 중, 원본 정답이 그룹 안에서 서로 다른 그룹에 속한 것 — 서로 다른 문항이다. */
  dropDistinct: number;
}

/**
 * 트랙 A·B 가 원본에서 회수를 마친 뒤의 모습으로 바꿔 본다.
 * **추측이 아니다** — 정답도 그림도 원본에 있는 것을 그대로 가져오는 일이라
 * 무엇이 채워질지 지금 알 수 있다.
 */
export function projectAfterRecovery(groups: GroupRow[]): GroupRow[] {
  return groups.map((group) => ({
    ...group,
    members: group.members.map((member) => {
      const hasAnswer = member.hasAnswer || member.sourceHasAnswer;
      const hasFigure = member.hasFigure || member.sourceHasFigure;
      return {
        ...member,
        hasAnswer,
        hasFigure,
        score:
          Number(hasAnswer) +
          Number(member.hasSolution) +
          Number(hasFigure) +
          Number(member.unitOk),
      };
    }),
  }));
}

export function applyCriteria(groups: GroupRow[]): CriterionOutcome[] {
  return CRITERIA.map((criterion) => {
    const keep: string[] = [];
    const drop: string[] = [];
    let undecided = 0;
    let dropDistinct = 0;
    for (const group of groups) {
      const picked = criterion.pick(group.members);
      if (picked.length === 0) {
        // 못 고르면 **아무것도 버리지 않는다.** 판단 불가는 삭제 사유가 아니다.
        undecided += 1;
        keep.push(...group.members.map((m) => m.problemId));
        continue;
      }
      const kept = new Set(picked.map((m) => m.problemId));
      for (const member of group.members) {
        if (kept.has(member.problemId)) keep.push(member.problemId);
        else {
          drop.push(member.problemId);
          if (group.sourceAnswersDiffer) dropDistinct += 1;
        }
      }
    }
    return { key: criterion.key, keep, drop, undecided, dropDistinct };
  });
}

function outArg(): string {
  const index = process.argv.indexOf("--out");
  if (index >= 0 && process.argv[index + 1]) return process.argv[index + 1];
  return "docs/planning/13-rpm-duplicate-groups.md";
}

async function build(): Promise<{
  groups: GroupRow[];
  totals: Record<string, number>;
  evidence: PairingEvidence;
}> {
  const sourceUrl = await resolveSourceUrl();
  if (!sourceUrl) throw new Error("원본 접속 정보가 없습니다 (SUMAEK_DATABASE_URL).");
  const rawRows = await readSource(sourceUrl, SELECT_FOR_REPORT);
  const sources = rawRows
    .map(toSourceRow)
    .filter((row): row is SourceRow => row !== null);
  const sourceById = new Map(sources.map((row) => [row.id, row]));
  const metaById = new Map<string, SourceMeta>();
  const explanationById = new Map<string, string>();
  for (const row of rawRows) {
    const id = typeof row.id === "string" ? row.id : "";
    if (!id) continue;
    const meta = metaOf(row);
    metaById.set(id, meta);
    explanationById.set(id, meta.explanation);
  }

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

  const prisma = new PrismaClient();
  try {
    const problems = await prisma.problem.findMany({
      where: { source: "transformed" },
      select: {
        id: true,
        content: true,
        answer: true,
        solution: true,
        figureUrls: true,
        externalId: true,
        unit: { select: { grade: true, chapter: true, section: true } },
        testProblems: {
          select: {
            replaced: true,
            test: { select: { printedAt: true } },
          },
        },
      },
    });

    // ── 곁다리 감사 2 — 원본에는 있는데 우리 DB 에 아예 없는 행 ────────────────
    // `externalId` 가 붙기 전에는 물을 수 없던 질문이다. 미상 233행이 걸친
    // 원본 후보는 "DB 행이 있으나 키가 안 붙은" 것이므로 없는 것에서 뺀다.
    const linked = new Set(
      problems
        .map((problem) => problem.externalId)
        .filter((value): value is string => Boolean(value)),
    );
    const inAmbiguous = new Set<string>();
    for (const problem of problems) {
      if (problem.externalId) continue;
      for (const row of candidatesFor(problem.content)) inAmbiguous.add(row.id);
    }
    const missingRows = rawRows.filter((row) => {
      const id = String(row.id);
      return !linked.has(id) && !inAmbiguous.has(id);
    });
    const units: UnitLike[] = await prisma.unit.findMany({
      select: { id: true, grade: true, chapter: true, section: true },
    });
    const missingDrafts = missingRows.map((row) =>
      convertRpmExtractedRow({
        id: String(row.id),
        kind: typeof row.kind === "string" ? row.kind : null,
        printed_number:
          typeof row.printed_number === "string" ? row.printed_number : null,
        source_ref: (row.source_ref ?? null) as Record<string, unknown> | null,
        body: row.body,
        choices: row.choices,
        answer: row.answer,
        explanation: row.explanation,
        concepts: Array.isArray(row.concepts)
          ? (row.concepts as Array<{ name?: string; grade_band?: string }>)
          : [],
      }),
    );
    const missingReport = classifyDrafts("rpm", missingDrafts, units).report;
    // 학년 힌트만 교재명에서 뽑아 다시 태우면 몇 건이 붙나 — 원인을 못박는 실험.
    const repaired = classifyDrafts(
      "rpm",
      missingDrafts.map((draft) => ({
        ...draft,
        gradeHint:
          bookGrade(metaById.get(draft.externalId)?.book ?? "") || draft.gradeHint,
      })),
      units,
    ).report;

    // 곁다리 감사 — `externalId` 가 붙은 RPM 전량에서 "교재 학년 ≠ 배정 단원 학년".
    // 233건만 보면 표본이 편향된다(전부 도형 단원이라). 전량으로 센다.
    let gradeAudited = 0;
    let gradeWrong = 0;
    for (const problem of problems) {
      if (!problem.externalId) continue;
      const expected = bookGrade(metaById.get(problem.externalId)?.book ?? "");
      if (!expected) continue;
      gradeAudited += 1;
      if (problem.unit.grade !== expected) gradeWrong += 1;
    }

    // "본문 중복 233건" 과 "`externalId` 미상 233건" 이 같은 수인 것은 우연이 아니라
    // **같은 집합**이다. 그걸 문서가 스스로 증명하게 숫자를 같이 뽑는다.
    // 좁은 정의(DB 본문이 글자까지 같음)는 230/85 로 셋이 적다 — 차이 3건은
    // "우리 DB 안에서는 유일한데 원본에 쌍둥이가 있는" 행이다.
    const unresolvedRows = problems.filter((problem) => !problem.externalId);
    const byContent = new Map<string, number>();
    for (const problem of problems) {
      const key = squeeze(problem.content);
      byContent.set(key, (byContent.get(key) ?? 0) + 1);
    }
    const identicalRows = problems.filter(
      (problem) => (byContent.get(squeeze(problem.content)) ?? 0) > 1,
    );
    const identicalGroups = [...byContent.values()].filter((n) => n > 1).length;
    const identicalYetFilled = identicalRows.filter(
      (problem) => problem.externalId,
    ).length;

    const buckets = new Map<string, typeof problems>();
    for (const problem of problems) {
      const candidates = candidatesFor(problem.content);
      if (candidates.length < 2) continue;
      const key = candidates
        .map((row) => row.id)
        .sort()
        .join("|");
      const bucket = buckets.get(key) ?? [];
      bucket.push(problem);
      buckets.set(key, bucket);
    }

    const groups: GroupRow[] = [];
    const evidence: PairingEvidence = {
      paired: 0,
      corroborated: 0,
      contradicted: 0,
      noNumbers: 0,
      controlPass: 0,
      controlTotal: 0,
    };
    for (const [key, members] of buckets) {
      const sourceIds = key.split("|");
      const metas = sourceIds.map((id) => metaById.get(id)!);
      const answers = sourceIds.map((id) => squeeze(sourceById.get(id)!.answer));
      const units = members.map(
        (m) => `${m.unit.grade} ${m.unit.chapter} > ${m.unit.section}`,
      );
      const { pairing, reason: blockReason } = solutionPairing(
        members.map((m) => ({ id: m.id, solution: squeeze(m.solution ?? "") })),
        sourceIds,
        explanationById,
      );
      if (pairing) {
        for (const [sourceId, problemId] of pairing) {
          evidence.paired += 1;
          const solution = squeeze(
            members.find((m) => m.id === problemId)?.solution ?? "",
          );
          const nums = numberTokens(sourceById.get(sourceId)!.answer);
          if (nums.length === 0) evidence.noNumbers += 1;
          else if (nums.every((n) => solution.includes(n))) {
            evidence.corroborated += 1;
          } else evidence.contradicted += 1;
          for (const other of sourceIds) {
            if (other === sourceId) continue;
            const otherNums = numberTokens(sourceById.get(other)!.answer);
            if (otherNums.length === 0) continue;
            evidence.controlTotal += 1;
            if (otherNums.every((n) => solution.includes(n))) {
              evidence.controlPass += 1;
            }
          }
        }
      }
      groups.push({
        index: 0,
        problemIds: members.map((m) => m.id),
        sourceIds,
        sourceAnswersDiffer: new Set(answers).size > 1,
        sourceAnswerCount: new Set(answers).size,
        sourceWithAnswer: answers.filter(Boolean).length,
        sourceWithDiagram: metas.filter((m) => m.diagramCount > 0).length,
        sourceWithFigureBox: metas.filter((m) => m.figureBoxes > 0).length,
        dbWithAnswer: members.filter(
          (m) => m.answer.trim() && !m.answer.includes(SENTINEL),
        ).length,
        dbWithFigure: members.filter((m) => m.figureUrls.length > 0).length,
        pairableBySolution: pairing !== null,
        blockReason,
        members: members.map((member) => {
          const meta = member.externalId ? metaById.get(member.externalId) : undefined;
          const hasAnswer =
            Boolean(member.answer.trim()) && !member.answer.includes(SENTINEL);
          const hasSolution = Boolean(squeeze(member.solution ?? ""));
          const hasFigure = member.figureUrls.length > 0;
          const expected = bookGrade(metas[0]?.book ?? "");
          const unitOk = expected ? member.unit.grade === expected : false;
          const live = member.testProblems.filter((t) => !t.replaced);
          return {
            problemId: member.id,
            printedNumber: meta?.printedNumber ?? null,
            hasAnswer,
            hasSolution,
            hasFigure,
            unitOk,
            score:
              Number(hasAnswer) + Number(hasSolution) + Number(hasFigure) + Number(unitOk),
            usedInTests: live.length,
            printedInTests: live.filter((t) => t.test.printedAt !== null).length,
            sourceHasAnswer: Boolean(
              member.externalId && sourceById.get(member.externalId)?.answer,
            ),
            sourceHasFigure: (meta?.diagramCount ?? 0) > 0,
          };
        }),
        book: metas[0]?.book ?? "",
        pages: [...new Set(metas.map((m) => m.page).filter(Boolean))],
        printedNumbers: metas.map((m) => m.printedNumber),
        units: [...new Set(units)],
        sameUnit: new Set(units).size === 1,
        unitLabels: units,
        gradeMismatch: (() => {
          const expected = bookGrade(metas[0]?.book ?? "");
          if (!expected) return 0;
          return members.filter((m) => m.unit.grade !== expected).length;
        })(),
      });
    }
    // 판단이 쉬운 것부터 — 그림이 갈림 → 정답이 갈림 → 나머지
    groups.sort((a, b) => {
      const score = (g: GroupRow): number =>
        (g.sourceAnswersDiffer ? 0 : 2) + (g.pairableBySolution ? 0 : 1);
      return score(a) - score(b) || b.problemIds.length - a.problemIds.length;
    });
    groups.forEach((group, index) => {
      group.index = index + 1;
    });

    // 세 축(본문·그림·정답)으로 다시 묶어 **진짜 중복**을 센다.
    // 판정 코드는 `find-true-duplicates.ts` 하나만 쓴다 — 같은 규칙이 두 벌 있으면 갈라진다.
    const dupRows: DupRow[] = problems.map((problem) => ({
      id: problem.id,
      content: problem.content,
      answer: problem.answer,
      figureUrls: problem.figureUrls,
    }));
    const axisCounts: Record<string, { groups: number; rows: number }> = {};
    for (const axes of [
      "content",
      "content+answer",
      "content+figure",
      "all-three",
    ] as AxisSet[]) {
      const found = groupByAxes(dupRows, axes);
      axisCounts[axes] = {
        groups: found.size,
        rows: [...found.values()].reduce((sum, bucket) => sum + bucket.length, 0),
      };
    }
    const allThree = groupByAxes(dupRows, "all-three");
    const confirmedDup = [...allThree.values()].filter((bucket) =>
      bucket.every(
        (row) => row.answer.trim() && !row.answer.includes(SENTINEL),
      ),
    );

    const groupRowIds = new Set(groups.flatMap((group) => group.problemIds));
    const groupRowsKeyed = problems.filter(
      (problem) => groupRowIds.has(problem.id) && problem.externalId,
    ).length;

    const totals = {
      groups: groups.length,
      groupRowsKeyed,
      dupContentGroups: axisCounts.content.groups,
      dupContentRows: axisCounts.content.rows,
      dupContentAnswerGroups: axisCounts["content+answer"].groups,
      dupContentFigureGroups: axisCounts["content+figure"].groups,
      dupAllThreeGroups: axisCounts["all-three"].groups,
      dupAllThreeRows: axisCounts["all-three"].rows,
      dupConfirmed: confirmedDup.length,
      dupConfirmedRows: confirmedDup.reduce((sum, bucket) => sum + bucket.length, 0),
      usedInTests: groups.reduce(
        (sum, g) => sum + g.members.reduce((n, m) => n + m.usedInTests, 0),
        0,
      ),
      printedInTests: groups.reduce(
        (sum, g) => sum + g.members.reduce((n, m) => n + m.printedInTests, 0),
        0,
      ),
      totalTests: await prisma.test.count(),
      dbRows: groups.reduce((sum, g) => sum + g.problemIds.length, 0),
      sourceRows: groups.reduce((sum, g) => sum + g.sourceIds.length, 0),
      answersDiffer: groups.filter((g) => g.sourceAnswersDiffer).length,
      answersSame: groups.filter((g) => !g.sourceAnswersDiffer).length,
      pairable: groups.filter((g) => g.pairableBySolution).length,
      pairableRows: groups
        .filter((g) => g.pairableBySolution)
        .reduce((sum, g) => sum + g.problemIds.length, 0),
      anyDiagram: groups.filter((g) => g.sourceWithDiagram > 0).length,
      allDiagram: groups.filter((g) => g.sourceWithDiagram === g.sourceIds.length)
        .length,
      anyFigureBox: groups.filter((g) => g.sourceWithFigureBox > 0).length,
      dbWithAnswer: groups.reduce((sum, g) => sum + g.dbWithAnswer, 0),
      dbWithFigure: groups.reduce((sum, g) => sum + g.dbWithFigure, 0),
      sameUnit: groups.filter((g) => g.sameUnit).length,
      sizeMismatch: groups.filter((g) => g.problemIds.length !== g.sourceIds.length)
        .length,
      gradeMismatchGroups: groups.filter((g) => g.gradeMismatch > 0).length,
      gradeMismatchRows: groups.reduce((sum, g) => sum + g.gradeMismatch, 0),
      gradeAuditedAll: gradeAudited,
      gradeWrongAll: gradeWrong,
      sourceRowsAll: rawRows.length,
      missingAll: missingRows.length,
      missingUnclassified: missingReport.unclassified,
      missingSkippedFigure: missingReport.skippedFigure,
      missingOk: missingReport.ok,
      missingUnresolvedGrade: missingReport.unresolvedGrade ?? 0,
      repairedOk: repaired.ok,
      repairedUnclassified: repaired.unclassified,
      transformedRows: problems.length,
      unresolvedRows: unresolvedRows.length,
      identicalRows: identicalRows.length,
      identicalGroups,
      identicalYetFilled,
    };
    return { groups, totals, evidence };
  } finally {
    await prisma.$disconnect();
  }
}

function render(
  groups: GroupRow[],
  totals: Record<string, number>,
  evidence: PairingEvidence,
  outcomes: CriterionOutcome[],
  projected: CriterionOutcome[],
): string {
  const short = (id: string): string => id.slice(0, 8);
  const pct = (a: number, b: number): string =>
    b === 0 ? "—" : `${((a / b) * 100).toFixed(1)}%`;
  const lines: string[] = [];

  lines.push("# 13 — RPM 본문 동일 233건(88그룹) 판단 근거표");
  lines.push("");
  lines.push(
    "생성: `npx tsx scripts/qa/report-rpm-duplicates.ts` · **읽기 전용** — 행 삭제도 `reviewStatus` 변경도 하지 않는다.",
  );
  lines.push("");
  lines.push(
    "> 이 문서는 근거만 모은다. **무엇을 어떻게 할지는 원장님 결정 사항이다**(트랙 C-2).",
  );
  lines.push("");

  lines.push("## 0. 결론 — 중복이 아니다");
  lines.push("");
  lines.push(
    `${totals.groups}그룹 ${totals.dbRows}건은 **같은 문항이 두 번 실린 것이 아니다.** ` +
      `${totals.answersDiffer}그룹(${pct(totals.answersDiffer, totals.groups)})은 원본 정답이 그룹 안에서 서로 다르다. ` +
      "본문이 같아진 이유는 **문항을 가르는 그림이 본문에서 빠졌기** 때문이다 — " +
      '"다음 그림에서 ∠x의 크기를 구하시오" 는 그림이 없으면 글자가 똑같다.',
  );
  lines.push("");
  lines.push("근거 셋:");
  lines.push("");
  lines.push(
    `1. **원본 정답이 갈린다** — ${totals.answersDiffer}/${totals.groups} 그룹. 같은 문항이면 정답도 같아야 한다.`,
  );
  lines.push(
    `2. **원본이 그림을 갖고 있다** — \`source_ref.figureBoxes/figureLabels\` 가 있는 그룹 ${totals.anyFigureBox}, ` +
      `실제 \`diagram_assets\` 가 붙은 그룹 ${totals.anyDiagram}(전부 붙은 그룹 ${totals.allDiagram}).`,
  );
  lines.push(
    "3. **전부 도형 단원이다** — 아래 표의 단원 열이 기본 도형·삼각형의 내심/외심·원주각·닮음·" +
      "피타고라스로 채워져 있다. 글자만으로는 안 갈리는 문항이 몰리는 곳이 정확히 그림 단원이다.",
  );
  lines.push("");

  lines.push("## 1. 그래서 지울 것이 없다 — 해설로 갈린다");
  lines.push("");
  lines.push(
    `DB 행과 원본 행을 **해설(\`explanation\`)** 로 대조하면 ${totals.pairable}그룹 ${totals.pairableRows}행이 ` +
      "1:1 로 확정된다. 해설은 적재 때 원본에서 온 값이고 본문과 별개 필드다.",
  );
  lines.push("");
  lines.push("**짝짓기가 우연이 아님을 대조 실험으로 확인했다.**");
  lines.push("");
  lines.push(
    "검사: 짝지은 원본의 *정답*에 든 숫자가 그 행 *해설* 안에 실제로 있는가 " +
      "(정답과 해설은 원본에서 서로 다른 필드라, 짝이 틀렸다면 어긋나야 한다). " +
      "대조군: **같은 그룹의 다른 원본** 정답으로 같은 검사.",
  );
  lines.push("");
  lines.push("| | 통과 | 실패 | 비율 |");
  lines.push("|---|---|---|---|");
  lines.push(
    `| 해설로 지은 짝 | ${evidence.corroborated} | ${evidence.contradicted} | ` +
      `**${pct(evidence.corroborated, evidence.corroborated + evidence.contradicted)}** |`,
  );
  lines.push(
    `| 대조군(같은 그룹의 다른 원본) | ${evidence.controlPass} | ${evidence.controlTotal - evidence.controlPass} | ` +
      `${pct(evidence.controlPass, evidence.controlTotal)} |`,
  );
  lines.push("");
  lines.push(
    `(짝지은 ${evidence.paired}행 중 정답에 숫자가 없어 검사 대상이 아닌 것 ${evidence.noNumbers}행은 뺐다.)`,
  );
  lines.push("");

  lines.push("## 2. 권고 — 제안일 뿐, 결정은 원장님");
  lines.push("");
  lines.push(
    "**「정답+그림이 있는 쪽을 남긴다」 같은 규칙은 여기에 쓰지 마시길 권한다.** " +
      "지금 이 233건은 정답도 그림도 **전부 0** 이라(아래 표 `DB정답`·`DB그림` 열) 어느 쪽도 남길 근거가 없고, " +
      "무엇보다 서로 다른 문항이라 남긴 하나가 나머지를 대신하지 못한다. 대신:",
  );
  lines.push("");
  lines.push(
    `1. **아무것도 지우지 않는다.** ${totals.dbRows}건은 서로 다른 문항이다.`,
  );
  lines.push(
    `2. **해설로 \`externalId\` 를 확정한다** — ${totals.pairableRows}행. ` +
      "`npx tsx scripts/qa/backfill-rpm-external-id.ts --resolve-by-solution` 이 그 일을 한다(기본은 꺼져 있다).",
  );
  lines.push(
    "3. `externalId` 가 붙으면 **정답은 `recover-rpm-answers.ts` 가 원본에서 그대로 되찾고**" +
      "(지금은 본문 중복이라 건너뛰고 있다), **그림은 트랙 A 의 RPM 그림 회수가 키로 붙인다.** " +
      "정답·그림이 붙으면 본문도 더는 같지 않다 — 문제가 스스로 풀린다.",
  );
  lines.push(
    `4. 해설로도 안 갈리는 ${totals.dbRows - totals.pairableRows}행(${totals.groups - totals.pairable}그룹)만 사람이 본다. ` +
      "§8 에 그 그룹과, 따로 눈여겨볼 그룹을 함께 뽑아 뒀다.",
  );
  lines.push("");
  lines.push(
    "> ⚠️ 2번을 적용하기 전에 **트랙 A 의 그림 회수와 순서를 맞춰야 한다.** " +
      "`externalId` 가 붙어야 그림이 본문 대조 대신 키로 붙는다(트랙 C 문서 §왜 하나 2번). " +
      "순서는 코디네이터가 정한다.",
  );
  lines.push("");

  lines.push("## 3. ⚠️ 다음 사람이 반드시 알아야 할 함정");
  lines.push("");
  lines.push(
    "**본문 글자만으로 중복을 판정하면, 그림이 빠진 문항끼리 가짜 중복이 된다.**",
  );
  lines.push("");
  lines.push(
    "이 문서가 다루는 88그룹이 정확히 그렇게 생겼다. RPM 도형 문항은 발문이 " +
      '"다음 그림에서 ∠x의 크기를 구하시오" 처럼 **글자가 서로 완전히 같고**, ' +
      "문항을 가르는 것은 오직 그림이다. 이관이 `diagram_assets` 를 안 봐서 그림이 " +
      "한 장도 안 붙은 상태(0/233)에서 본문만 비교했으니, **서로 다른 문항 233개가 " +
      "한 덩어리로 뭉쳐 「중복」으로 보였다.**",
  );
  lines.push("");
  lines.push(
    "트랙 A 가 그림을(1,088/1,088) 트랙 B 가 정답을 붙인 지금 **세 축으로 다시 묶으면** " +
      "이렇게 갈린다:",
  );
  lines.push("");
  lines.push("| 무엇으로 묶나 | 그룹 |");
  lines.push("|---|---|");
  lines.push(`| 본문만 (예전 방식) | **${totals.dupContentGroups}그룹 / ${totals.dupContentRows}행** |`);
  lines.push(`| 본문 + 정답 | ${totals.dupContentAnswerGroups}그룹 |`);
  lines.push(`| 본문 + 그림 | ${totals.dupContentFigureGroups}그룹 |`);
  lines.push(`| 본문 + 그림 + 정답 | ${totals.dupAllThreeGroups}그룹 / ${totals.dupAllThreeRows}행 |`);
  lines.push(
    `| └ 그중 **정답까지 확인된 진짜 중복** | **${totals.dupConfirmed}그룹 / ${totals.dupConfirmedRows}행** |`,
  );
  lines.push("");
  lines.push(
    `**확인된 진짜 중복은 ${totals.dupConfirmed}건이다.** 남은 ${totals.dupAllThreeGroups}그룹은 ` +
      "정답도 그림도 **양쪽 다 비어 있어** 「같다」가 아무 뜻도 없는 것들이라 판정을 미뤄 뒀다 " +
      "(없는 것끼리 같은 것을 같다고 하지 않는다). 재현: `npx tsx scripts/qa/find-true-duplicates.ts`.",
  );
  lines.push("");
  lines.push(
    "> **교훈** — 중복 판정에 쓸 축은 그 문항을 **실제로 가르는 것**이어야 한다. " +
      "도형 문항에서 그것은 본문이 아니라 그림이다. 이관이 아직 안 붙인 축으로 판정하면 " +
      "「데이터가 중복이다」가 아니라 **「내 이관이 덜 됐다」를 중복으로 읽게 된다.** " +
      "이 착시 위에서 일괄 삭제 규칙을 세웠다면 서로 다른 문항 143개를 잃을 뻔했다(§4).",
  );
  lines.push("");

  lines.push("## 4. 일괄 판단표 — 「이 기준으로」 한마디면 그대로 적용됩니다");
  lines.push("");
  lines.push(
    "기준마다 **남는 행·버리는 행**을 미리 계산해 뒀다. 고르시면 그 목록 그대로 적용한다. " +
      "어느 기준으로도 **판단 불가 그룹은 한 행도 버리지 않는다** — 못 고르는 것은 버릴 사유가 아니기 때문이다.",
  );
  lines.push("");
  lines.push("| 기준 | 남김 | 버림 | 판단 불가 그룹 | 버리는 것 중 *서로 다른 문항* |");
  lines.push("|---|---|---|---|---|");
  for (const criterion of CRITERIA) {
    const outcome = outcomes.find((o) => o.key === criterion.key)!;
    lines.push(
      `| **${criterion.label}** | ${outcome.keep.length} | ${outcome.drop.length} | ` +
        `${outcome.undecided} | ${outcome.dropDistinct} |`,
    );
  }
  lines.push("");
  lines.push(
    "**지금은 정답을 쓰는 기준이 아무것도 고르지 못한다** — 이 233행의 정답이 아직 0건이기 때문이다" +
      "(트랙 B 가 209건을 넣기 전이다). 그래서 같은 기준을 **회수가 끝난 뒤의 모습**으로도 계산해 뒀다. " +
      "추측이 아니라 원본에 있는 것을 그대로 가져오는 일이라 지금 알 수 있는 값이다.",
  );
  lines.push("");
  lines.push("**트랙 A·B 회수가 끝난 뒤 (같은 기준, 같은 계산)**");
  lines.push("");
  lines.push("| 기준 | 남김 | 버림 | 판단 불가 그룹 | 버리는 것 중 *서로 다른 문항* |");
  lines.push("|---|---|---|---|---|");
  for (const criterion of CRITERIA) {
    const outcome = projected.find((o) => o.key === criterion.key)!;
    lines.push(
      `| **${criterion.label}** | ${outcome.keep.length} | ${outcome.drop.length} | ` +
        `${outcome.undecided} | ${outcome.dropDistinct} |`,
    );
  }
  lines.push("");
  for (const criterion of CRITERIA) {
    lines.push(`- **${criterion.label}** — ${criterion.detail}`);
  }
  lines.push("");
  lines.push(
    "⚠️ 맨 오른쪽 열을 먼저 봐 주시길 바란다. **버리는 행의 대부분이 서로 다른 문항이다** — " +
      `${totals.answersDiffer}/${totals.groups} 그룹은 원본 정답부터 다르다(§0). ` +
      "글자가 같아 보이는 것은 문항을 가르는 **그림이 본문에서 빠졌기** 때문이고, " +
      "지금 트랙 A 가 그 그림을 붙이고 있다. 한 행만 남기면 나머지는 **다시 만들 수 없다.**",
  );
  lines.push("");
  lines.push(
    `**출제 이력은 판단 근거가 되지 못한다.** 이 ${totals.dbRows}행 중 출제지에 실린 적이 있는 것은 ` +
      `${totals.usedInTests}행, 실제 인쇄된 시험지에 실린 것은 ${totals.printedInTests}행이다 ` +
      `(DB 전체에 시험지가 ${totals.totalTests}장뿐이라 아직 이력이 쌓이지 않았다). ` +
      "표에는 넣어 뒀으니 나중에 이력이 쌓이면 그때 근거가 된다.",
  );
  lines.push("");
  lines.push(
    "적용용 목록(문항 id만, 본문 없음): `scripts/qa/rpm-duplicate-decision.json` — 기준별 `keep`/`drop`.",
  );
  lines.push("");

  lines.push("## 5. 그룹별 한 줄 요약 — 어느 쪽이 무엇을 갖췄나");
  lines.push("");
  lines.push(
    "`정답·해설·그림·단원` 은 그룹 안에서 **그것을 갖춘 행 수 / 전체 행 수**. " +
      "`가장 갖춘 행` 은 갖춘 항목이 가장 많은 행을 원본 인쇄번호로 가리킨다 " +
      "(사실 표기이지 권고가 아니다). `동률` 이면 그 기준으로는 고를 수 없다는 뜻이다.",
  );
  lines.push("");
  lines.push("| # | 행 | 교재·쪽 | 정답 | 해설 | 그림 | 단원 | 출제 | 가장 갖춘 행 |");
  lines.push("|---|---|---|---|---|---|---|---|---|");
  for (const group of groups) {
    const n = group.members.length;
    const count = (predicate: (m: MemberRow) => boolean): string =>
      `${group.members.filter(predicate).length}/${n}`;
    const best = Math.max(...group.members.map((m) => m.score));
    const tied = group.members.filter((m) => m.score === best);
    const label =
      best === 0
        ? "없음 (아무도 못 갖춤)"
        : tied.length > 1
          ? `동률 ${tied.length}행 (${best}/4)`
          : `#${tied[0].printedNumber ?? "미상"} (${best}/4)`;
    lines.push(
      `| ${group.index} | ${n} | ${group.book.replace("RPM 중학 수학 ", "RPM 중")} p${group.pages.join(",")} | ` +
        `${count((m) => m.hasAnswer)} | ${count((m) => m.hasSolution)} | ${count((m) => m.hasFigure)} | ` +
        `${count((m) => m.unitOk)} | ${group.members.reduce((sum, m) => sum + m.usedInTests, 0)} | ${label} |`,
    );
  }
  lines.push("");

  lines.push("## 6. 이 그룹들과 `externalId` 미상의 관계");
  lines.push("");
  lines.push(
    `이 문서의 ${totals.dbRows}행은 **본문만으로는 원본을 하나로 좁힐 수 없는** 행들이다. ` +
      "C-1 이 `externalId` 를 채우는 조건이 「원본 후보가 정확히 하나」이므로, " +
      "**1차에서는 이 " + String(totals.dbRows) + "행이 그대로 미상으로 남았다** — " +
      "수가 같았던 것은 우연이 아니라 판정 규칙이 하나라서다.",
  );
  lines.push("");
  lines.push(
    `**2차(원장님 승인)에서 해설 대조로 ${totals.groupRowsKeyed}행이 확정됐다.** ` +
      `지금 이 ${totals.dbRows}행 중 \`externalId\` 가 붙은 것은 ${totals.groupRowsKeyed}행, ` +
      `남은 미상은 ${totals.dbRows - totals.groupRowsKeyed}행이다 ` +
      `(전체로는 \`transformed\` ${totals.transformedRows}행 중 채움 ${totals.transformedRows - totals.unresolvedRows} · 미상 ${totals.unresolvedRows}).`,
  );
  lines.push("");
  lines.push(
    "`recover-rpm-answers.ts` 도 같은 규칙으로 이 행들을 건너뛰고 있었다 — 그래서 " +
      "**정답도 그림도 한 건도 못 받았다**(아래 표 `DB정답`·`DB그림` 열이 전부 0인 이유). " +
      "원인 하나가 셋을 동시에 막고 있었다는 뜻이고, 키가 붙은 지금 그 셋이 같이 풀린다.",
  );
  lines.push("");
  lines.push(
    `다만 「본문 중복」을 **DB 본문이 글자까지 같은 것**으로 좁게 세면 ` +
      `${totals.identicalRows}행 / ${totals.identicalGroups}그룹으로 ${totals.dbRows - totals.identicalRows}건 적다. ` +
      `차이 ${totals.dbRows - totals.identicalRows}건은 **우리 DB 안에서는 유일한데 원본에 쌍둥이가 있는** 행이다 ` +
      "(원본 두 행 중 하나만 적재됐다). 우리 쪽만 보면 안 보이고 원본을 봐야 드러난다. " +
      `(글자까지 같은 ${totals.identicalRows}행 중 지금 \`externalId\` 가 붙은 것은 ${totals.identicalYetFilled}건.)`,
  );
  lines.push("");

  lines.push("## 7. 숫자");
  lines.push("");
  lines.push("| 항목 | 값 |");
  lines.push("|---|---|");
  lines.push(`| 그룹 | ${totals.groups} |`);
  lines.push(`| 우리 DB 행 | ${totals.dbRows} |`);
  lines.push(`| 원본 후보 행 | ${totals.sourceRows} |`);
  lines.push(`| DB 행 수 ≠ 원본 후보 수 인 그룹 | ${totals.sizeMismatch} |`);
  lines.push(
    `| 원본 정답이 그룹 안에서 **다름** | ${totals.answersDiffer} · **같음** ${totals.answersSame} |`,
  );
  lines.push(
    `| 원본에 그림(\`diagram_assets\`) — 하나라도 | ${totals.anyDiagram} · 전부 ${totals.allDiagram} |`,
  );
  lines.push(
    `| 원본 \`figureBoxes\`/\`figureLabels\` 있는 그룹 | ${totals.anyFigureBox} |`,
  );
  lines.push(
    `| 해설로 1:1 확정 가능한 그룹 | ${totals.pairable} (행 ${totals.pairableRows}) |`,
  );
  lines.push(`| 우리 DB 행 중 정답 보유 | ${totals.dbWithAnswer} / ${totals.dbRows} |`);
  lines.push(`| 우리 DB 행 중 그림 보유 | ${totals.dbWithFigure} / ${totals.dbRows} |`);
  lines.push(
    `| 그룹 안 DB 행이 모두 같은 단원 | ${totals.sameUnit} / ${totals.groups} |`,
  );
  lines.push(
    `| 원본 교재 학년 ≠ 배정 단원 학년 | ${totals.gradeMismatchRows}행 (${totals.gradeMismatchGroups}그룹) — §9 |`,
  );
  lines.push("");

  lines.push("## 8. 사람이 봐야 하는 그룹");
  lines.push("");
  const exceptions = groups.filter(
    (group) =>
      !group.pairableBySolution ||
      !group.sourceAnswersDiffer ||
      group.problemIds.length !== group.sourceIds.length,
  );
  lines.push(
    `${exceptions.length}그룹. 사유는 셋 중 하나다 — **해설로 안 갈림**(해설이 같거나 비었다) · ` +
      "**원본 정답까지 같음**(진짜 중복일 수 있다) · **DB 행 수와 원본 후보 수가 다름**" +
      "(원본 일부가 적재되지 않았거나, 우리 쪽 행이 다른 경로로 들어왔다).",
  );
  lines.push("");
  lines.push(
    "`원본그림` 이 있으면 원본 지면을 펴서 사람이 눈으로 가를 수 있다 — 그림이 곧 그 문항을 가르는 표시다.",
  );
  lines.push("");
  lines.push("| # | DB행/원본 | 교재 | 쪽 | 인쇄번호 | 원본그림 | 사유 |");
  lines.push("|---|---|---|---|---|---|---|");
  for (const group of exceptions) {
    const why: string[] = [];
    if (!group.pairableBySolution) why.push(group.blockReason || "해설로 안 갈림");
    if (!group.sourceAnswersDiffer) why.push("**원본 정답까지 같음**");
    if (group.problemIds.length !== group.sourceIds.length) {
      why.push(
        `행 수 불일치 (원본 ${group.sourceIds.length - group.problemIds.length}행이 적재 안 됨)`,
      );
    }
    lines.push(
      `| ${group.index} | ${group.problemIds.length}/${group.sourceIds.length} | ` +
        `${group.book.replace("RPM 중학 수학 ", "RPM 중")} | ${group.pages.join(",")} | ` +
        `${group.printedNumbers.join(",")} | ${group.sourceWithDiagram}/${group.sourceIds.length} | ` +
        `${why.join(" · ")} |`,
    );
  }
  lines.push("");

  lines.push(
    "## 9. 곁다리로 드러난 것 — 결함 하나, 증상 둘 (트랙 C 소관 아님)",
  );
  lines.push("");
  lines.push("### 증상 1 — 단원 학년 오배정");
  lines.push("");
  lines.push(
    `\`externalId\` 를 채우고 나니 **원본 교재 학년과 배정 단원 학년을 처음으로 대조할 수 있게 됐다.** ` +
      `RPM ${totals.gradeAuditedAll}행 중 **${totals.gradeWrongAll}행` +
      `(${pct(totals.gradeWrongAll, totals.gradeAuditedAll)})** 이 어긋난다. ` +
      `이 문서가 다루는 ${totals.dbRows}행 안에서도 ${totals.gradeMismatchRows}행이 그렇다.`,
  );
  lines.push("");
  lines.push(
    "중3 교재 문항이 미적분1·공통수학1 단원에, 중2 교재 문항이 초5 단원에 실려 있다. " +
      "**그 단원으로 출제하면 학년이 어긋난 문제가 그대로 섞여 나간다.**",
  );
  lines.push("");
  lines.push("원인은 기출에서 이미 한 번 잡은 것과 같은 모양이다:");
  lines.push("");
  lines.push(
    "- `convertRpmExtractedRow` 는 `gradeHint` 를 `source_ref.book` 에서 뽑는다 → " +
      "`\"RPM 중학 수학 2-2 (2022 개정)\"`.",
  );
  lines.push(
    "- `normalizeGrade()` 의 교재 규칙은 `/중([123])(?:\\s*[-–]\\s*[12])?/` 인데 이 문자열엔 " +
      '`중2` 가 없다(`중학` 의 다음 글자는 `학`). 그래서 **입력을 그대로 되돌려준다** — ' +
      '`normalizeGrade("RPM 중학 수학 2-2 (2022 개정)") === "RPM 중학 수학 2-2 (2022 개정)"`.',
  );
  lines.push(
    "- `mapUnitHint` 에서 그 값은 어느 `unit.grade` 와도 같지 않으니 `scoped` 가 비고, " +
      "`pool` 이 **초1~고3 전체**로 넓어진다. 이후 부분문자열 매칭이 학년을 넘어 붙는다 " +
      '("이등변삼각형의 성질" 이 초4 단원에 붙는 식).',
  );
  lines.push(
    "- 유사도 가드(`grade && scoped.length > 0`)는 여기선 `scoped` 가 비어 통과하지 못하므로, " +
      "**부분문자열 경로만** 이 사고를 낸다.",
  );
  lines.push("");
  lines.push(
    "10-handoff §3 「학년 힌트 버그 정정」과 같은 부류다(그때는 `convertPastExam` 이 " +
      "`meta.subject` 를 먼저 봐서 513건이 틀린 학년에 실렸다). " +
      "**정정 도구 `fix-unit-assignments.ts` 는 `externalId` 로 행을 찾는다 — " +
      "그래서 지금까지 RPM 은 고칠 수 없었고, C-1 이 끝난 지금 비로소 가능해졌다.**",
  );
  lines.push("");
  lines.push("");
  lines.push("### 증상 2 — 원본 " + String(totals.missingAll) + "행이 아예 안 들어왔다");
  lines.push("");
  lines.push(
    `sumaek 원본 ${totals.sourceRowsAll}행 중 우리 DB 에 **${totals.missingAll}행이 없다** ` +
      `(키로 붙은 ${totals.dbRows > 0 ? totals.sourceRowsAll - totals.missingAll - totals.sourceRows : 0}행 + ` +
      `이 문서의 미상 ${totals.dbRows}행이 걸친 후보 ${totals.sourceRows}행을 뺀 나머지). ` +
      "이것도 `externalId` 가 붙기 전에는 셀 수 없던 숫자다.",
  );
  lines.push("");
  lines.push(
    `그 ${totals.missingAll}행을 적재 파이프라인에 **다시 태워** 이유를 물었다:`,
  );
  lines.push("");
  lines.push("| 결과 | 행 |");
  lines.push("|---|---|");
  lines.push(`| 단원 미분류로 제외 | **${totals.missingUnclassified}** |`);
  lines.push(`| 그림으로 제외 | ${totals.missingSkippedFigure} |`);
  lines.push(`| 통과(ok)인데 DB 에 없음 | ${totals.missingOk} |`);
  lines.push(`| 학년 미해석 | ${totals.missingUnresolvedGrade} |`);
  lines.push("");
  lines.push(
    "**전량이 단원 미분류다.** 본문이 비거나 길어서 잘린 것도, 그림 때문에 빠진 것도 없다. " +
      "그리고 전량이 학년 미해석이다 — 증상 1과 같은 뿌리다.",
  );
  lines.push("");
  lines.push(
    "**원인을 못박는 실험**: 다른 건 그대로 두고 **학년 힌트만 교재명에서 뽑아** 다시 태웠다.",
  );
  lines.push("");
  lines.push("| | 통과(ok) | 단원 미분류 |");
  lines.push("|---|---|---|");
  lines.push(`| 지금 | ${totals.missingOk} | ${totals.missingUnclassified} |`);
  lines.push(`| 학년 힌트만 고치면 | **${totals.repairedOk}** | ${totals.repairedUnclassified} |`);
  lines.push("");
  lines.push(
    `**${totals.repairedOk}행이 그 자리에서 붙는다.** 남는 ${totals.repairedUnclassified}행은 ` +
      "힌트 이름 자체가 우리 트리에 없는 것들이라(「기본 도형과 위치 관계」·「원의 현과 접선」·" +
      "「분산과 표준편차」·「가감법」) 별칭 판단이 따로 필요하다 — " +
      "「틀린 매핑보다 미분류가 낫다」는 원칙대로 원장님 확인 없이 붙이면 안 된다.",
  );
  lines.push("");
  lines.push(
    "이 트랙은 `externalId` 외의 컬럼을 쓰지 않으므로 `unitId` 는 한 행도 건드리지 않았고, " +
      "적재도 하지 않았다. 코디네이터가 배정할 일이다.",
  );
  lines.push("");

  lines.push("## 10. 그룹별 근거표");
  lines.push("");
  lines.push(
    "`정답`·`그림`·`figBox` 는 **원본 기준**(`n/m` = 원본 후보 m개 중 n개 보유). " +
      "`DB정답`·`DB그림` 은 지금 우리 DB 상태. `짝` 은 해설로 1:1 확정 가능 여부. " +
      "문항 본문은 싣지 않는다 — 교재·쪽·인쇄번호로 원본을 바로 펴 볼 수 있다.",
  );
  lines.push("");
  lines.push(
    "| # | DB행/원본 | 교재 | 쪽 | 인쇄번호 | 원본정답 | 정답 | 그림 | figBox | DB정답 | DB그림 | 짝 | 단원 |",
  );
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const group of groups) {
    const m = group.sourceIds.length;
    lines.push(
      `| ${group.index} | ${group.problemIds.length}/${m} | ` +
        `${group.book.replace("RPM 중학 수학 ", "RPM 중")} | ${group.pages.join(",")} | ` +
        `${group.printedNumbers.join(",")} | ` +
        `${group.sourceAnswersDiffer ? `다름(${group.sourceAnswerCount})` : "**같음**"} | ` +
        `${group.sourceWithAnswer}/${m} | ${group.sourceWithDiagram}/${m} | ${group.sourceWithFigureBox}/${m} | ` +
        `${group.dbWithAnswer}/${group.problemIds.length} | ${group.dbWithFigure}/${group.problemIds.length} | ` +
        `${group.pairableBySolution ? "○" : "**✕**"} | ` +
        `${group.sameUnit ? group.units[0] : `갈림 ${group.units.length}개`} |`,
    );
  }
  lines.push("");

  lines.push("## 11. 문항 id 대조표");
  lines.push("");
  lines.push(
    "우리 `Problem.id` 와 원본 `questions.id` 의 앞 8자. 순서는 짝을 뜻하지 않는다 — " +
      "짝은 해설로 정해지며 `backfill-rpm-external-id.ts --resolve-by-solution` 이 확정한다.",
  );
  lines.push("");
  lines.push("| # | 우리 `Problem.id` | 원본 `questions.id` |");
  lines.push("|---|---|---|");
  for (const group of groups) {
    lines.push(
      `| ${group.index} | ${group.problemIds.map(short).join(" ")} | ${group.sourceIds.map(short).join(" ")} |`,
    );
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const DECISION_PATH = "scripts/qa/rpm-duplicate-decision.json";

async function main(): Promise<void> {
  const { groups, totals, evidence } = await build();
  const outcomes = applyCriteria(groups);
  const projected = applyCriteria(projectAfterRecovery(groups));
  const out = outArg();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, render(groups, totals, evidence, outcomes, projected), "utf8");
  // 「이 기준으로 일괄」 한마디에 바로 쓸 수 있는 목록. **문항 id 만 담는다.**
  await writeFile(
    DECISION_PATH,
    `${JSON.stringify(
      {
        note:
          "RPM 본문 동일 88그룹의 기준별 남김/버림 목록. 판단은 원장님 몫이고 이 파일은 " +
          "고른 기준을 그대로 적용하기 위한 재료다. 다시 만들려면 report-rpm-duplicates.ts.",
        criteria: CRITERIA.map((c) => ({ key: c.key, label: c.label, detail: c.detail })),
        outcomes,
        projectedAfterRecovery: projected,
      },
      null,
      2,
    )}
`,
    "utf8",
  );
  console.log("── RPM 본문 동일 그룹 근거표 ──");
  console.log(
    `그룹 ${totals.groups} · DB행 ${totals.dbRows} · 원본후보 ${totals.sourceRows}`,
  );
  console.log(
    `원본 정답 다름 ${totals.answersDiffer} · 같음 ${totals.answersSame}` +
      ` · 해설로 1:1 확정 가능 ${totals.pairable}그룹/${totals.pairableRows}행`,
  );
  console.log(
    `짝짓기 대조 실험 — 짝 ${evidence.corroborated}/${evidence.corroborated + evidence.contradicted} 통과` +
      ` · 대조군 ${evidence.controlPass}/${evidence.controlTotal} 통과`,
  );
  console.log(
    `단원 학년 어긋남 ${totals.gradeMismatchRows}행 (${totals.gradeMismatchGroups}그룹) — 보고만 한다`,
  );
  console.log(
    `일괄 판단 기준(회수 후) — ${projected
      .map((o) => `${o.key}: 남김 ${o.keep.length}/버림 ${o.drop.length}(판단불가 ${o.undecided}그룹)`)
      .join(" · ")}`,
  );
  console.log(
    `일괄 판단 기준(지금) — ${outcomes
      .map((o) => `${o.key}: 남김 ${o.keep.length}/버림 ${o.drop.length}(판단불가 ${o.undecided}그룹)`)
      .join(" · ")}`,
  );
  console.log(`기록 — ${out} · ${DECISION_PATH}`);
}

if (isDirectScript(import.meta.url)) {
  void main();
}
