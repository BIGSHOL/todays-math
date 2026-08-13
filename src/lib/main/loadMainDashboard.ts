import {
  classListResponseSchema,
  progressResponseSchema,
  type ClassEntity,
  type ProgressEntity,
} from "@/contracts/class.contract";
import {
  testListResponseSchema,
  type TestEntity,
} from "@/contracts/test.contract";

export type MainDashboardData = {
  classes: ClassEntity[];
  tests: TestEntity[];
  progressByClass: Record<string, ProgressEntity | null>;
};

async function parseOk<T>(
  res: Response,
  parse: (json: unknown) => T,
): Promise<T> {
  if (!res.ok) {
    throw new Error("목록을 불러오지 못했습니다");
  }
  return parse(await res.json());
}

export async function loadMainDashboard(): Promise<MainDashboardData> {
  const [classesRes, testsRes] = await Promise.all([
    fetch("/api/classes?page=1&pageSize=100"),
    fetch("/api/tests?page=1&pageSize=100"),
  ]);

  const classesBody = await parseOk(classesRes, (json) =>
    classListResponseSchema.parse(json),
  );
  const testsBody = await parseOk(testsRes, (json) =>
    testListResponseSchema.parse(json),
  );

  const progressEntries = await Promise.all(
    classesBody.data.map(async (cls) => {
      const res = await fetch(`/api/progress?classId=${cls.id}`);
      if (!res.ok) return [cls.id, null] as const;
      const body = progressResponseSchema.parse(await res.json());
      return [cls.id, body.data] as const;
    }),
  );

  return {
    classes: classesBody.data,
    tests: testsBody.data,
    progressByClass: Object.fromEntries(progressEntries),
  };
}
