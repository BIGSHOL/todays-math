/**
 * DB 정답을 **PDF 정답면 · HWP 원본**과 함께 본다 (트랙 B-1).
 *
 * ⚠️ **HWP 는 독립 출처가 아니다 — DB 정답의 출처다.**
 * 처음에는 3자 대조로 판정을 세울 생각이었는데, 실측에서 DB 와 HWP 가
 * **54건 전부 글자까지 같았다.** `extract-final-batch.py` 가 완료본 HWP 의
 * `answer` 필드를 그대로 실었기 때문이다. 그래서 HWP 는 「우리가 옳은가」를
 * 가르는 데 못 쓴다. 독립 출처는 **완료본 PDF 뒤쪽 정답면 하나뿐**이다.
 *
 * 그래도 셋을 같이 보면 **어긋남의 성격**을 가를 수 있다:
 *
 * | 갈래 | 뜻 | 할 일 |
 * |---|---|---|
 * | `이관누락` | DB≠HWP 인데 PDF≡HWP — 원본 두 형태가 같다 | **이관이 틀렸다. 교정 확정** |
 * | `원본두필드가갈림` | DB≡HWP 인데 PDF 만 다름 | 학교 문서 안에서 갈린 것. 인쇄된 정답면이 정본 |
 * | `PDF표기만다름` | DB≡HWP≡PDF (값은 같고 표기만) | 표기 통일 문제 |
 * | `셋다다름` | 셋이 서로 다름 | 사람이 본다 |
 *
 * HWP 산출물은 트랙 D 가 만든다(`reports/hwp/<examId>.json`). 내 몫만 급히 뽑은
 * `reports/hwp-b/` 도 같이 읽는다. **트랙 D 의 파일은 읽기만 한다.**
 *
 *   HWP_DIR=reports/hwp-b,../잔여-D-HWP/scripts/qa/reports/hwp npx tsx scripts/qa/audit-answers-3way.ts
 *
 * **DB 를 건드리지 않는다.**
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { canon, canonLoose, stripUnits } from "./answer-notation";

const OFFICIAL_DIR = "scripts/qa/reports/official-answers";
const HWP_DIRS = (process.env.HWP_DIR ?? "scripts/qa/reports/hwp-b").split(",");
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
  const files: Array<[string, string]> = [];
  for (const dir of HWP_DIRS) {
    try {
      for (const f of await readdir(dir)) {
        if (f.endsWith(".json")) files.push([dir, f]);
      }
    } catch {
      // 그 디렉터리가 아직 없을 수 있다(트랙 D 가 도는 중).
    }
  }
  for (const [dir, file] of files) {
    const examId = Number(file.replace(/\.json$/, ""));
    if (!Number.isFinite(examId)) continue;
    let doc: { questions?: Array<{ number: number; answer: string | null }> };
    try {
      doc = JSON.parse(await readFile(`${dir}/${file}`, "utf-8"));
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
  console.log(`HWP 산출물 ${HWP_DIRS.join(" ")}`);
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
      const exact = third === row.ours;
      const entry = { ...row, hwp: third, dbEqualsHwpExactly: exact } as Row;
      if (hwpMatchesDb && hwpMatchesPdf) {
        push("PDF표기만다름", entry);
      } else if (hwpMatchesDb && !hwpMatchesPdf) {
        push("원본두필드가갈림", entry);
      } else if (!hwpMatchesDb && hwpMatchesPdf) {
        push("이관누락", entry);
      } else {
        push("셋다다름", entry);
      }
    }
  }

  const exactRows = [...verdicts.values()]
    .flat()
    .filter((r) => (r as Row & { hwp?: string }).hwp !== undefined);
  const exact = exactRows.filter(
    (r) => (r as Row & { dbEqualsHwpExactly?: boolean }).dbEqualsHwpExactly,
  ).length;
  const total = target.reduce((n, g) => n + g.count, 0);
  if (exactRows.length > 0) {
    console.log(
      `
DB 정답이 HWP 원본과 **글자까지 같음** ${exact} / ${exactRows.length}` +
        ` — 이관이 원본을 그대로 실었다는 뜻이다(HWP 는 독립 출처가 아니다).`,
    );
  }
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
        hwpDirs: HWP_DIRS,
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
