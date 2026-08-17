/**
 * POST/GET /api/progress — 진도 기록(이력 누적, append-only) · 현재 진도 조회.
 * 대응 계약: src/contracts/class.contract.ts §진도
 * ⚠️ PROGRESS는 수정/삭제 엔드포인트가 없다 — 진도 갱신은 항상 새 행을 추가하는 POST로
 *    표현한다(계약 파일 상단 주석 참조).
 *
 * 반/개별 이중 구조 해석(개별 진도 우선 적용, use_individual_progress)은
 * src/lib/progressResolver.ts의 순수 함수 getCurrentProgress()에 위임한다
 * (T4.2 출제 API와 동일 판정 로직을 공유하기 위함).
 */
import type { NextRequest } from "next/server";

import {
  progressQuerySchema,
  progressRecordRequestSchema,
  progressResponseSchema,
} from "@/contracts/class.contract";
import {
  jsonOk,
  notFoundError,
  unauthorizedError,
  validationError,
} from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { requireOwnedClass, requireOwnedStudentInClass } from "@/lib/ownership";
import { getCurrentProgress } from "@/lib/progressResolver";
import { serializeProgress } from "@/lib/serializers";
import { getSessionUser } from "@/lib/session";

// POST /api/progress — 진도 기록(반 전체 또는 개별 학생, 이력 누적)
export async function POST(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const body = await request.json().catch(() => undefined);
  const parsed = progressRecordRequestSchema.safeParse(body);
  if (!parsed.success) return validationError(parsed.error);

  const owned = await requireOwnedClass(parsed.data.classId, session.id);
  if (!owned.ok) return owned.response;

  if (parsed.data.studentId) {
    const studentOwned = await requireOwnedStudentInClass(
      parsed.data.studentId,
      parsed.data.classId,
      session.id,
    );
    if (!studentOwned.ok) return studentOwned.response;
  }

  const unit = await db.unit.findUnique({ where: { id: parsed.data.unitId } });
  if (!unit) return notFoundError("소단원");

  const created = await db.progress.create({
    data: {
      classId: parsed.data.classId,
      studentId: parsed.data.studentId ?? null,
      unitId: parsed.data.unitId,
      recordedAt: parsed.data.recordedAt
        ? new Date(parsed.data.recordedAt)
        : new Date(),
    },
  });

  return jsonOk(
    progressResponseSchema,
    { data: serializeProgress(created) },
    { status: 201 },
  );
}

// GET /api/progress?classId=&studentId= — 현재 진도 조회(개별 우선 적용)
export async function GET(request: NextRequest) {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();

  const url = new URL(request.url);
  const parsed = progressQuerySchema.safeParse(
    Object.fromEntries(url.searchParams),
  );
  if (!parsed.success) return validationError(parsed.error);

  const { classId, studentId } = parsed.data;

  const owned = await requireOwnedClass(classId, session.id);
  if (!owned.ok) return owned.response;

  let useIndividualProgress = false;
  if (studentId) {
    const studentOwned = await requireOwnedStudentInClass(
      studentId,
      classId,
      session.id,
    );
    if (!studentOwned.ok) return studentOwned.response;
    useIndividualProgress = studentOwned.data.useIndividualProgress;
  }

  // 🔴 PROGRESS 는 append-only 다 — 진도를 한 번 옮길 때마다 행이 하나씩 쌓인다.
  //    예전에는 그 이력을 **전부** 읽어 와서 `findLatestProgress` 가 JS 로 최신 1건을
  //    골랐다. 한 학기만 지나도 조회량이 계속 자란다. 정렬 키를 DB 로 내리고 1건만 읽는다.
  //    ⚠️ 정렬은 `findLatestProgress` 와 **글자 그대로 같아야 한다** — recordedAt(날짜)
  //    내림차순, 같은 날짜면 createdAt(기록 시각) 내림차순. 보조 키를 빠뜨리면 같은 날
  //    두 번 기록한 진도에서 "최신"이 아무거나 나온다.
  //    반/개별 구분은 그대로다 — 반 이력(studentId=null)과 개별 이력을 따로 읽어
  //    `getCurrentProgress` 가 use_individual_progress 로 고른다. 개별 이력이 0건이면
  //    take:1 이 빈 배열을 내므로 반 진도로 폴백하는 동작도 유지된다.
  const latestFirst = [
    { recordedAt: "desc" as const },
    { createdAt: "desc" as const },
  ];
  const [classProgress, studentProgress] = await Promise.all([
    db.progress.findMany({
      where: { classId, studentId: null },
      orderBy: latestFirst,
      take: 1,
    }),
    studentId
      ? db.progress.findMany({
          where: { classId, studentId },
          orderBy: latestFirst,
          take: 1,
        })
      : Promise.resolve([]),
  ]);

  const current = getCurrentProgress({
    classProgress: classProgress.map(serializeProgress),
    studentProgress: studentProgress.map(serializeProgress),
    useIndividualProgress,
  });

  if (!current) return notFoundError("진도 기록");

  return jsonOk(progressResponseSchema, { data: current });
}
