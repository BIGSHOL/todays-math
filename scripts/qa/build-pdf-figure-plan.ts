/**
 * HWP 정본으로 못 건진 기출 문항의 **PDF 회수 계획**을 만든다.
 *
 *   npx tsx scripts/qa/build-pdf-figure-plan.ts
 *
 * 선행: `npx tsx scripts/qa/build-pe-figure-targets.ts`
 * 출력: `scripts/qa/reports/pdf-figure-plan.json`
 *
 * ## 왜 좌표가 아니라 발문으로 찾나
 *
 * RPM 은 sumaek 이 `source_coords` 를 갖고 있어 「어느 쪽 어느 사각형」이 주어진다.
 * 기출은 그게 없다. 대신 **DB 본문이 있다** — 그 글자가 PDF 어느 쪽에 있는지 찾으면
 * 그것이 곧 좌표다. 판이 다르거나 쪽이 밀려도 글자를 따라가므로 어긋나지 않는다.
 *
 * ⚠️ 여기 걸리는 문항은 **PDF 좌표 검출기(`map-figures.py`)가 이미 놓친 것들**이다.
 *    같은 규칙을 다시 돌리면 같은 것을 놓친다. 그래서 오려내기는 RPM 쪽에서 쓰는
 *    「발문은 DB 본문에 있고 그림 라벨은 없다」 규칙을 쓴다(`crop-pdf-by-stem.py`).
 */
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * **사람이 보고 뺀 것.** 자동 검사가 다 잡지는 못한다 — 뺀 이유를 여기 적어 둔다.
 * 자동 규칙으로 바꿀 수 있게 되면 여기서 지운다.
 */
const REVIEWED_OUT: Record<string, string> = {
  "4105-2":
    "줄기와 잎 표가 «줄기» 열만 잡힌다 — 잎 열이 칸 밖이라 붙이면 못 푸는 그림이 나간다",
};

const TARGETS = "scripts/qa/reports/pe-figure-targets.json";
const PAIRS = "scripts/qa/reports/final-pairs.json";
const OUT = "scripts/qa/reports/pdf-figure-plan.json";

type Target = {
  id: string;
  externalId: string | null;
  questionNumber: number | null;
  sourceFile: string | null;
  content: string;
};

function main(): void {
  const targets = (
    JSON.parse(readFileSync(TARGETS, "utf8")) as { 목록: Target[] }
  ).목록;
  const pairs = (
    JSON.parse(readFileSync(PAIRS, "utf8")) as {
      pairs: { examId: number | string; pdf?: string | null }[];
    }
  ).pairs;
  const pdfByExam = new Map<string, string>();
  for (const p of pairs) if (p.pdf) pdfByExam.set(String(p.examId), p.pdf);

  const dropped: string[] = [];
  const plan: {
    id: string;
    externalId: string;
    e: string;
    q: number;
    pdf: string;
    content: string;
  }[] = [];
  let noPdf = 0;
  for (const t of targets) {
    if (!t.externalId) continue;
    if (REVIEWED_OUT[t.externalId]) {
      dropped.push(t.externalId);
      continue;
    }
    const e = t.externalId.split("-")[0]!;
    // 짝 목록의 PDF 를 먼저 쓰고, 없으면 `source_file` 자체가 PDF 인 경우를 쓴다.
    const cand =
      pdfByExam.get(e) ??
      (t.sourceFile?.toLowerCase().endsWith(".pdf") ? t.sourceFile : null);
    if (!cand || !existsSync(cand)) {
      noPdf++;
      continue;
    }
    plan.push({
      id: t.id,
      externalId: t.externalId,
      e,
      q: t.questionNumber ?? Number(t.externalId.split("-")[1] ?? 0),
      pdf: cand,
      content: t.content,
    });
  }

  writeFileSync(
    OUT,
    JSON.stringify(
      { 대상: targets.length, 문항수: plan.length, 목록: plan },
      null,
      1,
    ),
    "utf8",
  );
  console.log(
    `그림 유실 기출 ${targets.length}행 · PDF 정본이 있는 것 ${plan.length}행 ` +
      `(${new Set(plan.map((p) => p.e)).size}편) · PDF 없음 ${noPdf}행\n→ ${OUT}`,
  );
}

main();
