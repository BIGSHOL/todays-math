import type { ImportReport, ImportReportItem } from "./types";

const STATUSES = new Set(["ok", "unclassified", "skipped_figure"]);
const SOURCES = new Set(["past_exam", "manual", "transformed"]);

function isItem(value: unknown): value is ImportReportItem {
  if (!value || typeof value !== "object") return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.externalId === "string" &&
    typeof item.source === "string" &&
    SOURCES.has(item.source) &&
    typeof item.status === "string" &&
    STATUSES.has(item.status) &&
    (item.unitId === null || typeof item.unitId === "string") &&
    typeof item.unitHint === "string"
  );
}

/** 파일로 저장한 적재 리포트를 검증해 읽는다. */
export function parseImportReport(raw: unknown): ImportReport {
  if (!raw || typeof raw !== "object") {
    throw new Error("리포트가 객체가 아닙니다.");
  }
  const report = raw as Record<string, unknown>;
  if (typeof report.source !== "string" || report.source.length === 0) {
    throw new Error("리포트 source가 없습니다.");
  }
  if (!Array.isArray(report.items) || !report.items.every(isItem)) {
    throw new Error("리포트 items 형식이 올바르지 않습니다.");
  }

  const items = report.items;
  const counted = {
    ok: items.filter((item) => item.status === "ok").length,
    unclassified: items.filter((item) => item.status === "unclassified").length,
    skippedFigure: items.filter((item) => item.status === "skipped_figure")
      .length,
  };

  return {
    source: report.source,
    total: typeof report.total === "number" ? report.total : items.length,
    ok: typeof report.ok === "number" ? report.ok : counted.ok,
    unclassified:
      typeof report.unclassified === "number"
        ? report.unclassified
        : counted.unclassified,
    skippedFigure:
      typeof report.skippedFigure === "number"
        ? report.skippedFigure
        : counted.skippedFigure,
    items,
  };
}

export interface ImportReportSummary {
  source: string;
  total: number;
  ok: number;
  unclassified: number;
  skippedFigure: number;
  okRate: number;
}

export function summarizeImportReport(
  report: ImportReport,
): ImportReportSummary {
  return {
    source: report.source,
    total: report.total,
    ok: report.ok,
    unclassified: report.unclassified,
    skippedFigure: report.skippedFigure,
    okRate: report.total === 0 ? 0 : report.ok / report.total,
  };
}

export function filterReportItems(
  report: ImportReport,
  status: ImportReportItem["status"],
): ImportReportItem[] {
  return report.items.filter((item) => item.status === status);
}

export function mergeImportReports(
  source: string,
  reports: ImportReport[],
): ImportReport {
  const items = reports.flatMap((report) => report.items);
  return {
    source,
    total: reports.reduce((sum, report) => sum + report.total, 0),
    ok: reports.reduce((sum, report) => sum + report.ok, 0),
    unclassified: reports.reduce((sum, report) => sum + report.unclassified, 0),
    skippedFigure: reports.reduce(
      (sum, report) => sum + report.skippedFigure,
      0,
    ),
    items,
  };
}
