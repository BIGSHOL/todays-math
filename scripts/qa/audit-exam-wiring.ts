/**
 * **「새 기출 문항이 `Exam` 없이 들어올 수 있는 경로가 있는가」** 를 전수로 센다.
 *
 *   npx tsx scripts/qa/audit-exam-wiring.ts            # 코드 경로만 (DB 안 붙는다)
 *   npx tsx scripts/qa/audit-exam-wiring.ts --db       # DB 실태까지
 *
 * ## 왜 목록을 손으로 안 쓰나
 *
 * 「적재 경로는 이 셋이다」를 주석에 적어 두면, 넷째가 생겨도 아무도 모른다. 그래서
 * **소스에서 `problem.create*` 호출 지점을 찾아 세고**, 판단이 안 서는 자리는 `판단불가`로
 * **출력한다.** 목록에 없는 부류가 구조적으로 0이 되는 것을 막는 유일한 방법이다
 * (CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」).
 *
 * ## 판정 규칙 — **발견은 자동, 선언은 강제**
 *
 * 호출 지점은 소스에서 **찾아**내고, 각 지점은 바로 위에 표시를 **달아야** 한다:
 *
 *     // exam-wiring: 기출·배선됨 — 적재 직후 syncExamMetadata 로 Exam 을 세운다
 *
 * | 표시 | 뜻 |
 * |---|---|
 * | `기출·배선됨` | 기출이 들어온다. `syncExamMetadata` 를 부른다 — **감사기가 실제로 확인한다** |
 * | `기출·원본없음` | 기출일 수 있으나 원본 시험지 정보(examId·sourceFile)가 없어 Exam 을 만들 수 없다 |
 * | `기출아님` | 자작/AI 생성·변형만 넣는다 |
 * | `테스트` | 테스트·픽스처 |
 * | (표시 없음) | **판단불가** — 감사기가 실패한다 |
 *
 * 이 구조라야 «목록에 없는 부류가 0이 되는» 함정을 피한다: 새 경로가 생기면 표시가 없어서
 * **감사기가 빨개진다.** 반대로 표시만 믿지도 않는다 — `기출·배선됨` 은 파일에 실제로
 * `syncExamMetadata` 가 있는지 대조한다(거짓말할 수 없다).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

import { isDirectScript } from "../import/isDirectScript";

const ROOTS = ["src", "scripts", "e2e", "prisma"];
/**
 * 감사기 **자기 테스트**만 뺀다. 그 파일은 감사기를 시험하려고 가짜 호출 문자열을
 * 담고 있어서(일부러 «배선됨이라 적어 놓고 안 부르는» 픽스처도 있다) 세면 제품 표가
 * 거짓말을 한다. 이건 «경로 목록»이 아니라 **자기 참조 하나**를 빼는 것이다.
 */
const SELF_TEST = "examWiringAudit.test.ts";
const EXTS = [".ts", ".tsx", ".mjs", ".js"];
/**
 * 호출 지점을 찾는 열쇠. `db.problem.create`·`tx.problem.createMany` 등을 모두 잡는다.
 *
 * ⚠️ **줄 단위로 찾으면 안 된다.** 포매터가 `.problem` 과 `.create(` 사이를 줄바꿈으로
 * 가르면 그 지점이 **조용히 사라진다**(2026-08-19 실제 발생: prettier 가
 * `syncExamMetadata.test.ts` 를 그렇게 접자 호출 지점이 10 → 9 로 줄었다).
 * 감사기가 못 보는 경로는 「없는 경로」가 되므로, 파일 전체에서 공백·줄바꿈을 넘겨 찾는다.
 */
