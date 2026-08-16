/**
 * '오늘의 시험' 화면 파생 규칙 — 순수 함수만 둔다 (T7.14).
 *
 * 여기 모은 이유: 이 화면이 지켜야 하는 계약은 대부분 "언제 숫자를 내지 **않는가**"이고,
 * 그 판단이 JSX 안에 흩어지면 다음 사람이 조건 하나를 지우면서 조용히 깨진다.
 * 근거 없는 확신이 이 기능의 가장 큰 위험이다(11 §4 — 개인 점수는 구조적 하한이 있고,
 * 시험지 평균은 아직 판정 불가다).
 *
 * 확정 근거: 05-design-system.md §8.7 (D-39~D-44) · docs/design/mockups/hifi-t70-todays-exam.html
 */
import type {
  ExamRoundSummary,
  ExamStageKey,
  ExamStageState,
  ExamStudentRow,
} from "./examScreen.contract";
import type { Blueprint, ScoreInterval } from "@/contracts/predictor.contract";

// ─────────────────────────────────────────────
// D-day
// ─────────────────────────────────────────────

const MS_PER_DAY = 86_400_000;

/** 날짜만 비교한다 — 시각이 섞이면 같은 날인데 D-1 이 나온다. */
function dayOrdinal(year: number, month1: number, day: number): number {
  return Date.UTC(year, month1 - 1, day) / MS_PER_DAY;
}

/**
 * 시행일까지 남은 날. 시행일이 없으면 **null** 이다 — 임의의 날짜를 지어내지 않는다.
 * @param examDate `YYYY-MM-DD`
 */
export function ddayLabel(
  examDate: string | null,
  today: Date = new Date(),
): string | null {
  if (!examDate) return null;
  const [year, month, day] = examDate.split("-").map(Number);
  if (!year || !month || !day) return null;

  const diff =
    dayOrdinal(year, month, day) -
    dayOrdinal(today.getFullYear(), today.getMonth() + 1, today.getDate());

  if (diff > 0) return `D-${diff}`;
  if (diff === 0) return "D-DAY";
  return `D+${-diff}`;
}

/** 정렬용 — 남은 날. 시행일이 없으면 null. */
export function daysUntil(
  examDate: string | null,
  today: Date = new Date(),
): number | null {
  if (!examDate) return null;
  const [year, month, day] = examDate.split("-").map(Number);
  if (!year || !month || !day) return null;
  return (
    dayOrdinal(year, month, day) -
    dayOrdinal(today.getFullYear(), today.getMonth() + 1, today.getDate())
  );
}

/**
 * 다가오는 회차를 가까운 순으로 먼저, 지난 회차를 그 뒤에 최근 순으로, 시행일 미정은 맨 뒤로.
 * 계기판은 "다음에 무엇을 준비하는가"를 보는 자리라 임박한 것이 위에 와야 한다.
 */
export function sortRounds(
  rounds: ExamRoundSummary[],
  today: Date = new Date(),
): ExamRoundSummary[] {
  return [...rounds].sort((a, b) => {
    const da = daysUntil(a.examDate, today);
    const db = daysUntil(b.examDate, today);
    if (da === null && db === null) return 0;
    if (da === null) return 1;
    if (db === null) return -1;

    const upcomingA = da >= 0;
    const upcomingB = db >= 0;
    if (upcomingA !== upcomingB) return upcomingA ? -1 : 1;
    // 다가오는 것끼리는 가까운 순, 지난 것끼리는 최근 순(=|D| 작은 순).
    return Math.abs(da) - Math.abs(db);
  });
}

// ─────────────────────────────────────────────
// 신뢰도 — 좌측 인셋 바 (D-42 · D-44)
// ─────────────────────────────────────────────

/**
 * 🔴 D-44: '오늘의 시험'의 인셋 바는 **신뢰도**다. 블루는 쓰지 않는다
 * (블루는 '오늘의 수학'에서 "지금 할 일"을 뜻한다). 3단계뿐이라 블루가 필요 없다.
 */
