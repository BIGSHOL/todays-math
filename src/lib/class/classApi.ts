import type {
  ClassEntity,
  ProgressEntity,
  StudentEntity,
} from "@/contracts/class.contract";

/**
 * 계약 스키마를 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 *
 * 이 파일의 검증은 전부 `fetch` 응답이 온 뒤에 쓰인다. 그런데 정적 import 면
 * zod + 계약 모듈(279KB)이 클라이언트 진입 청크에 들어가 첫 페인트를 막는다.
 * 검증을 **없애지 않고** 필요한 시점으로 미루는 것이 이 헬퍼의 목적이다.
 * 번들러가 청크를 캐시하므로 두 번째 호출부터는 네트워크 비용이 없다.
 */
const classContract = () => import("@/contracts/class.contract");

async function parseOk<T>(
  res: Response,
  parse: (json: unknown) => T,
): Promise<T> {
  if (!res.ok) throw new Error("요청에 실패했습니다");
  return parse(await res.json());
}

export async function fetchClasses(): Promise<ClassEntity[]> {
  const res = await fetch("/api/classes?page=1&pageSize=100");
  const { classListResponseSchema } = await classContract();
  const body = await parseOk(res, (json) =>
    classListResponseSchema.parse(json),
  );
  return body.data;
}

export async function fetchStudents(classId: string): Promise<StudentEntity[]> {
  const res = await fetch(
    `/api/students?classId=${classId}&page=1&pageSize=100`,
  );
  const { studentListResponseSchema } = await classContract();
  const body = await parseOk(res, (json) =>
    studentListResponseSchema.parse(json),
  );
  return body.data;
}

export async function fetchProgress(
  classId: string,
): Promise<ProgressEntity | null> {
  const res = await fetch(`/api/progress?classId=${classId}`);
  if (res.status === 404) return null;
  const { progressResponseSchema } = await classContract();
  const body = await parseOk(res, (json) => progressResponseSchema.parse(json));
  return body.data;
}

export async function advanceProgress(
  classId: string,
): Promise<ProgressEntity> {
  const res = await fetch("/api/progress/advance", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classId }),
  });
  const { progressResponseSchema } = await classContract();
  const body = await parseOk(res, (json) => progressResponseSchema.parse(json));
  return body.data;
}

export async function recordProgress(
  classId: string,
  unitId: string,
): Promise<ProgressEntity> {
  const res = await fetch("/api/progress", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classId, unitId }),
  });
  const { progressResponseSchema } = await classContract();
  const body = await parseOk(res, (json) => progressResponseSchema.parse(json));
  return body.data;
}

export async function createStudent(
  classId: string,
  name: string,
): Promise<StudentEntity> {
  const res = await fetch("/api/students", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ classId, name }),
  });
  const { studentResponseSchema } = await classContract();
  const body = await parseOk(res, (json) => studentResponseSchema.parse(json));
  return body.data;
}

export async function createClass(
  name: string,
  grade: string,
): Promise<ClassEntity> {
  const res = await fetch("/api/classes", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name, grade }),
  });
  const { classResponseSchema } = await classContract();
  const body = await parseOk(res, (json) => classResponseSchema.parse(json));
  return body.data;
}
