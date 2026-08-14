import { http, type HttpHandler } from "msw";

import { metricsResponseSchema } from "@/contracts/metrics.contract";

import { jsonOk } from "./_helpers";

export const metricsHandlers: HttpHandler[] = [
  http.get("/api/metrics", () =>
    jsonOk(metricsResponseSchema, {
      data: {
        weekStart: "2026-08-08",
        weekEnd: "2026-08-14",
        printedDays: 2,
        printedCount: 3,
        unmodifiedCount: 2,
        unmodifiedRate: 2 / 3,
        avgGenerateToPrintSeconds: 360,
      },
    }),
  ),
];
