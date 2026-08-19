import type { TestPrintProblem } from "@/components/print/types";

/**
 * 지면에 **유형 표시**를 붙이는 유형들. 객관식은 붙이지 않는다 — 보기가 곧 표시다.
 *
 * 원장님 확정(2026-08-19): 시험지 원본의 `서답형` 은 **서술형으로 합치고**,
 * `단답형` 은 **그대로 둔다.** 그래서 지면에 나가는 표시도 둘이다 —
 * 「서술형 n」과 **「단답형 n」**.
 */
export const LABELLED_TYPES = ["서술형", "단답형"] as const;

export type LabelledType = (typeof LABELLED_TYPES)[number];

export interface SubjectiveLabel {
  /** 지면에 찍히는 말. `questionType` 을 그대로 쓴다 — 옮겨 적지 않는다. */
  kind: LabelledType;
  /** **이 시험지에서의** 순번. 유형마다 따로 센다. */
  n: number;
}

/**
 * 객관식이 아닌 문항에 **지면 순번**을 매긴다.
 *
 * 배경: DB 본문에 `[서술형 3]` 같은 원본 시험지 라벨이 박혀 있었다(실측 8,436건).
 * 원장님 지시로 본문에서는 걷어내고, 대신 **문항을 배치할 때** 조판이 붙인다.
 *
 * 매기는 번호는 **이 시험지에서의 순번**이다. 원본 시험지의 `3` 은 새 시험지에서
 * 아무 뜻이 없고, 오히려 학생이 문항 번호로 오해한다.
 *
 * 🔴 **유형마다 따로 센다.** 한 통으로 세면 「서술형 1 · 단답형 2 · 서술형 3」처럼
 * 각 표시의 번호가 건너뛴다 — 학생은 「단답형 1」이 어디 갔는지 찾는다.
 *
 * `questionType` 이 비어 있으면 매기지 않는다 — 모르는 것을 서술형이라 단정하면
 * **틀린 표시**가 나가고, 그건 표시가 없는 것보다 나쁘다.
 */
export function assignSubjectiveLabels(
  problems: readonly TestPrintProblem[],
): Map<string, SubjectiveLabel> {
  const labels = new Map<string, SubjectiveLabel>();
  const next = new Map<LabelledType, number>();
  for (const problem of problems) {
    const kind = LABELLED_TYPES.find((t) => t === problem.questionType);
    if (!kind) continue;
    const n = (next.get(kind) ?? 0) + 1;
    next.set(kind, n);
    labels.set(problem.id, { kind, n });
  }
  return labels;
}
