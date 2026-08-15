/**
 * 자동 채점 — 순수 함수. DB/AI에 의존하지 않는다(테스트 용이성 우선, 06-tasks.md T7.1).
 *
 * 채점 규칙:
 * - 객관식(selectedChoice != null): Problem.answer(정답 텍스트)와 선택 번호 문자열이 일치하면 정답.
 *   정답이면 배점 전액, 오답이면 0점.
 * - 서술형(essayScore != null): 0~100점(배점 대비 비율)으로 이미 채점되어 들어온다 —
 *   pointsEarned = essayScore/100 * 배점. ESSAY_PASS_THRESHOLD(60점) 이상이면 "정답"으로 집계한다
 *   (난이도 분포 통계용 — 부분점수 자체는 essayScore를 그대로 쓴다).
 * - 미답(둘 다 null): 오답·0점.
 *
 * 배점(maxPoints)은 Problem.score(원본 시험지 배점, 08-import-ledger.md 이관 메타데이터)를 쓰고,
 * 없으면(자작/AI 생성 문제 등) 응답 문항 수로 100점을 균등 배분한다.
 */
import type { Difficulty } from "@/contracts/common.contract";

/** 서술형 정답 판정 기준선(0~100점 중) — 잠정. 확정 필요 시 계약에 노출해 조정한다. */
export const ESSAY_PASS_THRESHOLD = 60;

export interface AnswerInput {
  problemId: string;
  selectedChoice: number | null;
  essayScore: number | null;
  sequence: number;
}

/** 채점에 필요한 문제 정보 — Prisma Problem row의 부분집합. */
export interface GradingProblem {
  id: string;
  unitId: string;
  difficulty: Difficulty;
  /** 정답 텍스트 — 객관식은 정답 선택 번호를 문자열로 저장한다고 전제(예: "3"). */
  answer: string;
  /** 원본 배점. 없으면 균등 배분. */
  score: number | null;
}

export interface GradedAnswer {
  problemId: string;
  sequence: number;
  selectedChoice: number | null;
  essayScore: number | null;
  isCorrect: boolean;
  pointsEarned: number;
  maxPoints: number;
  unitId: string;
  difficulty: Difficulty;
}

export interface GradeAnswersResult {
  graded: GradedAnswer[];
  score: number;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

export function gradeAnswers(
  answers: AnswerInput[],
  problems: GradingProblem[],
): GradeAnswersResult {
  const byId = new Map(problems.map((p) => [p.id, p]));
  const equalShare = answers.length > 0 ? 100 / answers.length : 0;

  const graded = answers.map((answer): GradedAnswer => {
    const problem = byId.get(answer.problemId);
    if (!problem) {
      throw new Error(`채점 대상 문제를 찾을 수 없습니다: ${answer.problemId}`);
    }
    const maxPoints = problem.score ?? equalShare;

    let isCorrect = false;
    let pointsEarned = 0;
    if (answer.essayScore !== null) {
      pointsEarned = (answer.essayScore / 100) * maxPoints;
      isCorrect = answer.essayScore >= ESSAY_PASS_THRESHOLD;
    } else if (answer.selectedChoice !== null) {
      isCorrect = String(answer.selectedChoice) === problem.answer.trim();
      pointsEarned = isCorrect ? maxPoints : 0;
    }
    // 둘 다 null(미답)이면 isCorrect=false, pointsEarned=0 기본값 유지.

    return {
      problemId: answer.problemId,
      sequence: answer.sequence,
      selectedChoice: answer.selectedChoice,
      essayScore: answer.essayScore,
      isCorrect,
      pointsEarned: round2(pointsEarned),
      maxPoints: round2(maxPoints),
      unitId: problem.unitId,
      difficulty: problem.difficulty,
    };
  });

  const score = round2(graded.reduce((sum, g) => sum + g.pointsEarned, 0));
  return { graded, score };
}
