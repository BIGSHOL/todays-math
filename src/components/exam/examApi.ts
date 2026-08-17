/**
 * '오늘의 시험' 조회 — 응답을 반드시 계약으로 parse 한다.
 *
 * 실 API(T7.7·T7.10)가 붙으면 **이 파일의 경로 상수만** 바뀐다. 화면은 계약 타입만 본다.
 */
import type { ExamRoundDetail, ExamRoundSummary } from "./examScreen.contract";

/**
 * 계약 스키마는 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 *
 * `examScreen.contract` 는 zod 와 `predictor.contract`(blueprintSchema 등)를 끌어와
 * 계기판 초기 번들에 279KB 를 얹고 있었다. 여기서 하는 검증은 전부 `fetch` 응답이
 * 온 뒤라 그 시점에 불러도 늦지 않다. 검증 자체는 그대로 남는다.
 */
const examContract = () => import("./examScreen.contract");

const ROUNDS_PATH = "/api/exam/rounds";

/**
 * 실점수 저장은 **조회와 다른 축**이다. 조회는 화면 조합용(`/api/exam/*`)이고,
 * 저장은 보정 루프의 입력구(`/api/predictions/{runId}/actual`, T7.10)다.
 * 회차 id 는 `PredictionRun.id` 그대로라 그대로 넘긴다.
 */
const ACTUAL_PATH = (runId: string) => `/api/predictions/${runId}/actual`;

export async function loadExamRounds(): Promise<ExamRoundSummary[]> {
  const res = await fetch(ROUNDS_PATH);
  if (!res.ok) throw new Error("회차 목록을 불러오지 못했습니다");
  const { examRoundListResponseSchema } = await examContract();
  return examRoundListResponseSchema.parse(await res.json()).data;
}

export async function loadExamRound(id: string): Promise<ExamRoundDetail> {
  const res = await fetch(`${ROUNDS_PATH}/${id}`);
  if (!res.ok) throw new Error("회차를 불러오지 못했습니다");
  const { examRoundDetailResponseSchema } = await examContract();
  return examRoundDetailResponseSchema.parse(await res.json()).data;
}

/** 저장이 왜 실패했는지 — 서버가 준 말이 정본이다. 화면이 뭉개지 않는다. */
export class ActualScoreSaveError extends Error {}

/**
 * 한 학생의 실제 내신 점수를 저장한다. 같은 (회차, 학생)이면 **갱신**이다
 * — 원장이 잘못 넣은 점수를 고칠 수 있어야 한다(T7.10 계약).
 */
export async function saveActualScore(
  runId: string,
  studentId: string,
  actualScore: number,
): Promise<void> {
  const res = await fetch(ACTUAL_PATH(runId), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ scores: [{ studentId, actualScore }] }),
  });
  if (res.ok) return;

  let message = "점수를 저장하지 못했습니다";
  try {
    const body: unknown = await res.json();
    const server = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof server === "string" && server.trim()) message = server;
  } catch {
    // 본문이 없으면 위 기본 문구를 쓴다.
  }
  throw new ActualScoreSaveError(message);
}