const CALL =
  /\.problem\s*\.\s*(create|createMany|createManyAndReturn|upsert)\s*\(/g;

export type WiringVerdict =
  | "기출·배선됨"
  | "기출·배선없음"
  | "기출·원본없음"
  | "기출아님"
  | "테스트"
  | "판단불가";

/** 호출 지점이 스스로 다는 표시. 감사기는 이걸 찾고, 없으면 실패한다. */
const MARKER = /\/\/\s*exam-wiring:\s*([^\s—-]+)\s*(?:[—-]\s*(.*))?$/;
/** 표시를 이 줄 수 위까지 찾는다. */
const MARKER_LOOKBACK = 8;

const DECLARABLE: readonly WiringVerdict[] = [
  "기출·배선됨",
  "기출·원본없음",
  "기출아님",
  "테스트",
];

export interface WiringSite {
  file: string;
  line: number;
  call: string;
  verdict: WiringVerdict;
  note: string;
}

function walk(dir: string, out: string[] = []): string[] {
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch {
    return out;
  }
  for (const name of entries) {
    if (name === "node_modules" || name === ".next" || name === "coverage")
      continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full, out);
    else if (EXTS.some((e) => name.endsWith(e))) out.push(full);
  }
  return out;
}

/**
 * 한 파일의 호출 지점을 판정한다. **파일 안의 증거만** 본다 —
 * 못 가르면 「판단불가」로 내보내고 조용히 통과시키지 않는다.
 */
export function classifyFile(file: string, source: string): WiringSite[] {
  const sites: WiringSite[] = [];
  const wired = /syncExamMetadata/.test(source);
  const lines = source.split(/\r?\n/);

  // 줄 시작 오프셋 — 매치 위치를 줄 번호로 되돌리는 데 쓴다.
  const lineStart: number[] = [];
  {
    let at = 0;
    for (const l of lines) {
      lineStart.push(at);
      at += l.length + 1;
    }
  }
  const lineOf = (offset: number): number => {
    let lo = 0;
    let hi = lineStart.length - 1;
    while (lo < hi) {
      const mid = Math.ceil((lo + hi) / 2);
      if (lineStart[mid]! <= offset) lo = mid;
      else hi = mid - 1;
    }
    return lo;
  };

  CALL.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = CALL.exec(source)) !== null) {
    const i = lineOf(m.index);

    let declared: WiringVerdict | null = null;
    let reason = "";
    for (let k = i; k >= Math.max(0, i - MARKER_LOOKBACK); k -= 1) {
      const mark = MARKER.exec((lines[k] ?? "").trim());
      if (!mark) continue;
      const value = mark[1]?.trim() ?? "";
      if ((DECLARABLE as readonly string[]).includes(value)) {
        declared = value as WiringVerdict;
        reason = mark[2]?.trim() ?? "";
      }
      break;
    }

    let verdict: WiringVerdict;
    let note: string;
    if (declared === null) {
      verdict = "판단불가";
      note =
        "`// exam-wiring:` 표시가 없다 — 이 경로가 기출을 넣는지 선언할 것";
    } else if (declared === "기출·배선됨" && !wired) {
      // 표시를 믿지 않는다 — 부른다고 적어 놓고 안 부르면 그게 제일 나쁘다.
      verdict = "기출·배선없음";
      note = "「배선됨」이라 적혀 있는데 파일에 syncExamMetadata 호출이 없다";
    } else {
      verdict = declared;
      note = reason || "(사유 미기재)";
    }
    sites.push({
      file: file.split("\\").join("/"),
      line: i + 1,
      call: m[0].replace(/\s+/g, ""),
      verdict,
      note,
    });
  }
  return sites;
}

export function auditCodePaths(): WiringSite[] {
  const files = ROOTS.flatMap((r) => walk(r));
  const sites: WiringSite[] = [];
  for (const file of files) {
    let source: string;
    try {
      source = readFileSync(file, "utf-8");
    } catch {
      continue;
    }
    // 사전 필터도 **같은 열쇠**를 써야 한다. `.problem.` 문자열로 거르면
    // 포매터가 갈라 놓은 호출이 여기서 먼저 탈락해 감사기가 못 본다.
    if (file.endsWith(SELF_TEST)) continue;
    CALL.lastIndex = 0;
    if (!CALL.test(source)) continue;
    sites.push(...classifyFile(file, source));
  }
  return sites;
}

