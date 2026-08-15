/**
 * DB 정답을 **바깥 두 출처와 함께** 대조한다 — PDF 정답면 + HWP 원본 (트랙 B-1).
 *
 * 왜 3자인가: 2자 대조(DB↔PDF)는 어긋났을 때 **누가 틀렸는지 못 가른다.**
 * 실제로 표본 26건을 지면과 맞춰 보니 절반 가까이가 우리 오답이 아니라
 * 「같은 답을 다르게 적은 것」이었다. 바깥 출처가 둘이면 판정이 서게 된다:
 *
 * | HWP | PDF 정답면 | 판정 |
 * |---|---|---|
 * | DB 와 같음 | DB 와 다름 | **PDF 추출 결함** — DB 를 그대로 둔다 |
 * | DB 와 다름 | DB 와 다름, 둘이 서로 같음 | **DB 오답 확정** — 교정 대상 |
 * | DB 와 다름 | DB 와 다름, 둘도 서로 다름 | 셋 다 다름 — 사람이 본다 |
 * | 없음 | — | 보류(HWP 추출 대기) |
 *
 * HWP 산출물은 트랙 D 가 만든다(`scripts/qa/reports/hwp/<examId>.json`).
 * 다른 워크트리에 있으면 `HWP_DIR` 로 가리킨다. **트랙 D 의 파일은 읽기만 한다.**
 *
 *   npx tsx scripts/qa/audit-answers-3way.ts
 *   HWP_DIR=../잔여-D-HWP/scripts/qa/reports/hwp npx tsx scripts/qa/audit-answers-3way.ts
 *
 * **DB 를 건드리지 않는다.**
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { canon, canonLoose, stripUnits } from "./answer-notation";

const OFFICIAL_DIR = "scripts/qa/reports/official-answers";
const HWP_DIR = process.env.HWP_DIR ?? "scripts/qa/reports/hwp";
const CLASSIFIED = "scripts/qa/reports/answer-mismatch-classified.json";
const OUT = "scripts/qa/reports/answer-3way.json";

interface Row {
  id: string;
  externalId: string;
  ours: string;
  official: string;
  officialPrintable?: boolean;
}

interface Group {
  rule: string;
  verdict: string;
  count: number;
  items: Row[];
}

/** HWP 정답은 `정답 ①` 처럼 접두어가 붙는다. */
function stripAnswerPrefix(value: string): string {
  return value.replace(/^\s*(?:정답|답)\s*[:：]?\s*/, "").trim();
}

/**
 * 두 답이 **같은 답인지**. 분류기보다 느슨하게 본다 —
 * 여기서 궁금한 것은 표기 차이가 아니라 「값이 같은가」뿐이다.
 */
function sameAnswer(a: string, b: string): boolean {
  const x = stripAnswerPrefix(a);
  const y = stripAnswerPrefix(b);
  if (canon(x) !== "" && canon(x) === canon(y)) return true;
  if (stripUnits(x) !== "" && stripUnits(x) === stripUnits(y)) return true;
  return canonLoose(x) !== "" && canonLoose(x) === canonLoose(y);
}

/** `<examId>-<번호>` → HWP 정답 */
async function loadHwp(): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  let files: string[] = [];
  try {
    files = (await readdir(HWP_DIR)).filter((f) => f.endsWith(".json"));
  } catch {
    return out;
  }
  for (const file of files) {
    const examId = Number(file.replace(/\.json$/, ""));
    if (!Number.isFinite(examId)) continue;
    let doc: { questions?: Array<{ number: number; answer: string | null }> };
    try {
      doc = JSON.parse(await readFile(`${HWP_DIR}/${file}`, "utf-8"));
    } catch {
      continue;
    }
    for (const q of doc.questions ?? []) {
      const answer = stripAnswerPrefix(q.answer ?? "");
      if (answer) out.set(`${examId}-${q.number}`, answer);
    }
  }
  return out;
}

async function main(): Promise<void> {
  const hwp = await loadHwp();
  const classified = JSON.parse(await readFile(CLASSIFIED, "utf-8")) as {
    rules: Group[];
  };

  const examsWithHwp = new Set(
    [...hwp.keys()].map((k) => k.slice(0, k.lastIndexOf("-"))),
  );
  const officialFiles = (await readdir(OFFICIAL_DIR)).filter((f) =>
    f.endsWith(".json"),
  ).length;

  console.log("── 3자 대조 (DB ↔ PDF 정답면 ↔ HWP 원본) ──");
  console.log(`HWP 산출물 ${HWP_DIR}`);
  console.log(
    `  시험지 ${examsWithHwp.size}편 · 정답 ${hwp.size}문항 / PDF 정답면 ${officialFiles}편`,
  );
  if (hwp.size === 0) {
    console.log("\nHWP 산출물이 없다. 트랙 D 가 뽑는 중이면 나중에 다시 돌려라.");
  }

  const verdicts = new Map<string, Row[]>();
  const push = (key: string, row: Row) => {
    if (!verdicts.has(key)) verdicts.set(key, []);
    (verdicts.get(key) as Row[]).push(row);
  };

  // 판정이 필요한 것만 본다 — 표기 차이로 이미 걷힌 것은 대상이 아니다.
  const target = classified.rules.filter((g) => g.verdict !== "표기차이");
  for (const group of target) {
    for (const row of group.items) {
      const third = hwp.get(row.externalId);
      if (!third) {
        push("HWP없음", { ...row });
        continue;
      }
      const hwpMatchesDb = sameAnswer(third, row.ours);
      const hwpMatchesPdf = sameAnswer(third, row.official);
      if (hwpMatchesDb && !hwpMatchesPdf) {
        push("PDF추출결함", { ...row, hwp: third } as Row);
      } else if (!hwpMatchesDb && hwpMatchesPdf) {
        push("DB오답확정", { ...row, hwp: third } as Row);
      } else if (hwpMatchesDb && hwpMatchesPdf) {
        push("셋다같음", { ...row, hwp: third } as Row);
      } else {
        push("셋다다름", { ...row, hwp: third } as Row);
      }
    }
  }

  const total = target.reduce((n, g) => n + g.count, 0);
  console.log(`\n판정 대상 ${total}건 (표기차이로 걷힌 것은 제외)`);
  for (const [key, rows] of [...verdicts].sort((a, b) => b[1].length - a[1].length)) {
    console.log(`  ${key.padEnd(10)} ${String(rows.length).padStart(4)}`);
    for (const row of rows.slice(0, 2)) {
      const third = (row as Row & { hwp?: string }).hwp ?? "—";
      console.log(
        `      ${row.externalId.padEnd(9)} DB ${JSON.stringify(row.ours).slice(0, 26).padEnd(28)} PDF ${JSON.stringify(row.official).slice(0, 24).padEnd(26)} HWP ${JSON.stringify(third).slice(0, 24)}`,
      );
    }
  }

  await mkdir("scripts/qa/reports", { recursive: true });
  await writeFile(
    OUT,
    JSON.stringify(
      {
        hwpDir: HWP_DIR,
        hwpExams: examsWithHwp.size,
        hwpAnswers: hwp.size,
        total,
        verdicts: Object.fromEntries(
          [...verdicts].map(([k, v]) => [k, v.length]),
        ),
        rows: Object.fromEntries(verdicts),
      },
      null,
      1,
    ),
    "utf-8",
  );
  console.log(`\n→ ${OUT}`);
}

void main();
