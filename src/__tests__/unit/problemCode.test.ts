/**
 * 🔴 RED → 🟢 GREEN — D-53 문항 코드.
 *
 * 여기서 지키는 것은 **뜻 부분(prefix)을 만드는 규칙 하나**다. 무작위 4자와 부여
 * 시점은 DB 트리거의 몫이라 이 파일이 못 본다 — 그쪽은
 * `scripts/qa/verify-problem-code-wiring.ts` 가 실제 DB 에서 확인한다.
 *
 * 이 파일이 잠그는 것:
 *
 *  1. **학년/과목 목록을 손으로 쓰지 않았는가.** 정본(`prisma/seed-data/units.ts`)에서
 *     뽑은 학년 집합과 코드 표가 **정확히 같아야** 한다. 하나라도 어긋나면 빨개진다
 *     (CLAUDE.md 2026-08-18 「목록을 손으로 쓰면 세는 쪽과 고치는 쪽이 같이 눈이 먼다」).
 *  2. **학교급 문자** 초 E · 중 J · 고 H — 뒤섞으면 빨개진다.
 *  3. **헷갈리는 글자**(`0 O 1 I l`)가 무작위 집합에 없다 — 넣으면 빨개진다.
 *  4. **부류마다 다른 대단원 규칙** — 초등 `1-1 9까지의 수` 는 «학년-학기»이지 대단원
 *     번호가 아니다. 한 부류만 보고 만든 규칙이면 다른 부류에서 빨개진다.
 *  5. **735개 전량이 유일**하고 형식을 지킨다.
 *  6. **마이그레이션 SQL 이 이 규칙의 산출물인가** — 커밋된 SQL 을 다시 만들어 대조한다.
 *     한쪽만 고치면 빨개진다(「한 숫자를 두 곳이 쓰게 하라」).
 *
 * 대응 계약: src/contracts/problemCode.contract.ts
 * 근거: docs/planning/07-coding-convention.md D-53
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { CURRICULUM_UNITS } from "../../../prisma/seed-data/units";
import {
  GRADE_CODE_SEGMENT,
  PROBLEM_CODE_ALPHABET,
  PROBLEM_CODE_PATTERN,
  PROBLEM_CODE_SUFFIX_LENGTH,
  problemCodeSchema,
  unitCodePrefixSchema,
} from "@/contracts/problemCode.contract";
import {
  buildUnitCodePrefixes,
  renderUnitCodePrefixSql,
} from "@/lib/problemCode";

/** 정본에서 뽑는다 — 목록을 손으로 쓰지 않는다. */
const GRADES_IN_SEED = [...new Set(CURRICULUM_UNITS.map((u) => u.grade))];

describe("[D-53] 문항 코드 — 코드표는 정본에서 나온다", () => {
  it("코드표의 학년/과목이 시드 정본과 정확히 같다 (빠짐·군더더기 0)", () => {
    const inTable = Object.keys(GRADE_CODE_SEGMENT).sort();
    expect(inTable).toEqual([...GRADES_IN_SEED].sort());
  });

  it("학교급 문자는 초 E · 중 J · 고 H 다", () => {
    for (const grade of GRADES_IN_SEED) {
      const segment = GRADE_CODE_SEGMENT[grade];
      expect(segment, `${grade} 에 코드가 없다`).toBeDefined();
      const expected = grade.startsWith("초")
        ? "E"
        : grade.startsWith("중")
          ? "J"
          : "H";
      expect(segment![0], `${grade} → ${segment}`).toBe(expected);
    }
  });

  it("초·중은 학년 1자리, 고등은 과목 코드 2자리다", () => {
    for (const grade of GRADES_IN_SEED) {
      const segment = GRADE_CODE_SEGMENT[grade]!;
      if (grade.startsWith("초") || grade.startsWith("중")) {
        expect(segment).toHaveLength(2);
        expect(segment.slice(1)).toBe(grade.slice(1));
      } else {
        expect(segment).toHaveLength(3);
      }
    }
  });

  it("과목 코드는 서로 겹치지 않는다", () => {
    const values = Object.values(GRADE_CODE_SEGMENT);
    expect(new Set(values).size).toBe(values.length);
  });
});

describe("[D-53] 무작위 4자 집합", () => {
  it("헷갈리는 글자 0 O 1 I l 이 없다", () => {
    for (const ch of ["0", "O", "1", "I", "l"]) {
      expect(
        PROBLEM_CODE_ALPHABET.includes(ch),
        `${ch} 가 무작위 집합에 있다`,
      ).toBe(false);
    }
  });

  it("32자(=2^5)이고 중복이 없다 — 무작위 바이트를 치우침 없이 자를 수 있다", () => {
    expect(PROBLEM_CODE_ALPHABET).toHaveLength(32);
    expect(new Set(PROBLEM_CODE_ALPHABET).size).toBe(32);
  });

  it("길이는 4자다", () => {
    expect(PROBLEM_CODE_SUFFIX_LENGTH).toBe(4);
  });
});

