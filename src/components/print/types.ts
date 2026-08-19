export type TestPrintType = "daily" | "review";

export interface TestPrintProblem {
  id: string;
  orderIndex: number;
  content: string;
  answer: string;
  solution: string | null;
  /**
   * 출제 형식 — 객관식 | 단답형 | 서술형 (`Problem.questionType`).
   * 지면이 「서술형 n」·「단답형 n」 표시를 붙일지 여기서 갈린다
   * (`assignSubjectiveLabels`). 원본 시험지의 `서답형` 은 이 컬럼에서 이미
   * `서술형` 으로 합쳐져 있다 — 원본 표기 자체는 따로 기억한다(원장님 확정 2026-08-19).
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
  /**
   * `figureUrls` 와 **같은 순서·같은 길이**로 짝지은 **원본 지면 물리 폭(mm)**
   * (`Problem.figureSourceMm`). 「얼마로 그린다」의 유일한 근거다.
   *
   * 픽셀 폭은 우리가 몇 dpi 로 잘랐는지에 달려 있어 **크기의 근거가 못 된다** —
   * 원본 가로가 41~7,343px 이라 같은 삼각형이 문항마다 다른 크기로 인쇄된다.
   * 원본 지면에서 그 그림이 차지하던 물리 크기가 곧 출제자가 정한 크기다.
   * 근거: `docs/planning/tracks/figure-quality-brief.md` §9 · §14.
   *
   * ⚠️ **비면 «모른다»이고, 모르면 지면은 오늘 그대로 픽셀로 그린다**(회귀 0).
   *    규칙 한 곳: `src/lib/figurePrintSize.ts`.
   */
  figureSourceMm?: number[];
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
