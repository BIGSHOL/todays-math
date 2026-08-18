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
  /**
   * `figureUrls` 와 **같은 순서**로 짝지은 원본 치수 `[w1,h1,w2,h2,…]`
   * (`Problem.figureDims`). 넘침 판정이 그림 높이를 계산하는 유일한 근거다 —
   * 브라우저는 판정 시점에 파일을 못 읽는다.
   *
   * ⚠️ 길이가 `figureUrls.length × 2` 가 아니면 **통째로 «모른다»로 받는다**
   *    (`parseFigureDimensions`). 짝이 어긋난 값을 흘리면 판정이 안다고 착각한다.
   */
  figureDims?: number[];
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
