import { mapUnitHint } from "./mapUnit";
import type {
  ImportDraft,
  ImportReport,
  ImportReportItem,
  UnitLike,
} from "./types";

export interface ClassifyOptions {
  /** true면 figure 포함 문항도 ok로 남긴다. 기본은 1차 제외 후 리포트. */
  includeFigures?: boolean;
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

  for (const draft of drafts) {
    if (draft.hasFigure && !options.includeFigures) {
      items.push({
        externalId: draft.externalId,
        source: draft.source,
        status: "skipped_figure",
        unitId: null,
        unitHint: draft.unitHint,
        reason: "figure 블록은 1차에서 제외하고 목록만 보고합니다.",
      });
      continue;
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

    classified.push({ ...draft, unitId: mapped.unitId });
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
      items,
    },
  };
}
