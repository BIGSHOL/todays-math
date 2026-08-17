export type TestPrintType = "daily" | "review";

export interface TestPrintProblem {
  id: string;
  orderIndex: number;
  content: string;
  answer: string;
  solution: string | null;
  /**
   * 출제 형식 — 객관식 | 단답형 | 서술형 (`Problem.questionType`).
   * 지면이 「서술형 n」 표시를 붙일지 여기서 갈린다(`assignEssayLabels`).
   * 본문에 박혀 있던 원본 라벨을 걷어낸 뒤로는 **이 값이 유일한 근거**다.
   */
  questionType?: string | null;
  /** 원본 시험지에서 오려 온 그림 경로들. 없으면 빈 배열. */
  figureUrls?: string[];
}

export interface TestPrintDocument {
  testId: string;
  testType: TestPrintType;
  testDate: string;
  className: string;
  section: string;
  todayGoal: string;
  conceptNote: string;
  problems: TestPrintProblem[];
}

export interface JaseupPrintMeta {
  academyName: string;
  title: string;
  examDate: string;
  todayGoal: string;
  conceptNote: string;
}

export type PrintPageKind = "questions" | "answers";
