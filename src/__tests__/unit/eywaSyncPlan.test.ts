/**
 * eywa 동기화 — **순수 계획 로직** (연계 1단계, 계획 3판 §4).
 *
 * DB 를 만지기 전에 결정되는 것 전부: 주반 · 반 학년 · 학교 필드 · 보고서 한 건이
 * 남길 진도 행 · createdAt 결정성. 적대적 리뷰가 잡은 자리들이 그대로 시험이 됐다:
 *
 *  - grok #7  «nearOrderIndex 이음을 동기화도 물려받아야 한다»
 *  - grok #9  «같은 트랜잭션이면 createdAt 이 다 같아 현재 진도가 비결정»
 *  - codex #25 «다중 수학반(실측 69%)을 단일 FK 로 어떻게 받나»
 */
import { describe, expect, it } from "vitest";

import {
  buildUnitIndex,
  resolveProgressText,
} from "@/lib/eywa/resolveProgress";
import type { UnitRow } from "@/lib/eywa/resolveProgress";
import {
  classGradeOf,
  planStudentProgress,
  primaryClassOf,
  schoolFieldsOf,
  unitsToRecord,
} from "@/lib/eywa/syncPlan";

const UNITS: UnitRow[] = [
  {
    id: "u160",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "다면체",
    orderIndex: 160,
  },
  {
    id: "u161",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "정다면체",
    orderIndex: 161,
  },
  {
    id: "u162",
    grade: "중1",
    chapter: "7. 입체도형",
    section: "회전체",
    orderIndex: 162,
  },
  {
    id: "u190",
    grade: "중2",
    chapter: "3. 방정식",
    section: "연립방정식의 풀이의 응용",
    orderIndex: 190,
  },
  {
    id: "u191",
    grade: "중2",
    chapter: "3. 방정식",
    section: "해가 특수한 연립방정식",
    orderIndex: 191,
  },
];
const index = buildUnitIndex(UNITS);

describe("[primaryClassOf] 주반 — 다중 수학반 133명(69%)의 귀속", () => {
  it("startDate 최신 반이 주반이다", () => {
    expect(
      primaryClassOf([
        { id: "a", name: "중등M 개별", startDate: "2026-03-01" },
        { id: "b", name: "특강반", startDate: "2026-07-01" },
      ])?.id,
    ).toBe("b");
  });

  /** 🔴 동률이면 이름 사전순 — **결정적**이어야 돌릴 때마다 반이 안 바뀐다. */
  it("startDate 동률이면 이름 사전순", () => {
    expect(
      primaryClassOf([
        { id: "a", name: "나반", startDate: "2026-03-01" },
        { id: "b", name: "가반", startDate: "2026-03-01" },
      ])?.id,
    ).toBe("b");
  });

  it("startDate 가 null 이면 뒤로 민다", () => {
    expect(
      primaryClassOf([
        { id: "a", name: "가", startDate: null },
        { id: "b", name: "나", startDate: "2020-01-01" },
      ])?.id,
    ).toBe("b");
    expect(primaryClassOf([])).toBeNull();
  });
});

describe("[classGradeOf] 반 학년 — eywa 반에는 학년이 없다 (grok #10)", () => {
  it("소속 학생 학년의 최빈값", () => {
    expect(classGradeOf(["중2", "중2", "중1"])).toBe("중2");
  });

  /** 동률이면 낮은 학년 — 시험 범위가 넓어지는 쪽보다 좁아지는 쪽이 안전하다. */
  it("동률이면 낮은 학년", () => {
    expect(classGradeOf(["중1", "중2"])).toBe("중1");
    expect(classGradeOf(["초6", "중1"])).toBe("초6");
  });

  it("null 은 세지 않고, 전부 null 이면 null", () => {
    expect(classGradeOf([null, "고1", null])).toBe("고1");
    expect(classGradeOf([null, null])).toBeNull();
    expect(classGradeOf([])).toBeNull();
  });
});

describe("[schoolFieldsOf] 학년 문자열 → 학교 필드", () => {
  it("중·고는 level+grade 로 갈라진다", () => {
    expect(schoolFieldsOf("중2")).toEqual({
      schoolLevel: "중",
      schoolGrade: 2,
    });
    expect(schoolFieldsOf("고1")).toEqual({
      schoolLevel: "고",
      schoolGrade: 1,
    });
  });

  /** 초등은 내신이 없어 '오늘의 시험' 대상이 아니다 — level 을 비운다(스키마 주석). */
  it("초등·미상은 null", () => {
    expect(schoolFieldsOf("초6")).toEqual({
      schoolLevel: null,
      schoolGrade: null,
    });
    expect(schoolFieldsOf(null)).toEqual({
      schoolLevel: null,
      schoolGrade: null,
    });
    expect(schoolFieldsOf("예비중")).toEqual({
      schoolLevel: null,
      schoolGrade: null,
    });
  });
});

describe("[unitsToRecord] 보고서 한 건이 남길 진도 행", () => {
  it("차시는 그 단원 그대로", () => {
    const v = resolveProgressText(index, "수학 다면체\n정다면체");
    expect(unitsToRecord(v).map((u) => u.unitId)).toEqual(["u160", "u161"]);
  });

  /**
   * 🔴 «총괄»은 대단원을 **끝냈다**는 뜻 — 대표는 그 장의 마지막 단원.
   *    «대단원»만 적힌 날은 어디까지 갔는지 모른다 — 대표는 **첫 단원**(보수적).
   *    반대로 하면 안 배운 단원이 시험 범위에 들어간다.
   */
  it("총괄은 장 끝, 맨 대단원은 장 첫 단원", () => {
    const 총괄 = resolveProgressText(index, "1.입체도형 대단원 총괄");
    expect(unitsToRecord(총괄).map((u) => u.unitId)).toEqual(["u162"]);
    const 대단원 = resolveProgressText(index, "수학 입체도형");
    expect(unitsToRecord(대단원).map((u) => u.unitId)).toEqual(["u160"]);
  });

  it("애매·시험기간·미분류는 아무 행도 안 남긴다", () => {
    expect(unitsToRecord(resolveProgressText(index, "수학 월말평가"))).toEqual(
      [],
    );
    expect(
      unitsToRecord(resolveProgressText(index, "알 수 없는 교재")),
    ).toEqual([]);
  });

  it("같은 단원이 두 줄에 나와도 한 번만", () => {
    const v = resolveProgressText(index, "수학 회전체\n1.회전체");
    expect(unitsToRecord(v).map((u) => u.unitId)).toEqual(["u162"]);
  });
});

