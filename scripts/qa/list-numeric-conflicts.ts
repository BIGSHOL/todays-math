/**
 * **양쪽 다 순수 수치인데 값이 다른** 문항만 뽑아 원장님이 훑을 표로 낸다 (트랙 B-1).
 *
 * 왜 이것만인가: 값 형태 불일치는 대부분 표기 차이로 걷혔고, 규칙이 못 걷은 것에도
 * 표기 차이가 섞여 있다(표본 26건 중 12건). 그런데 **양쪽이 순수 숫자인데 값이 다르면**
 * 표기로 설명할 여지가 없다 — 그대로 인쇄하면 학생이 틀린 답을 받는다.
 * 사람이 볼 목록은 이것 하나면 된다.
 *
 * **판단은 하지 않는다.** 다만 규칙으로 성격이 확실히 갈리는 것은 묶어 둔다:
 *   - `정답면에 우리 값도 있음` — 정답면 줄에 두 값이 다 나온다(추출이 하나만 골랐을 수 있다)
 *   - `자릿수 포함` — 한쪽이 다른 쪽의 앞자리다 (`14` ↔ `143`). 잘림 의심
 *   - `그 밖` — 두 값이 서로 무관하다
 *
 *   npx tsx scripts/qa/list-numeric-conflicts.ts
 *
 * 출력: docs/planning/tracks/track-b-numeric-conflicts.md
 * **문항 본문은 싣지 않는다.** 정답면 원문 조각만 넣는다.
 */
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";

import { canon, circledSet } from "./answer-notation";

const CLASSIFIED = "scripts/qa/reports/answer-mismatch-classified.json";
const OFFICIAL_DIR = "scripts/qa/reports/official-answers";
const PAIRS = "scripts/qa/reports/final-pairs.json";
const OUT = "docs/planning/14-answer-conflicts-review.md";
/** RPM(transformed) 번호 충돌. `recover-rpm-answers.ts` 가 자동 교정하지 않고 남긴 것. */
const RPM_CONFLICTS = "scripts/qa/reports/rpm-number-conflicts.json";

interface Row {
  id: string;
  externalId: string;
  ours: string;
  official: string;
}

interface Pair {
  examId: number;
  school?: string;
  grade?: string;
  subject?: string;
  year?: string | number;
  semester?: string | number;
  round?: string;
}

const NUMERIC = /^-?\d+(?:\.\d+)?$/;

/** 정답면 블록 원문. 표에 그대로 넣을 수 있게 한 줄로 접는다. */
function fold(text: string): string {
  return text
    .replace(/\s+/g, " ")
    .replace(/\|/g, "\\|")
    .trim()
    .slice(0, 70);
}

/** `14` 가 `143` 의 앞자리인지 — 자릿수가 잘린 낌새. */
function digitPrefix(a: string, b: string): boolean {
  const x = a.replace(/^-/, "");
  const y = b.replace(/^-/, "");
  return x !== y && (y.startsWith(x) || x.startsWith(y));
}

/** 정답면 줄에 우리 값이 **독립된 수**로 함께 나오는지. */
function mentionsOurs(blockText: string, ours: string): boolean {
  const n = ours.replace(/^-/, "");
  return new RegExp(`(?<![0-9.])${n}(?![0-9.])`).test(blockText);
}

