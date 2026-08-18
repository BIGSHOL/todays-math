/**
 * MSW 핸들러 — 단원 목록 (S-04 확인테스트 범위).
 */
import { http, type HttpHandler } from "msw";

import { unitListResponseSchema } from "@/contracts/unit.contract";

import { MOCK_UNITS } from "../data";
import { jsonOk } from "./_helpers";

export const unitHandlers: HttpHandler[] = [
  // 계약(strictObject)에 있는 것만 내보낸다 — 실제 라우트도 `select` 로 같은 다섯 개만
  // 읽는다. MOCK_UNITS 에는 DB 컬럼인 `problemCodePrefix`(D-53)가 더 있다.
  http.get("/api/units", () =>
    jsonOk(unitListResponseSchema, {
      data: MOCK_UNITS.map(({ id, grade, chapter, section, orderIndex }) => ({
        id,
        grade,
        chapter,
        section,
        orderIndex,
      })),
    }),
  ),
];
