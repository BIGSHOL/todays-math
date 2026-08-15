/**
 * 본문에 박힌 `[그림] …` 말풀이를 **원본 OCR JSON 기준으로 정확히** 걷어낸다.
 *
 * 비전 OCR 은 그림을 말로 옮겨 `figure` 블록에 넣었고, 이관 때
 * `blocksToLatex` 가 그것을 `[그림] <설명>` 텍스트로 본문에 합쳤다(681건).
 * 이제 원본 그림을 붙였으니 그 문장은 중복이다. 게다가 배너(학원 로고) 설명이
 * 그대로 학생 시험지에 인쇄된다(59건).
 *
 * ⚠️ 텍스트에서 `[그림]` 뒤를 잘라내는 방식은 **틀린다.** 설명은 발문 끝에만
 * 있는 게 아니다 — 실제 화면에서 확인:
 *     "…지나지 않는 사분 [그림] 면은?"    ← 자르면 "면은?" 이 사라진다
 *     "⑤ −12 [그림] 이차함수 ~ …"          ← 선택지 안에도 들어간다
 * 그래서 원본 ocr_json 에서 **figure 블록만 빼고 본문을 다시 만들어** 대조한다.
 * 그 결과가 현재 본문과 `[그림] …` 만큼만 다를 때에만 갱신한다.
 *
 *   npx tsx scripts/figure/strip-figure-text.ts            드라이런(집계만)
 *   npx tsx scripts/figure/strip-figure-text.ts --apply    실제 갱신
 */
import { execFileSync } from "node:child_process";

import { PrismaClient } from "@prisma/client";

import {
  convertPastExamQuestion,
  type PastExamQuestion,
} from "../../src/lib/import/convertPastExam";

interface FigureRow {
  id: string;
  external_id: string | null;
  exam_id: string | null;
  question_number: number | null;
  content: string;
}

const APPLY = process.argv.includes("--apply");

/** exam_index.db 는 SQLite 다 — 파이썬으로 필요한 문항만 뽑아 온다(토큰 0). */
function loadOcrJson(pairs: Array<[number, number]>): Record<string, string> {
  const py = `
import json, sqlite3, sys, pathlib
sys.path.append(str(pathlib.Path("scripts/qa")))
from tc_paths import exam_index_db
con = sqlite3.connect(exam_index_db())
want = json.loads(sys.stdin.read())
out = {}
for exam_id, number in want:
    row = con.execute(
        "select ocr_json from questions where exam_id=? and number=?",
        (exam_id, number)).fetchone()
    if row and row[0]:
        out[f"{exam_id}-{number}"] = row[0]
sys.stdout.write(json.dumps(out))
`;
  const raw = execFileSync("python", ["-c", py], {
    input: JSON.stringify(pairs),
    maxBuffer: 512 * 1024 * 1024,
    encoding: "utf8",
  });
  return JSON.parse(raw);
}

async function main(): Promise<void> {
  const db = new PrismaClient();
  const rows: FigureRow[] = await db.$queryRawUnsafe(
    `select id, external_id, exam_id, question_number, content
     from "problem"
     where array_length(figure_urls,1) > 0 and content like '%[그림]%'`,
  );
  console.log(`대상(그림 있고 본문에 [그림] 설명) ${rows.length}건`);

  const ocr = loadOcrJson(
    rows.map((r) => [Number(r.exam_id), Number(r.question_number)]),
  );

  const stat = { 원본없음: 0, 변화없음: 0, 갱신: 0, "불일치:건너뜀": 0 };
  const samples = [];

  for (const r of rows) {
    const raw = ocr[`${r.exam_id}-${r.question_number}`];
    if (!raw) {
      stat.원본없음 += 1;
      continue;
    }
    const q = JSON.parse(raw) as PastExamQuestion;
    // figure 블록만 뺀 채로 이관 때와 **같은 변환**을 다시 태운다.
    const withoutFigure = {
      ...q,
      contents: (q.contents ?? []).filter((b) => b.type !== "figure"),
      choices: (q.choices ?? []).map((c) => ({
        ...c,
        contents: (c.contents ?? []).filter((b) => b.type !== "figure"),
      })),
    };
    const rebuilt = convertPastExamQuestion(
      withoutFigure,
      undefined,
      {},
    ).content;

    if (rebuilt === r.content) {
      stat.변화없음 += 1;
      continue;
    }
    // 안전장치 — 새 본문이 현재 본문보다 길어지거나, `[그림]` 이 남아 있으면 건드리지 않는다.
    if (rebuilt.length >= r.content.length || rebuilt.includes("[그림]")) {
      stat["불일치:건너뜀"] += 1;
      continue;
    }
    if (APPLY) {
      await db.problem.update({
        where: { id: r.id },
        data: { content: rebuilt },
      });
    }
    stat.갱신 += 1;
    if (samples.length < 3) {
      samples.push(
        `${r.external_id}  ${r.content.length}자 → ${rebuilt.length}자 (−${r.content.length - rebuilt.length})`,
      );
    }
  }

  console.log(APPLY ? "── 갱신 완료 ──" : "── 드라이런(쓰기 없음) ──");
  for (const [k, v] of Object.entries(stat))
    console.log(`  ${k.padEnd(14)} ${v}`);
  samples.forEach((s) => console.log(`  • ${s}`));
  await db.$disconnect();
}

main().catch((e: unknown) => {
  console.error(e);
  process.exitCode = 1;
});
