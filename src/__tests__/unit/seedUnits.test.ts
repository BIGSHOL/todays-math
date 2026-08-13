// T0.3 — 교육과정 단원 시드 데이터(prisma/seed-data/units.ts) 검증.
// 순수 데이터 배열만 검증한다 (DB 연결 없음 — Supabase 마이그레이션 대기 중이므로 여기서 절대 연결하지 않는다).
import { describe, expect, it } from "vitest";

import {
  CURRICULUM_UNITS,
  type UnitSeed,
} from "../../../prisma/seed-data/units";

// eywa(C:\Creative\eywa\src\features\onescreen\curriculum.ts) 원본 키 순서를 그대로 반영한
// 16개 학년/과목 블록 (초1~중3 9개 + 고등 7과목). 고등 로마자 표기는 아라비아 숫자로 변환했다.
const EXPECTED_GRADE_BLOCKS = [
  "초1",
  "초2",
  "초3",
  "초4",
  "초5",
  "초6",
  "중1",
  "중2",
  "중3",
  "공통수학1",
  "공통수학2",
  "대수",
  "미적분1",
  "확률과 통계",
  "기하",
  "미적분2",
] as const;

const ELEMENTARY_GRADES = ["초1", "초2", "초3", "초4", "초5", "초6"] as const;

