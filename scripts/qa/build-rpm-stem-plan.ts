/**
 * RPM 그림 회수 — **좌표 없이, 발문으로** 찾는 계획.
 *
 *   npx tsx scripts/qa/build-rpm-stem-plan.ts
 *   npx tsx scripts/qa/build-rpm-stem-plan.ts --src .rpm-src   # 다른 교재 디렉터리
 *
 * 출력: `scripts/qa/reports/pdf-figure-plan.json` (`crop-pdf-by-stem.py` 입력)
 *
 * ## 언제 쓰나 — **좌표가 못 미칠 때만**
 *
 * 정본 6권이 `.rpm-src/` 에 있으면 `gate-rpm-crop.py` + `crop-rpm-from-pdf.py`
 * (좌표 경로)가 훨씬 정확하다. **그쪽을 먼저 쓴다.**
 *
 * 이 길은 좌표가 없거나 안 맞을 때를 위한 것이다:
 *  · 좌표 상자가 발문을 안 담은 소문항이라 관문을 못 지나는 행
 *  · 판이 달라 쪽이 안 맞는 사본밖에 없을 때
 *    (실측: 2015개정본에도 같은 문항이 들어 있다 — 중2-2 표본 19개 중 15개가
 *     20자 이상 이어서 일치. 쪽수가 160 vs 192 라 좌표는 못 쓰지만 글자는 따라간다.)
 *
 * ⚠️ 판이 다르면 **같은 문항이 숫자만 바뀌어 있을 수 있다.** 그래서 오려낸 뒤
 *    반드시 눈으로 본다. 본문 유사도가 1차 관문이고, 사람이 2차다.
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const PLAN_IN = "scripts/qa/reports/rpm-crop-plan.json";
const REPORT = "scripts/qa/reports/missing-figures.json";
const CONTENT = "scripts/qa/reports/rpm-crop-content.json";
const OUT = "scripts/qa/reports/pdf-figure-plan.json";

/**
 * sumaek 이 적어 둔 책 이름 → 실제 파일. **앞에 적힌 것부터** 쓴다.
 * 정본(`.rpm-src/`, 원장님 제공 22개정 6권)이 먼저고, 없으면 2015개정본으로 시도한다.
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
  "RPM 중학 1-2 학생용.pdf": [
    ".rpm-src/RPM 중학 1-2 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 1-2.pdf",
  ],
  "RPM 중학 2-2 학생용.pdf": [
    ".rpm-src/RPM 중학 2-2 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 2-2.pdf",
  ],
  "RPM 중학 3-1 학생용.pdf": [
    ".rpm-src/RPM 중학 3-1 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 3-1.pdf",
  ],
  "RPM 중학 3-2 학생용.pdf": [
    ".rpm-src/RPM 중학 3-2 학생용.pdf",
    "N:/개인/강아/교재자료/RPM/15/RPM 3-2.pdf",
  ],
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