describe("[D-53] 단원 → 코드 앞부분 (뜻 부분)", () => {
  const prefixes = buildUnitCodePrefixes(CURRICULUM_UNITS);
  const byKey = new Map(
    prefixes.map((p) => [`${p.grade}|${p.chapter}|${p.section}`, p.prefix]),
  );

  it("시드 전량(735)에 코드 앞부분이 붙는다", () => {
    expect(prefixes).toHaveLength(CURRICULUM_UNITS.length);
    expect(CURRICULUM_UNITS).toHaveLength(735);
  });

  it("735개가 전부 유일하다", () => {
    const set = new Set(prefixes.map((p) => p.prefix));
    expect(set.size).toBe(prefixes.length);
  });

  it("전부 형식을 지킨다", () => {
    for (const p of prefixes) {
      expect(
        unitCodePrefixSchema.safeParse(p.prefix).success,
        `${p.grade} ${p.chapter} ${p.section} → ${p.prefix}`,
      ).toBe(true);
    }
  });

  it("중·고는 대단원 앞 숫자를 그대로 쓴다", () => {
    // 중3 `5. 삼각비` 의 첫 소단원 → J3 05 01
    expect(byKey.get("중3|5. 삼각비|삼각비의 뜻")).toBe("J30501");
    // 공통수학1 `2. 방정식과 부등식` 은 소단원이 32개 — 2자리가 모자라지 않는다
    expect(byKey.get("공통수학1|2. 방정식과 부등식|복소수")).toBe("HC10201");
  });

  it("초등은 `1-1` 을 대단원 번호로 읽지 않는다 — orderIndex 순번으로 센다", () => {
    // 초1 은 1학기 5개(1-1~1-5) + 2학기 6개(2-1~2-6) = 11개 대단원.
    // `2-1 100까지의 수` 는 여섯 번째다. 앞 숫자를 그대로 읽으면 02 가 되어
    // `1-2 여러 가지 모양` 과 부딪친다.
    expect(
      byKey.get("초1|2-1 100까지의 수|2-1-1 60, 70, 80, 90 알아보기"),
    ).toBe("E10601");
    expect(
      byKey.get("초1|1-2 여러 가지 모양|1-2-1 여러 가지 모양 찾아보기"),
    ).toBe("E10201");
  });

  it("소단원 번호는 대단원 안에서의 순번이다", () => {
    const 중3삼각비 = prefixes
      .filter((p) => p.grade === "중3" && p.chapter === "5. 삼각비")
      .sort((a, b) => a.orderIndex - b.orderIndex);
    expect(중3삼각비.map((p) => p.prefix)).toEqual([
      "J30501",
      "J30502",
      "J30503",
    ]);
  });

  it("학교급·학년이 바뀌면 앞 두 자리가 바뀐다 (같은 대단원 번호라도)", () => {
    const 중1첫단원 = prefixes.find(
      (p) => p.grade === "중1" && p.prefix.endsWith("0101"),
    );
    const 중2첫단원 = prefixes.find(
      (p) => p.grade === "중2" && p.prefix.endsWith("0101"),
    );
    expect(중1첫단원!.prefix).toBe("J10101");
    expect(중2첫단원!.prefix).toBe("J20101");
  });

  it("코드표에 없는 학년이 들어오면 조용히 넘기지 않고 멈춘다", () => {
    expect(() =>
      buildUnitCodePrefixes([
        { grade: "고4", chapter: "1. 무엇", section: "무엇", orderIndex: 1 },
      ]),
    ).toThrow(/고4/);
  });

  it("중·고 대단원에 앞 숫자가 없으면 멈춘다 — 추측해서 넣지 않는다", () => {
    expect(() =>
      buildUnitCodePrefixes([
        {
          grade: "중1",
          chapter: "소인수분해",
          section: "소인수",
          orderIndex: 1,
        },
      ]),
    ).toThrow(/대단원 번호/);
  });
});