describe("[T0.3] CURRICULUM_UNITS 시드 데이터", () => {
  it("최소 300개 이상의 단원(section=차시) 노드를 포함한다", () => {
    expect(CURRICULUM_UNITS.length).toBeGreaterThanOrEqual(300);
  });

  it("현재 eywa 소스 스냅샷 기준 총 735개 차시를 포함한다 (소스 변경 시 이 값도 함께 갱신)", () => {
    expect(CURRICULUM_UNITS.length).toBe(735);
  });

  it("orderIndex는 1부터 시작하는 전역 연속값이며 배열 위치와 정확히 일치한다", () => {
    CURRICULUM_UNITS.forEach((unit, idx) => {
      expect(unit.orderIndex).toBe(idx + 1);
    });
    const last = CURRICULUM_UNITS[CURRICULUM_UNITS.length - 1];
    expect(last?.orderIndex).toBe(CURRICULUM_UNITS.length);
  });

  it("orderIndex는 유일하다 (중복 없음)", () => {
    const orderIndexes = CURRICULUM_UNITS.map((u) => u.orderIndex);
    expect(new Set(orderIndexes).size).toBe(orderIndexes.length);
  });

  it("(grade, chapter, section) 조합은 유일하다 (중복 행 없음)", () => {
    const keys = CURRICULUM_UNITS.map(
      (u) => `${u.grade}\u0000${u.chapter}\u0000${u.section}`,
    );
    expect(new Set(keys).size).toBe(keys.length);
  });

  it("grade 값은 DB 컬럼(VarChar(10)) 길이를 초과하지 않는다", () => {
    for (const unit of CURRICULUM_UNITS) {
      expect(unit.grade.length).toBeLessThanOrEqual(10);
    }
  });

  it("chapter/section 값은 DB 컬럼(VarChar(100)) 길이를 초과하지 않는다", () => {
    for (const unit of CURRICULUM_UNITS) {
      expect(unit.chapter.length).toBeLessThanOrEqual(100);
      expect(unit.section.length).toBeLessThanOrEqual(100);
    }
  });

  it("초1~중3(9개) + 고등 7과목 = 16개 학년/과목 블록이 모두 존재한다", () => {
    const actualGrades = new Set(CURRICULUM_UNITS.map((u) => u.grade));
    for (const grade of EXPECTED_GRADE_BLOCKS) {
      expect(actualGrades.has(grade)).toBe(true);
    }
    expect(actualGrades.size).toBe(EXPECTED_GRADE_BLOCKS.length);
  });

  it("학년/과목 블록은 서로 뒤섞이지 않고 orderIndex 상에서 연속된 구간을 이룬다", () => {
    // grade가 바뀌었다가 이전 grade로 되돌아오면(비연속 구간) 실패.
    const seenAndClosed = new Set<string>();
    let prevGrade: string | null = null;
    for (const unit of CURRICULUM_UNITS) {
      if (unit.grade !== prevGrade) {
        expect(seenAndClosed.has(unit.grade)).toBe(false);
        if (prevGrade !== null) seenAndClosed.add(prevGrade);
        prevGrade = unit.grade;
      }
    }
  });

  it("고등 7과목은 공통수학1→공통수학2→대수→미적분1→확률과 통계→기하→미적분2 순으로 이어진다", () => {
    const highSchoolOrder = EXPECTED_GRADE_BLOCKS.slice(9); // 초1~중3 9개 이후
    const actualOrder: string[] = [];
    for (const unit of CURRICULUM_UNITS) {
      if (
        !highSchoolOrder.includes(
          unit.grade as (typeof highSchoolOrder)[number],
        )
      )
        continue;
      if (actualOrder[actualOrder.length - 1] !== unit.grade)
        actualOrder.push(unit.grade);
    }
    expect(actualOrder).toEqual(highSchoolOrder);
  });

  describe("초등(초1~초6) 차시 접두 번호와 orderIndex 순서 일관성", () => {
    // 초등 chapter는 "N-M 단원명"(예: "1-5 50까지의 수"), section은 "N-M-K 차시명"
    // (예: "1-5-1 10 알아보기") 형식 — eywa 원본 표기를 그대로 보존한다.
    const chapterPrefixRe = /^(\d+)-(\d+)\s/;
    const sectionPrefixRe = /^(\d+)-(\d+)-(\d+)\s/;

    it.each(ELEMENTARY_GRADES)(
      "%s: 모든 chapter/section이 접두 번호 형식을 따른다",
      (grade) => {
        const rows = CURRICULUM_UNITS.filter((u) => u.grade === grade);
        expect(rows.length).toBeGreaterThan(0);
        for (const row of rows) {
          expect(row.chapter).toMatch(chapterPrefixRe);
          expect(row.section).toMatch(sectionPrefixRe);
        }
      },
    );

    it.each(ELEMENTARY_GRADES)(
      "%s: section의 (N-M) 접두는 소속 chapter의 (N-M) 접두와 일치한다",
      (grade) => {
        const rows = CURRICULUM_UNITS.filter((u) => u.grade === grade);
        for (const row of rows) {
          const chapterMatch = chapterPrefixRe.exec(row.chapter);
          const sectionMatch = sectionPrefixRe.exec(row.section);
          expect([chapterMatch?.[1], chapterMatch?.[2]]).toEqual([
            sectionMatch?.[1],
            sectionMatch?.[2],
          ]);
        }
      },
    );

    it.each(ELEMENTARY_GRADES)(
      "%s: orderIndex가 증가할수록 section 접두 번호 (N,M,K)도 사전식으로 단조 증가한다",
      (grade) => {
        const rows = CURRICULUM_UNITS.filter((u) => u.grade === grade).sort(
          (a, b) => a.orderIndex - b.orderIndex,
        );
        const toTuple = (u: UnitSeed): [number, number, number] => {
          const m = sectionPrefixRe.exec(u.section);
          if (!m) throw new Error(`접두 번호 파싱 실패: ${u.section}`);
          return [Number(m[1]), Number(m[2]), Number(m[3])];
        };
        for (let i = 1; i < rows.length; i++) {
          const prev = toTuple(rows[i - 1]!);
          const curr = toTuple(rows[i]!);
          const prevKey = prev[0] * 1_000_000 + prev[1] * 1_000 + prev[2];
          const currKey = curr[0] * 1_000_000 + curr[1] * 1_000 + curr[2];
          expect(currKey).toBeGreaterThan(prevKey);
        }
      },
    );
  });
});