export interface DbWiringStats {
  pastExamProblems: number;
  withExamId: number;
  distinctExamIds: number;
  examRows: number;
  examQuestionRows: number;
  /** `Exam` 을 못 받은 원본 편 수 — 미분류·제외분이다. 사유는 decisions.json 에 있다. */
  examIdsWithoutExam: number;
  /** `ExamQuestion` 과 이어진 기출 문항 수 */
  linkedProblems: number;
}

export async function auditDb(): Promise<DbWiringStats> {
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const [row] = await prisma.$queryRaw<
      Array<{
        past_exam: number;
        with_exam_id: number;
        distinct_exam_ids: number;
        linked: number;
      }>
    >`
      select count(*)::int as past_exam,
             count(exam_id)::int as with_exam_id,
             count(distinct exam_id)::int as distinct_exam_ids,
             count(*) filter (where exists (
               select 1 from exam_question eq where eq.problem_id = problem.id
             ))::int as linked
      from problem where source = 'past_exam'`;
    const [counts] = await prisma.$queryRaw<
      Array<{ exams: number; questions: number }>
    >`select (select count(*) from exam)::int as exams,
             (select count(*) from exam_question)::int as questions`;
    const [orphan] = await prisma.$queryRaw<Array<{ n: number }>>`
      select count(*)::int as n from (
        select p.exam_id from problem p
        where p.source = 'past_exam' and p.exam_id is not null
          and not exists (
            select 1 from exam_question eq
            join problem p2 on p2.id = eq.problem_id
            where p2.exam_id = p.exam_id
          )
        group by p.exam_id
      ) t`;
    return {
      pastExamProblems: row!.past_exam,
      withExamId: row!.with_exam_id,
      distinctExamIds: row!.distinct_exam_ids,
      examRows: counts!.exams,
      examQuestionRows: counts!.questions,
      examIdsWithoutExam: orphan!.n,
      linkedProblems: row!.linked,
    };
  } finally {
    await prisma.$disconnect();
  }
}

if (isDirectScript(import.meta.url)) {
  const sites = auditCodePaths();
  const byVerdict = new Map<WiringVerdict, WiringSite[]>();
  for (const s of sites) {
    const list = byVerdict.get(s.verdict) ?? [];
    list.push(s);
    byVerdict.set(s.verdict, list);
  }
  console.log(
    `[exam-wiring] Problem INSERT 호출 지점 ${sites.length}개 (전수 탐색)`,
  );
  console.log("");
  console.log("| 파일:줄 | 호출 | 판정 | 비고 |");
  console.log("|---|---|---|---|");
  for (const s of sites.sort((a, b) => a.verdict.localeCompare(b.verdict))) {
    console.log(
      `| \`${s.file}:${s.line}\` | \`${s.call}\` | ${s.verdict} | ${s.note} |`,
    );
  }
  console.log("");
  const bad = [
    ...(byVerdict.get("기출·배선없음") ?? []),
    ...(byVerdict.get("판단불가") ?? []),
  ];
  console.log(
    `  기출·배선없음 ${(byVerdict.get("기출·배선없음") ?? []).length}` +
      ` · 판단불가 ${(byVerdict.get("판단불가") ?? []).length} — 둘 다 0이어야 한다`,
  );

  if (process.argv.includes("--db")) {
    auditDb()
      .then((db) => {
        console.log("");
        console.log(
          `  DB: past_exam ${db.pastExamProblems} · examId 보유 ${db.withExamId}` +
            ` · 편 ${db.distinctExamIds}`,
        );
        console.log(
          `      exam ${db.examRows} · exam_question ${db.examQuestionRows}` +
            ` · 문제은행 연결 ${db.linkedProblems}`,
        );
        console.log(`      Exam 을 못 받은 편 ${db.examIdsWithoutExam}`);
        if (bad.length > 0) process.exitCode = 1;
      })
      .catch((e: unknown) => {
        console.error(e);
        process.exitCode = 1;
      });
  } else if (bad.length > 0) {
    process.exitCode = 1;
  }
}