export type ConfidenceTier = "high" | "mid" | "low" | "unknown";

/** 이 이상이면 높음(그린). */
export const CONFIDENCE_HIGH = 0.7;
/** 이 이상이면 보통(옐로). 미만은 낮음(레드). */
export const CONFIDENCE_MID = 0.4;

export function confidenceTier(confidence: number | null): ConfidenceTier {
  if (confidence === null) return "unknown";
  if (confidence >= CONFIDENCE_HIGH) return "high";
  if (confidence >= CONFIDENCE_MID) return "mid";
  return "low";
}

const TIER_WORD: Record<ConfidenceTier, string> = {
  high: "높음",
  mid: "보통",
  low: "낮음",
  unknown: "미산출",
};

/** 색만으로 전달하지 않는다 — 단계를 말로, 값을 숫자로 병기한다(D-42). */
export function confidenceText(confidence: number | null): string {
  const tier = confidenceTier(confidence);
  if (tier === "unknown") return "신뢰도 미산출";
  return `신뢰도 ${TIER_WORD[tier]} ${confidence!.toFixed(2)}`;
}

/** 인셋 바 색 이름. 블루가 없다는 것이 이 타입의 요점이다(D-44). */
export type ConfidenceBarColor = "green" | "yellow" | "red" | "none";

const TIER_BAR: Record<ConfidenceTier, ConfidenceBarColor> = {
  high: "green",
  mid: "yellow",
  low: "red",
  unknown: "none",
};

export function confidenceBarColor(
  confidence: number | null,
): ConfidenceBarColor {
  return TIER_BAR[confidenceTier(confidence)];
}

// ─────────────────────────────────────────────
// 판정 가능 여부 — 이 화면의 핵심 계약
// ─────────────────────────────────────────────

/**
 * 예측을 숫자로 낼 수 있는 최소 근거 회차 수.
 *
 * 근거: 11 §8 backtest — 과거 1편만 있는 시리즈는 문항수 MAE 1.362 로 코호트 평균
 * (2.253)보다는 낫지만 4편+(1.079)와 차이가 크고, `evidenceCount === 0` 은 계약 주석대로
 * "전국 평균만으로 만든 것"이다. **1편은 학교 패턴이라고 부를 수 없다.**
 */
export const MIN_EVIDENCE_ROUNDS = 2;

export type Judgement = { available: boolean; reason: string | null };

/**
 * 회차 단위 판정. `available === false` 면 화면은 청사진·예상 점수를 **숫자로 내지 않고**
 * "예측 불가"와 그 이유를 적는다.
 */
export function roundJudgement(summary: ExamRoundSummary): Judgement {
  if (summary.evidenceCount < MIN_EVIDENCE_ROUNDS) {
    return { available: false, reason: "근거 부족" };
  }
  const tier = confidenceTier(summary.confidence);
  if (tier === "unknown") return { available: false, reason: "신뢰도 미산출" };
  if (tier === "low") return { available: false, reason: "신뢰도 낮음" };
  return { available: true, reason: null };
}

/**
 * 학생 단위 판정. 회차가 판정 가능해도 그 학생의 응답 표본이 없으면 개인 점수는 못 낸다
 * (11 §3 L3 — 단원별 θ 가 예측 정확도의 핵심인데 표본이 없으면 추정치가 없다).
 */
export function studentJudgement(
  row: ExamStudentRow,
  roundAvailable: boolean,
): Judgement {
  if (row.absent) return { available: false, reason: "미응시" };
  if (!row.prediction) return { available: false, reason: "예측 없음" };
  if (!roundAvailable) return { available: false, reason: "근거 부족" };
  if (row.prediction.riskFlags.includes("학생응답_부족")) {
    return { available: false, reason: "응답 부족" };
  }
  return { available: true, reason: null };
}

/** 숫자를 못 내는 자리에 적을 말. 빈칸으로 두지 않는다. */
export function unavailableText(judgement: Judgement): string {
  if (judgement.reason === "미응시") return "미응시";
  return `예측 불가 — ${judgement.reason ?? "사유 미상"}`;
}