describe("[planStudentProgress] 한 학생의 보고서 나열 → 진도 행", () => {
  const 보고서 = (
    id: string,
    date: string,
    createdAt: string,
    progress: string,
  ) => ({
    id,
    studentId: "s1",
    reportDate: date,
    createdAt,
    progress,
    classId: null,
    makeupClassId: null,
  });

  it("보고서마다 (eywaReportId, unitId) 행이 나온다", () => {
    const plan = planStudentProgress(index, [
      보고서("r1", "2026-08-01", "2026-08-01T10:00:00Z", "수학 다면체"),
      보고서(
        "r2",
        "2026-08-02",
        "2026-08-02T10:00:00Z",
        "수학 정다면체\n회전체",
      ),
    ]);
    expect(plan.rows.map((r) => [r.eywaReportId, r.unitId])).toEqual([
      ["r1", "u160"],
      ["r2", "u161"],
      ["r2", "u162"],
    ]);
  });

  /**
   * 🔴 grok #9 — createdAt 이 같으면 «현재 진도»가 비결정이 된다.
   *    eywa 의 created_at 을 물려받고 줄 순서만큼 1ms 씩 민다. 그래야
   *    `getCurrentProgress`(recordedAt → createdAt 내림차순)가 **그날의 마지막
   *    진도**를 결정적으로 고른다.
   */
  it("createdAt 은 eywa created_at + 줄 순서 1ms — 마지막 줄이 «현재»가 된다", () => {
    const plan = planStudentProgress(index, [
      보고서(
        "r2",
        "2026-08-02",
        "2026-08-02T10:00:00.000Z",
        "수학 정다면체\n회전체",
      ),
    ]);
    expect(plan.rows.map((r) => r.createdAt.toISOString())).toEqual([
      "2026-08-02T10:00:00.000Z",
      "2026-08-02T10:00:00.001Z",
    ]);
    expect(plan.rows.at(-1)!.unitId).toBe("u162");
  });

  /**
   * 🔴 grok #7 — 앞 보고서가 정한 위치가 뒤 보고서의 «애매»를 갈라야 한다.
   *    이 이음을 끊으면 계량기의 「애매 0」이 제품에서 재현되지 않는다.
   */
  it("직전 보고서의 위치가 다음 보고서의 애매를 가른다", () => {
    const 겹침: UnitRow[] = [
      {
        id: "d1",
        grade: "초6",
        chapter: "1-1 분수의 나눗셈",
        section: "1-1-1 가",
        orderIndex: 100,
      },
      {
        id: "d2",
        grade: "초6",
        chapter: "2-1 분수의 나눗셈",
        section: "2-1-1 나",
        orderIndex: 200,
      },
    ];
    const idx2 = buildUnitIndex(겹침);
    const 이어짐 = planStudentProgress(idx2, [
      보고서("r1", "2026-08-01", "2026-08-01T10:00:00Z", "1.2-1-1 나"),
      보고서(
        "r2",
        "2026-08-02",
        "2026-08-02T10:00:00Z",
        "1.분수의 나눗셈 (단원) 총괄",
      ),
    ]);
    // r1 이 200 에 세워 놨으므로 r2 의 총괄은 2-1 로 갈린다 → 장 끝 = d2
    expect(이어짐.rows.map((r) => [r.eywaReportId, r.unitId])).toEqual([
      ["r1", "d2"],
      ["r2", "d2"],
    ]);
    expect(이어짐.ambiguous).toBe(0);

    // 이음 없이 총괄만 오면 애매로 남고 행이 안 나온다 — 세어서 보고한다.
    const 홀로 = planStudentProgress(idx2, [
      보고서(
        "r9",
        "2026-08-02",
        "2026-08-02T10:00:00Z",
        "1.분수의 나눗셈 (단원) 총괄",
      ),
    ]);
    expect(홀로.rows).toEqual([]);
    expect(홀로.ambiguous).toBe(1);
  });

  it("미분류는 행 없이 원문으로 세어진다 — 조용히 버리지 않는다", () => {
    const plan = planStudentProgress(index, [
      보고서(
        "r1",
        "2026-08-01",
        "2026-08-01T10:00:00Z",
        "수학 다면체\n알 수 없는 교재",
      ),
    ]);
    expect(plan.rows).toHaveLength(1);
    expect(plan.unresolved).toEqual(["알 수 없는 교재"]);
  });

  it("보고서 순서는 (reportDate, createdAt, id) — 계약의 정렬 그대로", () => {
    // 같은 날짜에 보고서 둘: createdAt 늦은 쪽이 뒤 = 그쪽이 «현재»
    const plan = planStudentProgress(index, [
      보고서("r1", "2026-08-01", "2026-08-01T14:00:00Z", "수학 회전체"),
      보고서("r2", "2026-08-01", "2026-08-01T10:00:00Z", "수학 다면체"),
    ]);
    expect(plan.rows.map((r) => r.eywaReportId)).toEqual(["r2", "r1"]);
  });
});
