/**
 * MSW 핸들러 — '오늘의 시험' 회차 조회 (T7.14).
 *
 * 대응 API 경로:
 *   GET /api/exam/rounds        — 계기판 목록
 *   GET /api/exam/rounds/{id}   — 회차 상세 (예측 | 실측)
 *
 * ⚠️ 실 Route Handler 는 T7.7(예측)·T7.10(실측)이 병렬로 만든다. 이 화면은 계약
 *    (src/components/exam/examScreen.contract.ts → predictor.contract.ts)만 보고 먼저 선다.
 *    경로 이름은 화면 조합 조회라 `/api/exam/*` 로 잡았다 — 실 API 와 이름이 다르면
 *    src/components/exam/examApi.ts 한 곳만 고치면 된다.
 */
import { http, type HttpHandler } from "msw";

import {
  examRoundDetailResponseSchema,
  examRoundListResponseSchema,
} from "@/components/exam/examScreen.contract";

import { MOCK_EXAM_ROUNDS, MOCK_EXAM_ROUND_DETAILS } from "../data/predictions";
import { jsonOk, notFoundError } from "./_helpers";

export const predictionHandlers: HttpHandler[] = [
  http.get("/api/exam/rounds", () =>
    jsonOk(examRoundListResponseSchema, { data: MOCK_EXAM_ROUNDS }),
  ),

  http.get("/api/exam/rounds/:id", ({ params }) => {
    const detail = MOCK_EXAM_ROUND_DETAILS[String(params.id)];
    if (!detail) return notFoundError("회차");
    return jsonOk(examRoundDetailResponseSchema, { data: detail });
  }),
];