describe("[D-53] 문항 코드 형식", () => {
  it("초·중 코드를 받는다", () => {
    expect(problemCodeSchema.safeParse("J31402-K7M2").success).toBe(true);
    expect(problemCodeSchema.safeParse("E10601-Q4XZ").success).toBe(true);
  });

  it("고등 코드를 받는다 — 학년 자리에 과목 코드 2자", () => {
    expect(problemCodeSchema.safeParse("HC10305-Q4XZ").success).toBe(true);
    expect(problemCodeSchema.safeParse("HPS0301-K7M2").success).toBe(true);
  });

  it("구분자는 무작위 앞 하나뿐이다", () => {
    expect(problemCodeSchema.safeParse("J3-14-02-K7M2").success).toBe(false);
    expect(problemCodeSchema.safeParse("J31402K7M2").success).toBe(false);
  });

  it("헷갈리는 글자가 든 코드는 거절한다", () => {
    expect(problemCodeSchema.safeParse("J31402-K7M0").success).toBe(false);
    expect(problemCodeSchema.safeParse("J31402-K7MO").success).toBe(false);
    expect(problemCodeSchema.safeParse("J31402-K7M1").success).toBe(false);
    expect(problemCodeSchema.safeParse("J31402-K7MI").success).toBe(false);
  });

  it("소문자·모르는 과목 코드는 거절한다", () => {
    expect(problemCodeSchema.safeParse("j31402-K7M2").success).toBe(false);
    expect(problemCodeSchema.safeParse("J31402-k7m2").success).toBe(false);
    expect(problemCodeSchema.safeParse("HZZ0305-Q4XZ").success).toBe(false);
  });

  it("학교급 문자가 아닌 것으로 시작하면 거절한다", () => {
    expect(problemCodeSchema.safeParse("K31402-K7M2").success).toBe(false);
  });
});

describe("[D-53] 마이그레이션 SQL 은 이 규칙의 산출물이다", () => {
  const MIGRATION = join(
    process.cwd(),
    "prisma/migrations/20260818210000_problem_code/migration.sql",
  );
  // ⚠️ `core.autocrlf=true` 라 체크아웃하면 이 파일이 CRLF 가 된다. 줄바꿈을 맞춰 두지
  //    않으면 여러 줄을 대조하는 검사가 **다른 컴퓨터에서만** 빨개진다(여기서는 내가 LF 로
  //    썼으니 초록이다). Prisma 의 체크섬도 같은 이유로 CR 을 뺀 뒤 sha256 을 잡는다.
  const sql = readFileSync(MIGRATION, "utf8").replaceAll("\r", "");

  it("커밋된 SQL 의 단원 코드 목록이 지금 규칙과 글자까지 같다", () => {
    expect(sql).toContain(renderUnitCodePrefixSql(CURRICULUM_UNITS));
  });

  it("SQL 이 쓰는 무작위 집합이 계약과 같은 한 벌이다", () => {
    expect(sql).toContain(`'${PROBLEM_CODE_ALPHABET}'`);
  });

  it("SQL 의 형식 검사가 계약의 정규식과 같다", () => {
    expect(sql).toContain(PROBLEM_CODE_PATTERN);
  });

  it("코드는 INSERT 때만 붙는다 — UPDATE 로 다시 계산하는 트리거가 없다", () => {
    expect(sql).toMatch(/BEFORE INSERT ON "problem"/);
    expect(sql).not.toMatch(/BEFORE INSERT OR UPDATE ON "problem"/);
  });

  /**
   * ⚠️ 이 검사는 처음에 `toMatch(/LOOP/)` + `toMatch(/RAISE EXCEPTION/)` 였다.
   *    **재시도 고리를 통째로 지워도 초록이었다** — 무작위 4자를 뽑는 함수에도
   *    `LOOP` 가 있고, 단원 코드 검사에도 `RAISE EXCEPTION` 이 있기 때문이다.
   *    가드가 아니라 장식이었다(적대적 리뷰 ④ §H 와 같은 부류). 망가뜨려 보고 알았다.
   *    이제는 **재시도 고리 자체의 모양**을 본다.
   *    DB 에서 「재시도가 없으면 정말 겹치는가」는 verify-problem-code-wiring 의 B10 이 잰다.
   */
  it("충돌 재시도 고리가 있다 — 뽑고, 이미 있으면, 다시 뽑는다", () => {
    expect(sql).toMatch(/FOR i IN 1\.\.v_tries LOOP/);
    expect(sql).toMatch(
      /PERFORM 1 FROM "problem" p WHERE p\."problem_code" = v_code/,
    );
    expect(sql).toMatch(/IF NOT FOUND THEN\s*\n\s*RETURN v_code;/);
  });

  it("재시도가 다 실패하면 조용히 넘기지 않고 멈춘다", () => {
    expect(sql).toMatch(/전부 겹쳤다/);
  });

  it("한 번 붙은 코드는 못 바꾼다 — 불변 트리거가 있다", () => {
    expect(sql).toMatch(/BEFORE UPDATE ON "problem"/);
  });
});
