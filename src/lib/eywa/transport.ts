/**
 * eywa 데이터 가져오기 — **전송 계층** (계획 3판 §4.1·§4.7).
 *
 * 🔴 전송은 명시 스위치다: `EYWA_TRANSPORT=db|api`. **자동 폴백 금지** —
 *    키 하나 빠졌다고 조용히 전권 DB 로 내려가는 것은 fail-open 이다(codex #12).
 *    값이 없거나 다른 값이면 던진다.
 *
 * 두 전송은 **같은 모양**을 내놓는다(`RosterResponse`·진도 행 배열). 그래야
 * 그림자 실행(§3.4)이 db↔api diff 를 잴 수 있고, API 전환이 소비 코드를 안 바꾼다.
 */
import type { PrismaClient } from "@prisma/client";

import {
  progressResponseSchema,
  rosterResponseSchema,
  type ProgressResponse,
  type RosterResponse,
} from "@/lib/eywa/contract";
import { eywaQuery } from "@/lib/eywa/client";

export type EywaTransport = "db" | "api";

export function requiredTransport(
  value = process.env.EYWA_TRANSPORT,
): EywaTransport {
  if (value === "db" || value === "api") return value;
  throw new Error(
    `EYWA_TRANSPORT 가 "db" 또는 "api" 가 아니다 (지금: ${JSON.stringify(value)}). ` +
      "자동 폴백은 없다 — 어느 쪽을 쓰는지 명시하라.",
  );
}

export interface EywaSnapshot {
  roster: RosterResponse;
  reports: ProgressResponse["rows"];
  /** progress 첫 페이지의 total — «다 받았나» 검증에 쓴다. */
  progressTotal: number;
}

/* ────────────────────────── API 전송 ────────────────────────── */

const HTTP_TIMEOUT_MS = 60_000;
const RETRYABLE = new Set([429, 500, 502, 503, 504]);

async function apiGet(
  baseUrl: string,
  key: string,
  path: string,
): Promise<unknown> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (attempt > 0)
      await new Promise((r) => setTimeout(r, 2 ** attempt * 1_000));
    try {
      const res = await fetch(`${baseUrl}${path}`, {
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(HTTP_TIMEOUT_MS),
        redirect: "error", // 리다이렉트 = 잘못된 주소가 키를 남의 호스트로 나른다
      });
      if (RETRYABLE.has(res.status)) {
        lastError = new Error(`HTTP ${res.status}`);
        continue;
      }
      // 🔴 비-200 은 «빈 응답»이 아니라 **실패**다(grok #5). 401 이면 키,
      //    503 이면 eywa 쪽 env 미설정 — 사유가 다르니 그대로 올린다.
      if (!res.ok) throw new Error(`eywa API ${path} → HTTP ${res.status}`);
      return await res.json();
    } catch (error) {
      if (
        error instanceof Error &&
        /HTTP \d{3}$/.test(error.message) === false
      ) {
        lastError = error; // 네트워크·타임아웃 — 재시도
        continue;
      }
      throw error;
    }
  }
  throw new Error(`eywa API ${path} — 3회 실패: ${String(lastError)}`);
}

export async function fetchViaApi(
  baseUrl = process.env.EYWA_API_URL,
  key = process.env.EYWA_API_KEY,
): Promise<EywaSnapshot> {
  if (!baseUrl || !key) throw new Error("EYWA_API_URL / EYWA_API_KEY 가 없다.");
  const base = baseUrl.replace(/\/$/, "") + "/api/integrations/todays-math";

  const roster = rosterResponseSchema.parse(await apiGet(base, key, "/roster"));

  const reports: ProgressResponse["rows"] = [];
  let cursor: string | null = null;
  let progressTotal = 0;
  for (let page = 0; ; page += 1) {
    if (page > 1_000)
      throw new Error("progress 페이지가 1,000을 넘었다 — 커서 루프 의심");
    const path: string = cursor
      ? `/progress?cursor=${encodeURIComponent(cursor)}`
      : "/progress";
    const body = progressResponseSchema.parse(await apiGet(base, key, path));
    if (page === 0) progressTotal = body.total;
    reports.push(...body.rows);
    if (!body.nextCursor) break;
    cursor = body.nextCursor;
  }
  return { roster, reports, progressTotal };
}

/* ────────────────────────── DB 직결 전송 (과도기) ────────────────────────── */

/**
 * eywa API 와 **같은 의미**의 질의 — 그림자 실행이 이 둘을 diff 한다.
 * 여기 조건을 바꾸면 eywa `service.ts` 도 같이 바꿔야 한다(계약 §3.4).
 *
 * 테넌트 필터는 API 쪽 `TODAYS_MATH_TENANT_ID` 와 같은 값이어야 diff 가 선다.
 */
export async function fetchViaDb(
  client: PrismaClient,
  tenantId = process.env.EYWA_TENANT_ID,
): Promise<EywaSnapshot> {
  if (!tenantId)
    throw new Error("EYWA_TENANT_ID 가 없다 (db 전송의 테넌트 필터).");
  interface RosterRow {
    student_id: string;
    name: string;
    grade: string | null;
    school: string | null;
    class_id: string;
    class_name: string;
    start_date: string | null;
  }
  const rosterRows = await eywaQuery<RosterRow>(
    client,
    `select s.id student_id, s.name, s.grade, s.school,
            c.id class_id, c.class_name, e.start_date::text
       from enrollments e
       join classes c on c.id = e.class_id
        and c.tenant_id = e.tenant_id and c.subject = 'math'
        and c.is_active and c.closed_at is null
       join students s on s.id = e.student_id
        and s.tenant_id = e.tenant_id and s.status = 'enrolled' and not s.is_test
      where e.end_date is null and e.tenant_id = $1::uuid
      order by s.id, e.start_date, c.class_name`,
    tenantId,
  );
  const byStudent = new Map<string, RosterRow[]>();
  for (const row of rosterRows) {
    const list = byStudent.get(row.student_id) ?? [];
    list.push(row);
    byStudent.set(row.student_id, list);
  }
  const students = [...byStudent.entries()]
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([id, rows]) => ({
      id,
      name: rows[0]!.name,
      grade: rows[0]!.grade,
      school: rows[0]!.school,
      status: "enrolled" as const,
      classes: rows.map((r) => ({
        id: r.class_id,
        name: r.class_name,
        startDate: r.start_date,
      })),
    }));

  interface ReportRow {
    id: string;
    student_id: string;
    report_date: string;
    created_at: string;
    progress: string;
    class_id: string | null;
    makeup_class_id: string | null;
  }
  const reportRows = await eywaQuery<ReportRow>(
    client,
    `select r.id, r.student_id, r.report_date::text, r.created_at::text,
            r.progress, r.class_id, r.makeup_class_id
       from lesson_reports r
       join students s on s.id = r.student_id
        and s.tenant_id = r.tenant_id and s.status = 'enrolled' and not s.is_test
      where r.progress is not null and r.tenant_id = $1::uuid
      order by r.report_date, r.created_at, r.id`,
    tenantId,
  );
  const reports = reportRows.map((r) => ({
    id: r.id,
    studentId: r.student_id,
    reportDate: r.report_date,
    createdAt: r.created_at,
    progress: r.progress,
    classId: r.class_id,
    makeupClassId: r.makeup_class_id,
  }));

  return {
    roster: {
      generatedAt: new Date().toISOString(),
      total: students.length,
      students,
    },
    reports,
    progressTotal: reports.length,
  };
}
