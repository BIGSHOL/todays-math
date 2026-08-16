/** 단원 트리 한 행 — 행 하나가 소단원이다(중단원 행은 따로 없다). */
export type Unit = {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  /** 교육과정 전역 순서(1부터). 진도 기준 어긋남을 재는 자다. */
  orderIndex: number;
};
