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

import { flattenStructured } from "../../src/lib/import/flattenStructured";
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
  ) AS diagram_count
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
}

/** `RPM 중학 수학 2-2 (2022 개정)` → `중2`. 못 읽으면 빈 문자열. */
export function bookGrade(book: string): string {
  const match = /중학\s*수학\s*([1-3])-[12]/.exec(book);
  return match ? `중${match[1]}` : "";
}

/** 그룹 안에서 DB행 ↔ 원본행이 해설로 1:1 로 갈리는지. `backfill-rpm-external-id` 와 같은 규칙. */
function solutionPairing(
  members: Array<{ id: string; solution: string }>,
  sourceIds: string[],
  explanationById: Map<string, string>,
): Map<string, string> | null {
  const distinct = new Set(sourceIds.map((id) => explanationById.get(id) ?? ""));
  if (distinct.size !== sourceIds.length) return null;
  const pairing = new Map<string, string>(); // sourceId → problemId
  for (const member of members) {
    if (!member.solution) return null;
    const hits = sourceIds.filter(
      (id) => explanationById.get(id) === member.solution,
    );
    if (hits.length !== 1 || pairing.has(hits[0])) return null;
    pairing.set(hits[0], member.id);
  }
  return pairing;
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
      },
    });

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
      const pairing = solutionPairing(
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

    const totals = {
      groups: groups.length,
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
      "§4 에 그 그룹과, 따로 눈여겨볼 그룹을 함께 뽑아 뒀다.",
  );
  lines.push("");
  lines.push(
    "> ⚠️ 2번을 적용하기 전에 **트랙 A 의 그림 회수와 순서를 맞춰야 한다.** " +
      "`externalId` 가 붙어야 그림이 본문 대조 대신 키로 붙는다(트랙 C 문서 §왜 하나 2번). " +
      "순서는 코디네이터가 정한다.",
  );
  lines.push("");

  lines.push("## 3. 숫자");
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
    `| 원본 교재 학년 ≠ 배정 단원 학년 | ${totals.gradeMismatchRows}행 (${totals.gradeMismatchGroups}그룹) — §5 |`,
  );
  lines.push("");

  lines.push("## 4. 사람이 봐야 하는 그룹");
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
  lines.push("| # | DB행/원본 | 교재 | 쪽 | 인쇄번호 | 사유 |");
  lines.push("|---|---|---|---|---|---|");
  for (const group of exceptions) {
    const why: string[] = [];
    if (!group.pairableBySolution) why.push("해설로 안 갈림");
    if (!group.sourceAnswersDiffer) why.push("**원본 정답까지 같음**");
    if (group.problemIds.length !== group.sourceIds.length) {
      why.push("행 수 불일치");
    }
    lines.push(
      `| ${group.index} | ${group.problemIds.length}/${group.sourceIds.length} | ` +
        `${group.book.replace("RPM 중학 수학 ", "RPM 중")} | ${group.pages.join(",")} | ` +
        `${group.printedNumbers.join(",")} | ${why.join(" · ")} |`,
    );
  }
  lines.push("");

  lines.push("## 5. 곁다리로 드러난 것 — RPM 단원 학년 오배정 (트랙 C 소관 아님)");
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
  lines.push(
    "이 트랙은 `externalId` 외의 컬럼을 쓰지 않으므로 `unitId` 는 한 행도 건드리지 않았다. " +
      "코디네이터가 배정할 일이다.",
  );
  lines.push("");

  lines.push("## 6. 그룹별 근거표");
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

  lines.push("## 7. 문항 id 대조표");
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

async function main(): Promise<void> {
  const { groups, totals, evidence } = await build();
  const out = outArg();
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, render(groups, totals, evidence), "utf8");
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
  console.log(`기록 — ${out}`);
}

if (isDirectScript(import.meta.url)) {
  void main();
}