async function main(): Promise<void> {
  const classified = JSON.parse(await readFile(CLASSIFIED, "utf-8")) as {
    rules: Array<{ rule: string; verdict: string; items: Row[] }>;
  };
  const pairs = new Map<number, Pair>(
    (
      JSON.parse(await readFile(PAIRS, "utf-8")) as { pairs: Pair[] }
    ).pairs.map((p) => [p.examId, p]),
  );

  const blocks = new Map<string, string>();
  for (const file of (await readdir(OFFICIAL_DIR)).filter((f) =>
    f.endsWith(".json"),
  )) {
    const doc = JSON.parse(await readFile(`${OFFICIAL_DIR}/${file}`, "utf-8"));
    for (const [number, item] of Object.entries(
      doc.items as Record<string, { text: string }>,
    )) {
      blocks.set(`${doc.examId}-${Number(number)}`, item.text ?? "");
    }
  }

  const rows = classified.rules
    .filter((g) => g.verdict === "진짜오답")
    .flatMap((g) => g.items)
    .filter((r) => {
      // ⚠️ `canon` 은 NFKC 라 원문자를 숫자로 바꾼다 — `③, ④` 가 `34` 가 된다.
      // 그대로 두면 복수정답 문항이 「수치가 갈렸다」로 섞인다(실측 15건).
      if (circledSet(r.ours).length > 0 || circledSet(r.official).length > 0) {
        return false;
      }
      return NUMERIC.test(canon(r.ours)) && NUMERIC.test(canon(r.official));
    });

  const groups = new Map<string, Row[]>();
  for (const row of rows) {
    const text = blocks.get(row.externalId) ?? "";
    const ours = canon(row.ours);
    const official = canon(row.official);
    const key = mentionsOurs(text, ours)
      ? "정답면에 우리 값도 있음"
      : digitPrefix(ours, official)
        ? "자릿수 포함"
        : "그 밖";
    if (!groups.has(key)) groups.set(key, []);
    (groups.get(key) as Row[]).push(row);
  }

  const line = (row: Row): string => {
    const examId = Number(row.externalId.slice(0, row.externalId.lastIndexOf("-")));
    const number = row.externalId.slice(row.externalId.lastIndexOf("-") + 1);
    const pair = pairs.get(examId);
    const where = pair
      ? `${pair.school ?? "?"} ${pair.grade ?? ""} ${pair.subject ?? ""} ${pair.year ?? ""}-${pair.semester ?? ""}-${pair.round ?? ""}`.replace(
          /\s+/g,
          " ",
        )
      : `examId ${examId}`;
    return `| ☐ | ${where} ${number}번 | \`${canon(row.ours)}\` | \`${canon(row.official)}\` | ${fold(blocks.get(row.externalId) ?? "")} |`;
  };

  const order = ["그 밖", "자릿수 포함", "정답면에 우리 값도 있음"];
  // RPM 번호 충돌은 출처가 달라 판단 기준도 다르다. 절을 나눠 싣는다.
  let rpm: Array<{ id: string; unit: string; grade: string; ours: string; origin: string }> = [];
  try {
    rpm = JSON.parse(await readFile(RPM_CONFLICTS, "utf-8"));
  } catch {
    // 아직 안 만들었으면 기출 절만 낸다.
  }

  const parts: string[] = [
    "# 14 — 사람이 봐야 할 정답 충돌 (원장님 확인용)",
    "",
    "**이 목록은 규칙으로 못 가른 것만 남긴 것이다. 규칙으로 갈린 것은 이미 반영됐다.**",
    "",
    `값 형태 불일치 1,131건 중 표기 차이로 설명되는 것은 전부 걷어냈고,`,
    `여기 남은 **${rows.length + rpm.length}건**은 표기로 설명할 여지가 없다 —`,
    "그대로 두면 학생 시험지에 틀린 답이 인쇄된다.",
    "",
    "출처가 둘이라 절을 나눴다. **판단 기준이 다르다.**",
    "",
    `- §1 기출 ${rows.length}건 — 학교가 인쇄한 정답면이 있다. 그게 정본이다`,
    `- §2 RPM ${rpm.length}건 — 정답면이 없다. 원본 문제은행 값과 우리 값이 갈렸다`,
    "",
    "왼쪽 칸 `☐` 에 표시해 주시면 됩니다 — `☑` 는 **바깥 출처 값이 맞다** 로 읽겠습니다.",
    "",
  ];
  parts.push(
    `## 1. 기출 — 값이 갈린 수치 정답 ${rows.length}건`,
    "",
    "- **우리 값** = 지금 DB 에 든 값 (완료본 HWP 의 정답 필드에서 옮겨 온 것)",
    "- **정답면 값** = 같은 시험지 PDF 뒤쪽, 학교가 인쇄한 정답면에서 읽은 값",
    "- **정답면 원문** = 그 줄을 그대로 옮긴 것. 문항 본문은 싣지 않았다",
    "",
  );
  for (const key of order) {
    const list = groups.get(key);
    if (!list || list.length === 0) continue;
    const why =
      key === "정답면에 우리 값도 있음"
        ? "정답면 줄에 두 값이 다 나온다. 추출이 그중 하나만 골랐을 수 있어 따로 묶었다."
        : key === "자릿수 포함"
          ? "한쪽이 다른 쪽의 앞자리다. 자릿수가 잘렸을 가능성이 있어 따로 묶었다."
          : "두 값이 서로 무관하다. 어느 쪽이 맞는지 지면을 봐야 한다.";
    parts.push(`### ${key} — ${list.length}건`, "", why, "");
    parts.push(
      "| | 시험지 · 문항 | 우리 값 | 정답면 값 | 정답면 원문 |",
      "|---|---|---|---|---|",
    );
    for (const row of list) parts.push(line(row));
    parts.push("");
  }
  if (rpm.length > 0) {
    parts.push(
      `## 2. RPM(문제은행) — 번호 충돌 ${rpm.length}건`,
      "",
      "기출과 달리 **학교 정답면이 없다.** 우리 값과 sumaek 원본 값이 갈렸고,",
      "`recover-rpm-answers.ts` 가 자동 교정하지 않고 남긴 것이다.",
      "우리 쪽이 복수정답으로 적혀 있는데 원본은 하나만 적은 꼴이 많다.",
      "",
      "| | 학년 · 단원 | 우리 값 | 원본 값 |",
      "|---|---|---|---|",
    );
    for (const row of rpm) {
      parts.push(
        `| ☐ | ${row.grade} ${row.unit} | \`${row.ours}\` | \`${row.origin}\` |`,
      );
    }
    parts.push("");
  }
  parts.push(
    "---",
    "",
    "재생성: `npx tsx scripts/qa/list-numeric-conflicts.ts`",
    "",
    "지면을 직접 보고 싶으시면 그 줄만 오려서 그림으로 냅니다 —",
    "`python scripts/qa/shot-official-answer.py <examId>-<번호> ...`",
    "",
  );

  await mkdir("docs/planning/tracks", { recursive: true });
  await writeFile(OUT, parts.join("\n"), "utf-8");

  console.log("── 값이 갈린 수치 정답 ──");
  console.log(`대상 ${rows.length}건`);
  for (const key of order) {
    const list = groups.get(key);
    if (list) console.log(`  ${key.padEnd(16)} ${list.length}`);
  }
  console.log(`→ ${OUT}`);
}

void main();
