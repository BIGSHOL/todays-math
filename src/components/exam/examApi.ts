/**
 * '오늘의 시험' 조회 — 응답을 반드시 계약으로 parse 한다.
 *
 * 실 API(T7.7·T7.10)가 붙으면 **이 파일의 경로 상수만** 바뀐다. 화면은 계약 타입만 본다.
 */
import {
  examRoundDetailResponseSchema,
  examRoundListResponseSchema,
  type ExamRoundDetail,
  type ExamRoundSummary,
} from "./examScreen.contract";

const ROUNDS_PATH = "/api/exam/rounds";

export async function loadExamRounds(): Promise<ExamRoundSummary[]> {
  const res = await fetch(ROUNDS_PATH);
  if (!res.ok) throw new Error("회차 목록을 불러오지 못했습니다");
  return examRoundListResponseSchema.parse(await res.json()).data;
}

export async function loadExamRound(id: string): Promise<ExamRoundDetail> {
  const res = await fetch(`${ROUNDS_PATH}/${id}`);
  if (!res.ok) throw new Error("회차를 불러오지 못했습니다");
  return examRoundDetailResponseSchema.parse(await res.json()).data;
}
