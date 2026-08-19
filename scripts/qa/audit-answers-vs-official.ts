/**
 * DB 정답을 **학교 공식 정답과 대조**한다.
 *
 * 왜 필요한가: 우리는 정답 없는 문항을 AI 로 6,000건 넘게 풀어 채웠고 그 답이
 * 학생 시험지에 인쇄된다. 검증은 지금까지 전부 **AI 끼리 교차 검증**이었다
 * (표본 60건 두 차례, 각각 60/60·59/60). 같은 모델이 같은 실수를 하면 못 잡는다.
 *
 * 그런데 완료본 PDF 뒤쪽에 **학교가 인쇄한 공식 정답**이 있다는 걸 뒤늦게 발견했다
 * (2026-08-15. `10-handoff.md §2.4` 의 "정답은 완료 PDF 에 없다" 는 전제가 틀렸다).
 * 실측 사례: AI 계산 `a=-3, b=2` ↔ 공식 정답 `a=-1, b=16/9`.
 *
 * **공식 정답이 있으면 그게 정본이다.** AI 풀이는 공식 정답이 없을 때만 쓴다.
 *
 *   npx tsx scripts/qa/audit-answers-vs-official.ts              대조만
 *   ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/audit-answers-vs-official.ts --apply
 *
 * `--apply` 는 **원문자 번호 정답만** 덮는다. 값 형태는 표기 차이(분수·단위·라벨)가
 * 많아 자동 판정이 위험하므로 목록만 내고 사람이 본다.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";

import { PrismaClient } from "@prisma/client";
import { ANSWER_CIRCLED_CLASS } from "../../src/lib/math/circledNumber";

import { allowSharedImport } from "../../src/lib/import/classifyDatabaseUrl";
import { inspectDatabaseTargets } from "../import/resolveDbTarget";

const DIR = "scripts/qa/reports/official-answers";
const OUT = "scripts/qa/reports/answer-audit.json";
const SENTINEL = "정답 없음";
// 계열은 `circledNumber.ts` 한 곳에서 온다 — `➀`(U+2780) 계열이 실측 43행이다.
const CIRCLED_ONLY = new RegExp(`^[${ANSWER_CIRCLED_CLASS}]$`);

interface Official {
  parsed: string | null;
  text: string;
}

/** `<examId>-<번호>` → 공식 정답 */
async function loadOfficial(): Promise<Map<string, Official>> {
  const out = new Map<string, Official>();
  let files: string[] = [];
  try {
    files = (await readdir(DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const f of files) {
    const doc = JSON.parse(await readFile(`${DIR}/${f}`, "utf-8")) as {
      examId: number;
      items: Record<string, Official>;
    };
    for (const [number, item] of Object.entries(doc.items)) {
      out.set(`${doc.examId}-${Number(number)}`, item);
    }
  }
  return out;
}

/**
 * 표기 차이를 흡수한 비교용 문자열.
 *
 * 값 불일치 1,525건을 표본으로 보니 **거의 전부 표기 차이**였다 —
 * `4` ↔ `k=4`, `x²` ↔ `x2`, `cm²` ↔ `cm2`, `⑴ 5, ⑵ 4` ↔ `⑴ 5 ⑵ 4`.
 * 답이 같은데 어긋난 것으로 세면 진짜 오답이 묻힌다.
 */
const SUPERSCRIPT: Record<string, string> = {
  "²": "2",
  "³": "3",
  "⁴": "4",
  "¹": "1",
};

function normalize(value: string): string {
  let out = value;
  // 출처 주석 — `⑤ 출처:함지고24-2-중간 8번`
  out = out.replace(/\s*출처\s*[:：].*$/, "");
  // 위첨자를 평문으로 (`x²` → `x2`)
  out = out.replace(/[²³⁴¹]/g, (ch) => SUPERSCRIPT[ch] ?? ch);
  // `k=4` 처럼 변수명을 붙여 쓴 것 — 한쪽에만 있으면 어긋난 것으로 잡힌다
  out = out.replace(/(^|[,\s])[a-zA-Z]\s*=\s*/g, "$1");
  return out
    .replace(/\$/g, "")
    .replace(/[,:：]/g, "")
    .replace(/\s+/g, "")
    .replace(/[.]$/, "")
    .trim();
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const official = await loadOfficial();
  const prisma = new PrismaClient();
  try {
    const rows = await prisma.problem.findMany({
      where: { source: "past_exam", externalId: { not: null } },
      select: { id: true, externalId: true, answer: true },
    });

    const agree: string[] = [];
    const conflictNumber: Array<{
      id: string;
      externalId: string;
      ours: string;
      official: string;
    }> = [];
    const conflictValue: typeof conflictNumber = [];
    const fillable: typeof conflictNumber = [];
    let noOfficial = 0;

    for (const row of rows) {
      const hit = official.get(row.externalId as string);
      if (!hit?.parsed) {
        noOfficial += 1;
        continue;
      }
      const ours = row.answer;
      const theirs = hit.parsed;
      const entry = {
        id: row.id,
        externalId: row.externalId as string,
        ours,
        official: theirs,
      };
      if (ours.includes(SENTINEL)) {
        fillable.push(entry);
        continue;
      }
      if (normalize(ours) === normalize(theirs)) {
        agree.push(row.id);
        continue;
      }
      // 번호끼리 어긋난 것은 자동 판정이 가능하다. 값 형태는 표기 차이가 많다.
      if (CIRCLED_ONLY.test(theirs) && CIRCLED_ONLY.test(normalize(ours))) {
        conflictNumber.push(entry);
      } else {
        conflictValue.push(entry);
      }
    }

    // ⚠️ 한 시험지에서 번호가 여럿 어긋나면 AI 가 그 편만 유독 틀렸다기보다
    // **정답면의 문항 번호 정렬이 밀린 것**이다. 실측: 어긋남 49건 중 46건이
    // 시험지 4편에 몰려 있었다. 그런 편은 추출을 못 믿으므로 교정 대상에서 뺀다.
    const perExam = new Map<string, number>();
    for (const c of conflictNumber) {
      const exam = c.externalId.slice(0, c.externalId.lastIndexOf("-"));
      perExam.set(exam, (perExam.get(exam) ?? 0) + 1);
    }
    const concentrated = [...perExam]
      .filter(([, n]) => n >= 3)
      .sort((a, b) => b[1] - a[1]);

    await mkdir("scripts/qa/reports", { recursive: true });
    await writeFile(
      OUT,
      JSON.stringify({ conflictNumber, conflictValue, fillable }, null, 1),
      "utf-8",
    );

    console.log("── DB 정답 ↔ 학교 공식 정답 대조 ──");
    console.log(
      `기출 ${rows.length} · 공식 정답 있음 ${rows.length - noOfficial}`,
    );
    console.log(`  일치 ${agree.length}`);
    console.log(
      `  ⚠️ 번호끼리 어긋남 ${conflictNumber.length}  ← 우리가 틀렸다(교정 대상)`,
    );
    if (concentrated.length > 0) {
      console.log(
        `     └ 한 편에 몰린 것: ${concentrated
          .map(([exam, n]) => `${exam} ${n}건`)
          .join(" · ")}`,
      );
    }
    console.log(
      `  값 형태 불일치 ${conflictValue.length}  ← 표기 차이 다수, 사람이 본다`,
    );
    console.log(`  비어 있어 채울 수 있음 ${fillable.length}`);
    console.log(`→ ${OUT}`);

    if (!apply) {
      console.log("\n대조만 함. 번호 정답을 공식으로 덮으려면 --apply");
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
    let fixed = 0;
    for (const item of conflictNumber) {
      await prisma.problem.update({
        where: { id: item.id },
        data: { answer: item.official },
      });
      fixed += 1;
    }
    // 빈 정답 채우기는 **기본으로 하지 않는다.** 공식 정답의 값 형태는 텍스트
    // 레이어에서 수식이 평문으로 뭉개져 나온다 — `√⁄5`(분수 가로선 잔존),
    // `80또는-104`(공백 유실), `a2+b2`(위첨자 소실). 지면에 그대로 인쇄하면
    // 틀린 값이 나간다. 번호 정답(`①`~`⑤`)은 한 글자라 그럴 여지가 없어 안전하다.
    let filled = 0;
    const doFill = process.argv.includes("--fill");
    for (const item of doFill ? fillable : []) {
      await prisma.problem.update({
        where: { id: item.id },
        data: { answer: item.official },
      });
      filled += 1;
    }
    console.log(`\n적용 — 오답 교정 ${fixed} · 빈 정답 채움 ${filled}`);
    console.log("값 형태 불일치는 건드리지 않았다. 목록을 보고 판단할 것.");
  } finally {
    await prisma.$disconnect();
  }
}

void main();