// ─────────────────────────────────────────────
// 4단계 파이프라인 (D-42 — 색 점 + 라벨, 점이 앞)
// ─────────────────────────────────────────────

export const STAGE_NAMES: Record<ExamStageKey, string> = {
  blueprint: "청사진",
  paper: "문제지",
  grading: "채점",
  actual: "실점수",
};

export type StageState = "done" | "current" | "waiting";
export type StageView = {
  key: ExamStageKey;
  label: string;
  state: StageState;
};

function currentLabel(stage: ExamStageState): string {
  const name = STAGE_NAMES[stage.key];
  if (stage.progress) {
    return `${name} ${stage.progress.current}/${stage.progress.total}`;
  }
  switch (stage.key) {
    case "blueprint":
    case "paper":
      return `${name} 만들기`;
    case "grading":
      return `${name} 시작`;
    case "actual":
      return `${name} 입력`;
  }
}

/**
 * 단계 배열을 화면 표기로 바꾼다.
 *
 * 🔴 `available === false`(근거 부족) 이면 **'지금 할 일'을 지정하지 않는다.**
 *    권장하지 않는 회차에 파란 점을 찍어 원장님을 그쪽으로 보내지 않기 위해서다
 *    (Hi-fi 03행이 전 단계 무색인 이유).
 */
export function stageViews(
  stages: ExamStageState[],
  available: boolean,
): StageView[] {
  const currentIndex = available ? stages.findIndex((s) => !s.done) : -1;
  const started = stages.some((s) => s.done) || currentIndex >= 0;

  return stages.map((stage, i) => {
    if (stage.done) {
      return { key: stage.key, label: STAGE_NAMES[stage.key], state: "done" };
    }
    if (i === currentIndex) {
      return { key: stage.key, label: currentLabel(stage), state: "current" };
    }
    return {
      key: stage.key,
      // 아직 아무것도 시작하지 않은 회차는 '대기'를 붙이지 않고 이름만 적는다.
      label: started ? `${STAGE_NAMES[stage.key]} 대기` : STAGE_NAMES[stage.key],
      state: "waiting",
    };
  });
}

// ─────────────────────────────────────────────
// 예측 구간 막대 (D-40 구간 표기 · D-42 연속 막대 + 눈금)
// ─────────────────────────────────────────────

/** 막대 눈금 하한/상한. Hi-fi 시안의 "구간 60 — 100" 과 같은 값이다. */
export const INTERVAL_SCALE_MIN = 60;
export const INTERVAL_SCALE_MAX = 100;

const SCALE_SPAN = INTERVAL_SCALE_MAX - INTERVAL_SCALE_MIN;

function toPct(score: number): number {
  const clamped = Math.min(
    INTERVAL_SCALE_MAX,
    Math.max(INTERVAL_SCALE_MIN, score),
  );
  // 부동소수 잔재(32.499999…)를 없앤다 — 인라인 style 문자열에 그대로 나간다.
  return Math.round(((clamped - INTERVAL_SCALE_MIN) / SCALE_SPAN) * 10_000) / 100;
}

export type IntervalGeometry = {
  leftPct: number;
  widthPct: number;
  pointPct: number;
};

/** 회색 구간 막대 위에 점추정을 세로 눈금으로 얹기 위한 좌표(%) . */
export function intervalGeometry(
  interval: ScoreInterval,
  expectedScore: number,
): IntervalGeometry {
  const leftPct = toPct(interval.lower);
  const upperPct = toPct(interval.upper);
  return {
    leftPct,
    widthPct: Math.round((upperPct - leftPct) * 100) / 100,
    pointPct: toPct(expectedScore),
  };
}

/** 막대 옆에 병기하는 말 — 색·도형만으로 전달하지 않는다(D-42). */
export function intervalText(interval: ScoreInterval): string {
  return `${formatScore(interval.lower)}~${formatScore(interval.upper)}`;
}

