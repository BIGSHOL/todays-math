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

  // ── 2026-08-19 · 한글이 찍은 PDF 에서 오려낸 20건을 전량 눈으로 보고 뺀 것 ──
  // 자동 검사 넷(발문 침입 · 선택지 표시 · 문장 · 다른 문항 번호)이 전부 통과시켰다.
  // 공통점: **잘린 것은 지면에서 티가 안 난다.** 완비 검사(`figure_rect`)는 `bleed`
  // 안에서만 「경계를 가로지르는 것」을 보므로, 표의 마지막 줄이 `BELOW_PT` 밖으로
  // 나가 있으면 **잘렸다는 사실 자체를 못 본다.**
  "3412-2":
    "달력에서 마지막 줄(28~31)이 잘렸다 — 선택지가 «24의 약수»·«8의 배수»라 답이 달라진다",
  "3531-18":
    "표 머리(첫 번째/두 번째/세 번째 · 학생 A/B)가 잘렸다 — 남은 것은 `6`·`7` 두 칸뿐이라 못 푼다",
  "4969-3":
    "도로망은 맞는데 **A·B 라벨이 없다** — 어디서 어디로 가는지 지면에 없으면 못 푼다",
  "5221-10":
    "장치 그림 넷은 맞는데 «<그림 1>»·«<그림 2>» 캡션이 잘렸다 — 발문이 그 이름으로 가리킨다",
  "5907-12":
    "포물선 그림은 맞는데 **<보기> 상자가 같이 들어왔다** — 본문에 이미 있어 지면에 두 번 나간다",
};

const TARGETS = "scripts/qa/reports/pe-figure-targets.json";
const PAIRS = "scripts/qa/reports/final-pairs.json";
const OUT = "scripts/qa/reports/pdf-figure-plan.json";
/**
 * `--hwp-pdf` — **한글에게 찍게 한 PDF**(`.hwp-pdf/<examId>.pdf`)를 원본으로 쓴다.
 *
 * 왜 따로 두나: 남은 행은 이미 `(완료).PDF` 에서 한 번 놓친 것들이다. 같은 입력을
 * 다시 넣으면 같은 것을 놓친다(이 파일 윗주석). 한글이 찍은 PDF 는 **다른 입력**이다 —
 * 그리기 개체가 벡터로 나오고, 애초에 PDF 정본이 없던 편도 생긴다.
 * (16-figure-recovery-ledger §3.9)
 */
const OUT_HWP = "scripts/qa/reports/pdf-figure-plan-hwp.json";
/** 이미 HWP BinData 로 회수한 행은 다시 오려낼 것이 없다. */
const RECOVERED = "scripts/qa/reports/figure-recover-plan.json";

type Target = {
  id: string;
  externalId: string | null;
  questionNumber: number | null;
  sourceFile: string | null;
  content: string;
};

function main(): void {
  const useHwpPdf = process.argv.includes("--hwp-pdf");
  const done = new Set<string>(
    existsSync(RECOVERED)
      ? (
          JSON.parse(readFileSync(RECOVERED, "utf8")) as {
            계획: { id: string }[];
          }
        ).계획.map((p) => p.id)
      : [],
  );
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
  let already = 0;
  for (const t of targets) {
    if (!t.externalId) continue;
    if (done.has(t.id)) {
      already++;
      continue;
    }
    if (REVIEWED_OUT[t.externalId]) {
      dropped.push(t.externalId);
      continue;
    }
    const e = t.externalId.split("-")[0]!;
    // 짝 목록의 PDF 를 먼저 쓰고, 없으면 `source_file` 자체가 PDF 인 경우를 쓴다.
    const cand = useHwpPdf
      ? `.hwp-pdf/${e}.pdf`
      : (pdfByExam.get(e) ??
        (t.sourceFile?.toLowerCase().endsWith(".pdf") ? t.sourceFile : null));
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
    useHwpPdf ? OUT_HWP : OUT,
    JSON.stringify(
      { 대상: targets.length, 문항수: plan.length, 목록: plan },
      null,
      1,
    ),
    "utf8",
  );
  const out = useHwpPdf ? OUT_HWP : OUT;
  console.log(
    `그림 유실 기출 ${targets.length}행` +
      ` · 이미 HWP BinData 로 회수 ${already}행` +
      ` · 사람이 뺌 ${dropped.length}행` +
      ` · ${useHwpPdf ? "한글이 찍은" : "정본"} PDF 가 있는 것 ${plan.length}행` +
      ` (${new Set(plan.map((p) => p.e)).size}편) · PDF 없음 ${noPdf}행`,
  );
  // 분모가 안 맞으면 조용히 빠진 행이 있다는 뜻이다.
  const counted = already + dropped.length + plan.length + noPdf;
  if (counted !== targets.length) {
    throw new Error(`분모가 안 맞는다: 대상 ${targets.length} ≠ 합 ${counted}`);
  }
  console.log(`→ ${out}`);
}

main();
