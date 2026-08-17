import type { ClassEntity, ProgressEntity } from "@/contracts/class.contract";
import type { WeeklyMetrics } from "@/contracts/metrics.contract";
import type { TestEntity } from "@/contracts/test.contract";
import type { UnitEntity } from "@/contracts/unit.contract";

export type MainDashboardData = {
  classes: ClassEntity[];
  tests: TestEntity[];
  progressByClass: Record<string, ProgressEntity | null>;
  units: UnitEntity[];
  metrics: WeeklyMetrics;
};

async function loadContracts() {
  const [cls, test, unit, metrics] = await Promise.all([
    import("@/contracts/class.contract"),
    import("@/contracts/test.contract"),
    import("@/contracts/unit.contract"),
    import("@/contracts/metrics.contract"),
  ]);
  return {
    classListResponseSchema: cls.classListResponseSchema,
    progressResponseSchema: cls.progressResponseSchema,
    testListResponseSchema: test.testListResponseSchema,
    unitListResponseSchema: unit.unitListResponseSchema,
    metricsResponseSchema: metrics.metricsResponseSchema,
  };
}

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
  // 네 개의 응답과 **동시에** 계약 스키마를 불러온다 (성능 수리 C-1).
  // 정적 import 면 zod + 계약 모듈(279KB)이 메인 화면 초기 번들에 실려 첫 페인트를
  // 막는데, 검증은 응답이 온 뒤에나 쓰인다. 검증 자체는 하나도 줄이지 않는다.
  const [classesRes, testsRes, unitsRes, metricsRes, contracts] =
    await Promise.all([
      fetch("/api/classes?page=1&pageSize=100"),
      fetch("/api/tests?page=1&pageSize=100"),
      fetch("/api/units"),
      fetch("/api/metrics"),
      loadContracts(),
    ]);
  const {
    classListResponseSchema,
    progressResponseSchema,
    testListResponseSchema,
    unitListResponseSchema,
    metricsResponseSchema,
  } = contracts;

  const classesBody = await parseOk(classesRes, (json) =>
    classListResponseSchema.parse(json),
  );
  const testsBody = await parseOk(testsRes, (json) =>
    testListResponseSchema.parse(json),
  );
  const unitsBody = await parseOk(unitsRes, (json) =>
    unitListResponseSchema.parse(json),
  );
  const metricsBody = await parseOk(metricsRes, (json) =>
    metricsResponseSchema.parse(json),
  );

  const progressEntries = await Promise.all(
    classesBody.data.map(async (cls) => {
      const res = await fetch(`/api/progress?classId=${cls.id}`);
      if (res.status === 404) return [cls.id, null] as const;
      if (!res.ok) throw new Error("진도를 불러오지 못했습니다");
      const body = progressResponseSchema.parse(await res.json());
      return [cls.id, body.data] as const;
    }),
  );

  return {
    classes: classesBody.data,
    tests: testsBody.data,
    progressByClass: Object.fromEntries(progressEntries),
    units: unitsBody.data,
    metrics: metricsBody.data,
  };
}
