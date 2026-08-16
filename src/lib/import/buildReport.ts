import { mapUnitHint, normalizeGrade } from "./mapUnit";
import type {
  ImportDraft,
  ImportReport,
  ImportReportItem,
  UnitLike,
} from "./types";

export interface ClassifyOptions {
  /** true면 figure 포함 문항도 ok로 남긴다. 기본은 1차 제외 후 리포트. */
  includeFigures?: boolean;
  /**
   * 그림 문항의 그림 파일 경로를 찾아 준다. 경로를 돌려주면 그 문항은
   * 제외하지 않고 이관한다 — 완료본 PDF 에는 그림이 이미지로 심겨 있어
   * 다시 그릴 필요가 없기 때문이다(`scripts/figure/figure-manifest.json`).
   *
   * 못 찾으면 종전대로 제외한다. 그림 없이 본문만 들어간 문항은
   * "[그림] ..." 만 남아 **학생이 풀 수 없다**.
   *
   * 초안 전체를 넘긴다 — `externalId` 만 넘기면 받는 쪽이 형식을
   * (`<examId>-<번호>`) 가정하게 된다. 출처가 섞이면 그 가정이 조용히
   * 깨진다(2026-08-16 `build-discard-list` 사고). 받는 쪽이 `source` 로
   * 먼저 거를 수 있어야 한다.
   */
  resolveFigures?: (draft: ImportDraft) => string[] | undefined;
}

export function classifyDrafts(
  source: string,
  drafts: ImportDraft[],
  units: UnitLike[],
  gradeHint?: string | number,
  options: ClassifyOptions = {},
): {
  classified: Array<ImportDraft & { unitId: string }>;
  report: ImportReport;
} {
  const items: ImportReportItem[] = [];
  const classified: Array<ImportDraft & { unitId: string }> = [];
  const gradeLabels = new Set(units.map((unit) => unit.grade));
  let unresolvedGrade = 0;

  for (const draft of drafts) {
    const grade = normalizeGrade(draft.gradeHint ?? gradeHint);
    if (grade === null || !gradeLabels.has(grade)) unresolvedGrade += 1;

    // 대장을 **문항마다** 본다. 추출기(textlayer)의 `figure` 블록 유무로 조회를
    // 막으면 추출기가 놓친 그림이 영원히 안 붙는다 — 2026-08-16 실측으로 재연결
    // 대상 695건 중 690건이 이 구멍이었다. 대장(map-figures)은 좌표 기반이라
    // 추출기보다 정확하다. 제외 판정만 종전대로 `hasFigure` 를 본다.
    let figureUrls = options.resolveFigures?.(draft);
    if (figureUrls?.length === 0) figureUrls = undefined;
    if (draft.hasFigure) {
      if (!figureUrls && !options.includeFigures) {
        items.push({
          externalId: draft.externalId,
          source: draft.source,
          status: "skipped_figure",
          unitId: null,
          unitHint: draft.unitHint,
          reason: "그림 파일을 찾지 못해 제외합니다(본문만으론 풀 수 없음).",
        });
        continue;
      }
    }

    const mapped = mapUnitHint(
      draft.unitHint,
      units,
      draft.gradeHint ?? gradeHint,
    );
    if (mapped.status === "unclassified") {
      items.push({
        externalId: draft.externalId,
        source: draft.source,
        status: "unclassified",
        unitId: null,
        unitHint: draft.unitHint,
        reason: mapped.reason,
      });
      continue;
    }

    classified.push({
      ...draft,
      unitId: mapped.unitId,
      ...(figureUrls ? { figureUrls, figureSource: "source" as const } : {}),
    });
    items.push({
      externalId: draft.externalId,
      source: draft.source,
      status: "ok",
      unitId: mapped.unitId,
      unitHint: draft.unitHint,
    });
  }

  return {
    classified,
    report: {
      source,
      total: drafts.length,
      ok: items.filter((item) => item.status === "ok").length,
      unclassified: items.filter((item) => item.status === "unclassified")
        .length,
      skippedFigure: items.filter((item) => item.status === "skipped_figure")
        .length,
      unresolvedGrade,
      items,
    },
  };
}