/** 점수 표기 — 소수 배점이 흔하므로 정수면 정수로, 아니면 소수 한 자리로. */
export function formatScore(score: number): string {
  return Number.isInteger(score) ? String(score) : score.toFixed(1);
}

// ─────────────────────────────────────────────
// 잔차 (D-42)
// ─────────────────────────────────────────────

export type ResidualView = { hit: boolean; text: string };

/**
 * 구간 **안**이면 `+3 적중`, **밖**이면 `−13 빗나감`.
 * 관리 지표는 "±N점"이 아니라 **구간 적중률**이므로 적중 판정도 구간 기준이다(11 §4).
 * 경계값은 적중으로 센다 — coverage 정의(구간이 실제 값을 담는 확률)와 맞춘다.
 */
export function residualView(
  expectedScore: number,
  interval: ScoreInterval,
  actualScore: number | null,
): ResidualView | null {
  if (actualScore === null) return null;
  const delta = Math.round(actualScore - expectedScore);
  const hit = actualScore >= interval.lower && actualScore <= interval.upper;
  // U+2212(MINUS SIGN) — 하이픈과 달리 숫자 옆에서 폭이 맞는다(Hi-fi 표기 그대로).
  const sign = delta > 0 ? "+" : delta < 0 ? "−" : "";
  return { hit, text: `${sign}${Math.abs(delta)} ${hit ? "적중" : "빗나감"}` };
}

// ─────────────────────────────────────────────
// 청사진 요약 문장
// ─────────────────────────────────────────────

const TYPE_ABBR = [
  ["객관식", "객"],
  ["단답형", "단"],
  ["서술형", "서"],
] as const;

/** 예: `객18 단2 서4`. 0문항 유형은 적지 않는다. */
export function typeMixText(blueprint: Blueprint): string {
  return TYPE_ABBR.map(([key, abbr]) => {
    const count = blueprint.typeMix[key]?.count ?? 0;
    return count > 0 ? `${abbr}${formatCount(count)}` : null;
  })
    .filter((s): s is string => s !== null)
    .join(" ");
}

const DIFFICULTY_ORDER = ["하", "중", "상", "미표기"] as const;

/**
 * 예: `하9 중11 상4`.
 * ⚠️ `미표기`(원본에 난이도 표기가 없는 문항, 코퍼스의 14%)를 **숨기지 않는다** —
 * 숨기면 배분이 실제보다 확실해 보인다.
 */
export function difficultyMixText(blueprint: Blueprint): string {
  return DIFFICULTY_ORDER.map((key) => {
    const count = blueprint.difficultyMix[key]?.count ?? 0;
    return count > 0 ? `${key}${formatCount(count)}` : null;
  })
    .filter((s): s is string => s !== null)
    .join(" ");
}

/** 예: `이차방정식8 이차함수의 그래프5`. 문항이 많은 단원부터 상위 `limit` 개. */
export function unitMixText(blueprint: Blueprint, limit = 3): string {
  return [...blueprint.unitMix]
    .sort((a, b) => b.count - a.count)
    .slice(0, limit)
    .map((cell) => `${cell.topicRaw ?? "단원 미상"}${formatCount(cell.count)}`)
    .join(" ");
}

/** 청사진 예측값은 기댓값이라 소수가 나온다(계약 주석). 정수면 정수로 적는다. */
function formatCount(count: number): string {
  return Number.isInteger(count) ? String(count) : count.toFixed(1);
}

/** 예: `24문항 / 100점`. */
export function blueprintSizeText(blueprint: Blueprint): string {
  return `${formatCount(blueprint.questionCount)}문항 / ${formatScore(
    blueprint.totalScore,
  )}점`;
}

/** 회차 제목 — `정화중 3학년 · 25-2 중간`. 계기판·상세가 같은 문자열을 쓴다. */
export function roundTitle(summary: ExamRoundSummary): string {
  const { series, period } = summary;
  const year = String(period.year).slice(-2);
  return `${series.school} ${series.grade}학년 · ${year}-${period.semester} ${period.round}`;
}
