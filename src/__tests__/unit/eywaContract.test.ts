/**
 * eywa 연계 API — 소비자 계약 시험 (codex #19).
 *
 * 픽스처는 2026-08-21 localhost:3100 실물 응답에서 **모양 그대로** 떴다
 * (이름·학교만 가명 — 저장소에 실명을 남기지 않는다). eywa 가 필드를 빼거나
 * 뜻을 바꾸면 여기가 빨개진다. 그때 고칠 곳은 이 시험이 아니라 **양쪽 합의**다.
 */
import { describe, expect, it } from "vitest";

import {
  progressResponseSchema,
  rosterResponseSchema,
} from "@/lib/eywa/contract";

/** 실물 응답의 모양 그대로 — 다중 반(실측 69%)·null 필드가 다 들어 있다. */
const ROSTER_FIXTURE = {
  generatedAt: "2026-08-21T05:46:11.000Z",
  total: 2,
  students: [
    {
      id: "00a6eb6f-386b-47df-8d35-9998572d4c92",
      name: "학생가",
      grade: "초4",
      school: "가나초",
      status: "enrolled",
      classes: [
        {
          id: "333b3ffb-da7f-40aa-9d3a-111111111111",
          name: "초등M 개별 A",
          startDate: "2026-03-02",
        },
        {
          id: "444c4ffc-eb8f-41bb-8e4b-222222222222",
          name: "초등M 개별 B",
          startDate: null,
        },
      ],
    },
    {
      id: "2d816419-49c6-4143-bd03-66c4e8122159",
      name: "학생나",
      grade: null,
      school: null,
      status: "enrolled",
      classes: [],
    },
  ],
};

const PROGRESS_FIXTURE = {
  total: 12293,
  rows: [
    {
      id: "31771f21-14a2-42dd-abc1-bf842aad1d34",
      studentId: "2d816419-49c6-4143-bd03-66c4e8122159",
      reportDate: "2025-11-03",
      createdAt: "2026-07-10T08:44:53.077778+00:00",
      progress: "수학 다면체\n정다면체",
      classId: null,
      makeupClassId: null,
    },
  ],
  nextCursor: "dG12MTo1MDA",
};

describe("[소비자 계약] eywa 응답 모양", () => {
  it("roster 실물 모양이 스키마를 통과한다", () => {
    expect(rosterResponseSchema.parse(ROSTER_FIXTURE).students).toHaveLength(2);
  });

  it("progress 실물 모양이 스키마를 통과한다", () => {
    const parsed = progressResponseSchema.parse(PROGRESS_FIXTURE);
    expect(parsed.rows[0]!.reportDate).toBe("2025-11-03");
  });

  /** 🔴 계약 위반은 **던져야** 한다 — 조용히 통과하면 그 실행이 DB 를 오염시킨다. */
  it("필드가 빠지거나 모양이 다르면 거부한다", () => {
    expect(() =>
      rosterResponseSchema.parse({ ...ROSTER_FIXTURE, total: "2" }),
    ).toThrow();
    const noClassId = { ...PROGRESS_FIXTURE.rows[0]! } as Record<
      string,
      unknown
    >;
    delete noClassId.classId;
    expect(() =>
      progressResponseSchema.parse({ ...PROGRESS_FIXTURE, rows: [noClassId] }),
    ).toThrow();
    expect(() =>
      progressResponseSchema.parse({
        ...PROGRESS_FIXTURE,
        rows: [{ ...PROGRESS_FIXTURE.rows[0]!, reportDate: "2025/11/03" }],
      }),
    ).toThrow();
  });

  it("모르는 상태값은 거부한다 — status 는 enrolled 뿐", () => {
    expect(() =>
      rosterResponseSchema.parse({
        ...ROSTER_FIXTURE,
        students: [{ ...ROSTER_FIXTURE.students[0]!, status: "withdrawn" }],
      }),
    ).toThrow();
  });
});
