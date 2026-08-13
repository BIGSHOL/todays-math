export type TestPrintType = "daily" | "review";

export interface TestPrintProblem {
  id: string;
  orderIndex: number;
  content: string;
  answer: string;
  solution: string | null;
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
