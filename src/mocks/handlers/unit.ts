/**
 * MSW 핸들러 — 단원 목록 (S-04 확인테스트 범위).
 */
import { http, type HttpHandler } from "msw";

import { unitListResponseSchema } from "@/contracts/unit.contract";

import { MOCK_UNITS } from "../data";
import { jsonOk } from "./_helpers";

export const unitHandlers: HttpHandler[] = [
  http.get("/api/units", () =>
    jsonOk(unitListResponseSchema, { data: MOCK_UNITS }),
  ),
];
