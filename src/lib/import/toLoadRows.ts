import { allowNonFinalSource, isFinalSource } from "./finalSource";
import type { ImportDraft } from "./types";

/** Prisma Problem.createMany에 넣을 최소 행. DB 클라이언트를 여기서 import하지 않는다. */
export interface ImportLoadRow {
  userId: string;
  unitId: string;
  source: ImportDraft["source"];
  difficulty: ImportDraft["difficulty"];
  problemType: ImportDraft["problemType"];
  content: string;
  answer: string;
  solution: string | null;
  reviewStatus: "approved";
  directUseAllowed: boolean;
  pool: "shared";

  // 원본 역추적 메타데이터 — 없으면 null 로 넣는다 (08-import-ledger.md).
  // 이 필드들이 빠지면 훼손 문항을 원본 시험지로 되짚을 수 없다.
  externalId: string | null;
  sourceFile: string | null;
  school: string | null;
  subject: string | null;
  examId: string | null;
  questionNumber: number | null;
  score: number | null;

  /** 원본에서 오려 온 그림 경로. 그림 없는 문항은 빈 배열. */
  figureUrls: string[];
  figureSource: string | null;
  /**
   * `figureUrls` 와 **같은 순서**로 짝지은 원본 치수 `[w1,h1,w2,h2,…]`.
   *
   * 인쇄 넘침 판정이 그림 높이를 계산하는 **유일한 근거**다 — 판정은 브라우저에서
   * 돌아 이미지 파일을 못 읽는다(`src/lib/printOverflow.ts`). 적재 때 안 채우면
   * 그 문항은 영원히 «모른다»가 되고, 실측으로 재현율이 96.1% → **60.4%** 로
   * 떨어진다(적대적 리뷰 ④ C · `eval-overflow-rules.ts --no-dims`).
   *
   * ⚠️ **한 장이라도 못 읽으면 통째로 빈 배열이다.** 반쪽 배열은 짝이 어긋나
   *    판정이 어차피 «모른다»로 받는데, 넣어 두면 «안다»고 착각할 여지만 남는다.
   */
  figureDims: number[];
}

export interface LoadRowSkip {
  externalId: string;
  reason: string;
}

export const IMPORT_TEXT_MAX = 10_000;

export interface ToLoadRowsOptions {
  /**
   * 그림 한 장의 원본 치수를 돌려준다. 못 읽으면 `null`.
   *
   * 파일 읽기를 주입으로 받는 이유: 이 함수는 순수해야 테스트가 쉽고, 적재
   * 스크립트만 `public/figures` 를 볼 수 있기 때문이다
   * (`scripts/import/load-classified.ts` 가 `readFigureDimensions` 를 넘긴다).
   */
  resolveDimensions?: (figureUrl: string) => [number, number] | null;
}

export function toLoadRows(
  classified: Array<ImportDraft & { unitId: string }>,
  userId: string,
  options: ToLoadRowsOptions = {},
): { rows: ImportLoadRow[]; skipped: LoadRowSkip[] } {
  const rows: ImportLoadRow[] = [];
  const skipped: LoadRowSkip[] = [];

  for (const draft of classified) {
    if (!draft.content.trim()) {
      skipped.push({
        externalId: draft.externalId,
        reason: "본문이 비어 있습니다.",
      });
      continue;
    }
    if (draft.content.length > IMPORT_TEXT_MAX) {
      skipped.push({
        externalId: draft.externalId,
        reason: `본문이 ${IMPORT_TEXT_MAX}자를 초과합니다.`,
      });
      continue;
    }
    if (draft.answer.length > IMPORT_TEXT_MAX) {
      skipped.push({
        externalId: draft.externalId,
        reason: `정답이 ${IMPORT_TEXT_MAX}자를 초과합니다.`,
      });
      continue;
    }
    // D-37 — 기출은 완료본에서만 추출한다. 스캔본은 OCR 훼손률이 5배다.
    if (
      draft.source === "past_exam" &&
      !isFinalSource(draft.sourceFile) &&
      !allowNonFinalSource()
    ) {
      skipped.push({
        externalId: draft.externalId,
        reason:
          "완료본이 아닌 원본입니다(D-37). 완료본이 없는 시험지라면 ALLOW_NON_FINAL_SOURCE=1로 허용하세요.",
      });
      continue;
    }

    rows.push({
      userId,
      unitId: draft.unitId,
      source: draft.source,
      difficulty: draft.difficulty,
      problemType: draft.problemType,
      content: draft.content,
      answer: draft.answer,
      solution: draft.solution,
      reviewStatus: "approved",
      directUseAllowed: draft.directUseAllowed,
      pool: "shared",
      externalId: draft.externalId || null,
      sourceFile: draft.sourceFile ?? null,
      school: draft.school ?? null,
      subject: draft.subject ?? null,
      examId: draft.examId ?? null,
      questionNumber: draft.questionNumber ?? null,
      score: draft.score ?? null,
      figureUrls: draft.figureUrls ?? [],
      figureSource: draft.figureSource ?? null,
      figureDims: figureDimensions(draft.figureUrls ?? [], options),
    });
  }

  return { rows, skipped };
}

/**
 * 그림 경로들의 치수를 짝지어 평탄 배열로. **한 장이라도 못 읽으면 빈 배열**이다 —
 * 짝이 어긋난 값을 흘리면 판정이 안다고 착각한다(`parseFigureDimensions`).
 */
function figureDimensions(
  figureUrls: readonly string[],
  options: ToLoadRowsOptions,
): number[] {
  if (figureUrls.length === 0 || !options.resolveDimensions) return [];
  const pairs = figureUrls.map((url) => options.resolveDimensions!(url));
  if (pairs.some((pair) => !pair)) return [];
  return pairs.flatMap((pair) => pair!);
}
