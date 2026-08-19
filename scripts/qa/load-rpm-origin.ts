/**
 * 수확한 RPM 출처를 **우리 DB 칸에 옮긴다.** 이 뒤로 sumaek 은 필요 없다.
 *
 *   npx tsx scripts/qa/load-rpm-origin.ts                    # 드라이런(기본)
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-rpm-origin.ts --apply
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-rpm-origin.ts --revert --apply
 *
 * 선행: `npx tsx scripts/qa/harvest-rpm-origin.ts`
 * 입력: `scripts/qa/reports/rpm-origin.json`  (커밋된 스냅샷 = 정본)
 * 원장: `scripts/qa/reports/rpm-origin-load.json`  (**되돌리기 근거 — 커밋한다**)
 *
 * ## 무엇을 어디에 넣나
 *
 * | 우리 칸 | 넣는 값 | 왜 |
 * |---|---|---|
 * | `sourceFile` | `RPM 중학 1-1 학생용.pdf` | 그림을 다시 오릴 때 어느 책인지 |
 * | `examId` | `rpm-middle-1-1` | 편 단위 묶음 — 기출의 `examId` 와 같은 자리 |
 * | `questionNumber` | `21` (`printedNumber` 「0021」의 수) | 「몇 번 문항인가」 |
 * | `subject` | `RPM 중학 수학 1-1 (2022 개정)` | 책 제목. 화면에 출처를 보일 수 있다 |
 *
 * `school` 은 **비운다** — 교재에는 학교가 없다. 빈 값이 「기출이 아니다」를 가리킨다
 * (CLAUDE.md 2026-08-18 「빈 컬럼이 결함이 아니라 판별자였다」).
 *
 * ## 왜 `externalId` 는 그대로 두나
 *
 * 그건 **재이관 멱등 키**다(스키마 주석). 바꾸면 같은 문항이 두 번 들어올 수 있다.
 * 값이 sumaek 의 행 id 인 것은 사실이지만, 그 값이 **우리 안에서만** 쓰이면
 * 연관고리가 아니라 그냥 우리 열쇠다 — 끊어야 하는 것은 «매번 접속해야 하는 상태»다.
 *
 * ⚠️ 공유 DB(D-31)다. 기본은 드라이런이고 `--apply` + `ALLOW_SHARED_IMPORT=1` 이라야 쓴다.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const SNAPSHOT = "scripts/qa/reports/rpm-origin.json";
const LEDGER = "scripts/qa/reports/rpm-origin-load.json";
const APPLY = process.argv.includes("--apply");
const REVERT = process.argv.includes("--revert");

type Origin = {
  problemId: string | null;
  book: string | null;
  page: number | null;
  printedNumber: string | null;
  bookTitle: string | null;
  gradeBand: string | null;
};

type Before = {
  id: string;
  sourceFile: string | null;
  examId: string | null;
  questionNumber: number | null;
  subject: string | null;
};

/**
 * 책 이름 `RPM 중학 1-1 학생용.pdf` → `rpm-middle-1-1`.
 *
 * 학년은 **책 이름에서** 뽑고, `gradeBand`(`middle-1`)로 **검산**한다 — 둘은 출처가
 * 다르므로 어긋나면 수확이 잘못된 것이다. 어긋나면 조용히 넘기지 않고 멈춘다.
 */
function examKey(o: Origin): string | null {
  const m = /중학\s*(\d)-(\d)/.exec(o.book ?? "");
  if (!m) return null;
  const [, grade, term] = m;
  if (o.gradeBand && o.gradeBand !== `middle-${grade}`) {
    throw new Error(
      `학년이 어긋난다: 책 「${o.book}」 은 중${grade} 인데 gradeBand 는 ${o.gradeBand} 다`,
    );
  }
  return `rpm-middle-${grade}-${term}`;
}

/** 「0021」 → 21. 앞의 0 은 자릿수 맞춤이라 뜻이 없다. */
function questionNo(printed: string | null): number | null {
  if (!printed) return null;
  const n = Number(printed.replace(/\D/g, ""));
  return Number.isFinite(n) && n > 0 ? n : null;
}

