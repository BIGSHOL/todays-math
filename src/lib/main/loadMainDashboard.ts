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
import {
  unitListResponseSchema,
  type UnitEntity,
} from "@/contracts/unit.contract";

export type MainDashboardData = {
  classes: ClassEntity[];
  tests: TestEntity[];
  progressByClass: Record<string, ProgressEntity | null>;
  units: UnitEntity[];
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
  const [classesRes, testsRes, unitsRes] = await Promise.all([
    fetch("/api/classes?page=1&pageSize=100"),
    fetch("/api/tests?page=1&pageSize=100"),
    fetch("/api/units"),
  ]);

  const classesBody = await parseOk(classesRes, (json) =>
    classListResponseSchema.parse(json),
  );
  const testsBody = await parseOk(testsRes, (json) =>
    testListResponseSchema.parse(json),
  );
  const unitsBody = await parseOk(unitsRes, (json) =>
    unitListResponseSchema.parse(json),
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
    units: unitsBody.data,
  };
}
