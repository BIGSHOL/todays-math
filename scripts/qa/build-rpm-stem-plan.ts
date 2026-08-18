/**
 * RPM 그림 회수 — **좌표 없이, 발문으로** 찾는 계획.
 *
 *   npx tsx scripts/qa/build-rpm-stem-plan.ts
 *   npx tsx scripts/qa/build-rpm-stem-plan.ts --src .rpm-src   # 다른 교재 디렉터리
 *
 * 출력: `scripts/qa/reports/pdf-figure-plan.json` (`crop-pdf-by-stem.py` 입력)
 *
 * ## 왜 이 길이 생겼나 — **판이 달라도 문항은 같다**
 *
 * 문서 16 §4.1 은 「22개정 학생용 4권이 없으면 619건은 못 한다」로 막혀 있었다.
 * 근거는 `source_coords` 였다 — 좌표는 **그 판, 그 쪽**에만 유효하니까.
 *
 * 그런데 좌표가 유일한 열쇠가 아니었다. N드라이브에 있는 **2015개정본**을 열어
 * 본문을 대 보니 같은 문항이 그대로 들어 있다(중2-2 표본 19개 중 15개가 20자 이상
 * 이어서 일치). 쪽수가 달라(160 vs 192) 좌표는 못 쓰지만, **글자를 따라가면 된다.**
 *
 * 그래서 기출에 쓰는 `crop-pdf-by-stem.py` 를 그대로 쓴다 — 그쪽도 좌표가 없어서
 * 발문으로 찾는다. 계획 모양만 맞춰 주면 된다.
 *
 * ⚠️ 판이 다르면 **같은 문항이 숫자만 바뀌어 있을 수 있다.** 그래서 오려낸 뒤
 *    반드시 눈으로 본다. 본문 유사도(`MIN_RUN`)가 1차 관문이고, 사람이 2차다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLAN_IN = "scripts/qa/reports/rpm-crop-plan.json";
const REPORT = "scripts/qa/reports/missing-figures.json";
const CONTENT = "scripts/qa/reports/rpm-crop-content.json";
const OUT = "scripts/qa/reports/pdf-figure-plan.json";

/**
 * sumaek 이 적어 둔 책 이름 → N드라이브의 **2015개정본**.
 * 22개정 학생용은 1-1·2-1 만 있다(문서 16 §4.1 ⛔②). 나머지 넷은 이 판으로 시도한다.
 */
const BOOKS: Record<string, string[]> = {
  "RPM 중학 1-1 학생용.pdf": [
    ".rpm-src/RPM 중학 1-1 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 1-1.pdf",
  ],
  "RPM 중학 2-1 학생용.pdf": [
    ".rpm-src/RPM 중학 2-1 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 2-1.pdf",
  ],
  "RPM 중학 1-2 학생용.pdf": ["N:/개인/강아/교재자료/RPM/15/RPM 1-2.pdf"],
  "RPM 중학 2-2 학생용.pdf": ["N:/개인/강아/교재자료/RPM/15/RPM 2-2.pdf"],
  "RPM 중학 3-1 학생용.pdf": ["N:/개인/강아/교재자료/RPM/15/RPM 3-1.pdf"],
  "RPM 중학 3-2 학생용.pdf": ["N:/개인/강아/교재자료/RPM/15/RPM 3-2.pdf"],
};

function main(): void {
  const rows = (
    JSON.parse(readFileSync(PLAN_IN, "utf8")) as {
      목록: { problemId: string; externalId: string; pdf: string }[];
    }
  ).목록;
  const content = JSON.parse(readFileSync(CONTENT, "utf8")) as Record<
    string,
    string
  >;
  // 이미 그림이 붙은 것은 뺀다 — 유실 목록에 없으면 회수가 끝난 것이다.
  const stillMissing = new Set(
    (
      JSON.parse(readFileSync(REPORT, "utf8")) as { 목록: { id: string }[] }
    ).목록.map((r) => r.id),
  );

  const plan: {
    id: string;
    externalId: string;
    e: string;
    q: number;
    pdf: string;
    content: string;
  }[] = [];
  const byBook: Record<string, number> = {};
  let done = 0;
  let noSrc = 0;
  for (const r of rows) {
    if (!stillMissing.has(r.problemId)) {
      done++;
      continue;
    }
    const book = path.basename(r.pdf);
    const src = (BOOKS[book] ?? []).find((p) => existsSync(p));
    if (!src) {
      noSrc++;
      continue;
    }
    byBook[book] = (byBook[book] ?? 0) + 1;
    plan.push({
      id: r.problemId,
      externalId: r.externalId,
      e: `rpm/${r.externalId}`,
      q: 0,
      pdf: src,
      content: content[r.problemId] ?? "",
    });
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      { 대상: rows.length, 문항수: plan.length, 목록: plan },
      null,
      1,
    ),
    "utf8",
  );
  console.log(
    `RPM 좌표 계획 ${rows.length}행 · 이미 회수 ${done} · 원본 없음 ${noSrc} · 시도 ${plan.length}\n` +
      Object.entries(byBook)
        .map(([b, n]) => `  ${b} ${n}행`)
        .join("\n") +
      `\n→ ${OUT}`,
  );
}

main();
