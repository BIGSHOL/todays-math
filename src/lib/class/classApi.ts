import {
  classListResponseSchema,
  classResponseSchema,
  progressResponseSchema,
  studentListResponseSchema,
  studentResponseSchema,
  type ClassEntity,
  type ProgressEntity,
  type StudentEntity,
} from "@/contracts/class.contract";

async function parseOk<T>(
  res: Response,
  parse: (json: unknown) => T,
): Promise<T> {
  if (!res.ok) throw new Error("요청에 실패했습니다");
  return parse(await res.json());
}

export async function fetchClasses(): Promise<ClassEntity[]> {
  const res = await fetch("/api/classes?page=1&pageSize=100");
  const body = await parseOk(res, (json) =>
    classListResponseSchema.parse(json),
  );
  return body.data;
}

export async function fetchStudents(classId: string): Promise<StudentEntity[]> {
  const res = await fetch(
    `/api/students?classId=${classId}&page=1&pageSize=100`,
  );
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
  const body = await parseOk(res, (json) => classResponseSchema.parse(json));
  return body.data;
}
