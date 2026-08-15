import type { Difficulty } from "@/contracts/common.contract";
import type { ProblemType } from "@/contracts/problem.contract";

export interface ContentBlock {
  type: string;
  value?: string;
}

export interface ImportDraft {
  externalId: string;
  source: "past_exam" | "manual" | "transformed";
  directUseAllowed: boolean;
  difficulty: Difficulty;
  problemType: ProblemType;
  content: string;
  answer: string;
  solution: string | null;
  unitHint: string;
  hasFigure: boolean;
  /** 문항별 학년/과목 힌트. classifyDrafts가 단원 매핑 범위를 좁힐 때 쓴다. */
  gradeHint?: string | number;

  // ── 원본 역추적 메타데이터 (전부 선택) ────────────────────────────
  // 추출 단계에는 있었는데 적재가 버리던 값들. 훼손 문항을 원본 시험지로
  // 되짚기 위해 DB까지 그대로 옮긴다. 참조: docs/planning/08-import-ledger.md
  /** N드라이브 원본 파일 경로 */
  sourceFile?: string | null;
  school?: string | null;
  subject?: string | null;
  /** 시험 식별자 — 예: `2023-donmun-2-1` */
  examId?: string | null;
  /** 원본 시험지에서의 문항 번호 */
  questionNumber?: number | null;
  /** 배점 */
  score?: number | null;

  // ── 원본에서 오려 온 그림 (phase/figures) ──────────────────────────
  /** `/figures/<examId>/qNN.jpg` 목록. 지면에 나온 순서. */
  figureUrls?: string[];
  /** engine(엔진 작도) / image(외부 보정본) / source(원본 오려옴) */
  figureSource?: "engine" | "image" | "source" | null;
}

export interface UnitLike {
  id: string;
  grade: string;
  chapter: string;
  section: string;
}

export type MapResult =
  | { status: "mapped"; unitId: string }
  | { status: "unclassified"; reason: string };

export interface ImportReportItem {
  externalId: string;
  source: ImportDraft["source"];
  status: "ok" | "unclassified" | "skipped_figure";
  unitId: string | null;
  unitHint: string;
  reason?: string;
}

export interface ImportReport {
  source: string;
  /**
   * 학년을 해석하지 못한 문항 수. 이 값이 크면 그 문항들은 초1~고3 전체
   * 풀에서 단원을 고른다 — 중3 문항이 초4 단원에 실린다(2026-08-15 실측 513건).
   * 조용히 지나가면 안 되므로 리포트에 숫자로 남긴다.
   */
  unresolvedGrade?: number;
  total: number;
  ok: number;
  unclassified: number;
  skippedFigure: number;
  items: ImportReportItem[];
}