async function revert(): Promise<void> {
  if (!existsSync(LEDGER)) throw new Error(`원장이 없다: ${LEDGER}`);
  const before = (
    JSON.parse(readFileSync(LEDGER, "utf8")) as { 이전상태: Before[] }
  ).이전상태;
  console.log(`되돌릴 행 ${before.length}`);
  if (!APPLY) return void console.log("드라이런이다. --apply 를 붙여라.");
  let n = 0;
  for (const b of before) {
    await prisma.problem.update({
      where: { id: b.id },
      data: {
        sourceFile: b.sourceFile,
        examId: b.examId,
        questionNumber: b.questionNumber,
        subject: b.subject,
      },
    });
    if (++n % 500 === 0) console.log(`  ${n}/${before.length}`);
  }
  console.log(`되돌렸다 ${n}행`);
}

async function main(): Promise<void> {
  if (APPLY && process.env.ALLOW_SHARED_IMPORT !== "1") {
    throw new Error(
      "공유 DB 쓰기가 막혀 있다 — ALLOW_SHARED_IMPORT=1 이 필요하다.",
    );
  }
  if (REVERT) return revert();

  const snap = JSON.parse(readFileSync(SNAPSHOT, "utf8")) as { 목록: Origin[] };
  const byId = new Map<string, Origin>();
  for (const o of snap.목록) if (o.problemId) byId.set(o.problemId, o);

  const rows = await prisma.problem.findMany({
    where: { source: "transformed", originProblemId: null },
    select: {
      id: true,
      sourceFile: true,
      examId: true,
      questionNumber: true,
      subject: true,
    },
  });

  const plan: { id: string; data: Record<string, unknown>; before: Before }[] =
    [];
  const skip: Record<string, number> = {};
  const bump = (k: string) => (skip[k] = (skip[k] ?? 0) + 1);
  for (const r of rows) {
    const o = byId.get(r.id);
    if (!o) {
      bump("수확본에 없다");
      continue;
    }
    const key = examKey(o);
    const q = questionNo(o.printedNumber);
    if (!o.book || !key || q === null) {
      bump("책·편키·문항번호 중 빠진 것이 있다");
      continue;
    }
    const data = {
      sourceFile: o.book,
      examId: key,
      questionNumber: q,
      subject: o.bookTitle ?? null,
    };
    // 이미 같으면 건드리지 않는다 — 다시 돌려도 결과가 같아야 한다(멱등).
    if (
      r.sourceFile === data.sourceFile &&
      r.examId === data.examId &&
      r.questionNumber === data.questionNumber &&
      r.subject === data.subject
    ) {
      bump("이미 같다");
      continue;
    }
    plan.push({ id: r.id, data, before: r });
  }

  console.log(`RPM ${rows.length}행 · 채울 것 ${plan.length}`);
  for (const [k, v] of Object.entries(skip).sort((a, b) => b[1] - a[1])) {
    console.log(`  건너뜀: ${k} ${v}`);
  }
  if (plan.length) {
    const s = plan[0]!;
    console.log(`\n표본 ${s.id}`);
    console.log(`  → ${JSON.stringify(s.data, null, 0)}`);
  }
  if (!APPLY)
    return void console.log("\n드라이런이다. 쓰려면 --apply 를 붙여라.");

  // **원장을 먼저 쓴다.** 반대 순서면 쓰기와 기록 사이에서 죽었을 때 되돌릴 근거가 없다.
  mkdirSync("scripts/qa/reports", { recursive: true });
  writeFileSync(
    LEDGER,
    JSON.stringify(
      {
        적용: "RPM 교재본에 출처(책·편·문항번호·책제목)를 채운다",
        기준시각: new Date().toISOString(),
        되돌리기:
          "ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/load-rpm-origin.ts --revert --apply",
        채운건수: plan.length,
        이전상태: plan.map((p) => p.before),
      },
      null,
      1,
    ),
    "utf8",
  );

  let n = 0;
  for (const p of plan) {
    await prisma.problem.update({ where: { id: p.id }, data: p.data });
    if (++n % 500 === 0) console.log(`  ${n}/${plan.length}`);
  }
  console.log(`\n채웠다 ${n}행. 원장 → ${LEDGER}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
