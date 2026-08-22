/**
 * 초등 출제 CLI 의 알맹이 — 스킬(.claude/skills/elem-gen)이 gen-cli.ts 를 통해 부른다.
 *
 * 규칙:
 * - 커버리지 목록은 엔진 등록부(handlerKeys)에서 **유도**한다. 손 목록을 두면
 *   생성기가 늘 때 이 목록이 조용히 좁아진다 (2026-08-18 「손 목록은 샌다」).
 * - 갈래(난이도)는 엔진의 supportedTiers 가 참이다 — 미등록 소단원에 갈래·프리셋을
 *   물으면 조용히 기본 문항을 내지 않고 **던진다** (generate.ts 와 같은 태도).
 * - 씨앗이 같으면 세트가 같다 (재현). DB 에는 아무것도 쓰지 않는다 (D-22·D-31).
 */
import type { UnitSeed } from "../../prisma/seed-data/units";
import {
  ELEM_TIERS,
  TIER_PRESETS,
  sectionCode,
  type ClassPreset,
  type ElemTier,
} from "../../src/lib/elementary/difficulty";
import {
  elementaryUnits,
  generateElementaryProblem,
  handlerKeys,
  supportedTiers,
} from "../../src/lib/elementary/generate";
import type { ElemProblem } from "../../src/lib/elementary/types";

export type CoverageRow = {
  grade: string;
  chapter: string;
  section: string;
  code: string;
  tiers: readonly ElemTier[];
};

/** 생성기가 있는 소단원 전부 — 엔진 등록부에서 유도. */
export function listCoverage(): CoverageRow[] {
  const keys = new Set(handlerKeys());
  return elementaryUnits()
    .filter((unit) => keys.has(`${unit.grade}|${unit.chapter}`))
    .map((unit) => ({
      grade: unit.grade,
      chapter: unit.chapter,
      section: unit.section,
      code: sectionCode(unit),
      tiers: supportedTiers(unit),
    }));
}

/** 학년+소단원 코드로 시드 행을 찾는다. 없으면 이웃 후보를 함께 말하고 던진다. */
export function findUnit(grade: string, code: string): UnitSeed {
  const inGrade = elementaryUnits().filter((u) => u.grade === grade);
  const hit = inGrade.find((u) => sectionCode(u) === code);
  if (hit) return hit;
  const chapterPrefix = code.split("-").slice(0, 2).join("-");
  const near = inGrade
    .filter((u) => sectionCode(u).startsWith(chapterPrefix))
    .map((u) => u.section)
    .slice(0, 6);
  throw new Error(
    `${grade} 에 ${code} 소단원이 없습니다.` +
      (near.length
        ? ` 이웃 후보: ${near.join(" · ")}`
        : " (--list 로 코드를 확인하십시오)"),
  );
}

/**
 * D-71 반 프리셋(%)을 문항 수로 배분 — 최대 잔여법.
 * 동률 잔여는 ELEM_TIERS 선언 순서(연산→기본→응용→심화)가 가른다.
 */
export function allocateByPreset(
  preset: ClassPreset,
  count: number,
): Record<ElemTier, number> {
  if (!Number.isInteger(count) || count <= 0) {
    throw new Error(`문항 수가 이상합니다: ${count}`);
  }
  const pct = TIER_PRESETS[preset];
  const exact = ELEM_TIERS.map((t) => (count * pct[t]) / 100);
  const floors = exact.map(Math.floor);
  let rest = count - floors.reduce((a, b) => a + b, 0);
  // 잔여가 큰 순 — 같으면 선언 순서 앞이 먼저 (sort 안정성이 그 순서를 지킨다).
  // 0% 갈래 보호는 따로 두지 않는다 — 잔여 총수(rest)는 잔여들의 합이고 각 잔여가
  // 1 미만이므로 rest < «양의 잔여 갈래 수», 즉 잔여는 항상 양의 잔여 갈래에만 간다.
  // 이 성질(0% 갈래 = 0문항)은 죽은 코드가 아니라 **시험이** 잠근다 (elemGenCore.test.ts).
  const order = ELEM_TIERS.map((_, i) => i).sort(
    (a, b) => exact[b]! - floors[b]! - (exact[a]! - floors[a]!),
  );
  for (const i of order) {
    if (rest <= 0) break;
    floors[i] = floors[i]! + 1;
    rest -= 1;
  }
  const out = {} as Record<ElemTier, number>;
  ELEM_TIERS.forEach((t, i) => {
    out[t] = floors[i]!;
  });
  return out;
}

export type GenItem = {
  /** null 이면 갈래 없이 낸 표준 문항 */
  tier: ElemTier | null;
  seed: number;
  problem: ElemProblem;
};

export type GenSetOptions = {
  grade: string;
  code: string;
  /** tierCounts 를 주면 생략 가능 — 그때 개수는 배분의 합이다. 둘 다 주면 같아야 한다. */
  count?: number;
  seed: number;
  tier?: ElemTier;
  preset?: ClassPreset;
  /** 갈래별 개수 직접 배분 (예: {연산:1, 응용:2}) — 프리셋 비율 대신 손으로 정할 때. */
  tierCounts?: Partial<Record<ElemTier, number>>;
};

/** 씨앗 보폭. 엔진이 안에서 orderIndex·소금을 다시 섞으므로 서로 다르기만 하면 된다. */
const SEED_STRIDE = 101;
/** 중복 문항이 나오면 씨앗을 이만큼 밀어 다시 뽑는다 (소수 — 보폭과 안 겹치게). */
const DEDUPE_STRIDE = 7919;
const DEDUPE_TRIES = 50;

/**
 * 한 소단원에서 문항 세트를 뽑는다. 세트 안 중복(발문+정답)은 씨앗을 밀어 피하고,
 * 변형 공간이 좁아 못 피하면 **던진다** — 조용히 같은 문항을 두 번 내지 않는다.
 */
export function generateSet(opts: GenSetOptions): GenItem[] {
  const { grade, code, seed } = opts;
  const modes = [opts.tier, opts.preset, opts.tierCounts].filter(
    (m) => m !== undefined,
  ).length;
  if (modes > 1) {
    throw new Error(
      "tier · preset · tierCounts(직접 배분)는 하나만 고르십시오",
    );
  }
  const unit = findUnit(grade, code);
  const needTierRegistry = (): void => {
    if (supportedTiers(unit).length === 0) {
      throw new Error(
        `${grade} ${unit.section} 은 난이도 갈래가 아직 없습니다 — 갈래 없이 내거나, --list 로 갈래 있는 소단원을 고르십시오`,
      );
    }
  };

  // 이 세트가 낼 갈래 나열 (null = 갈래 없이)
  let tierPlan: (ElemTier | null)[];
  let count: number;
  if (opts.tierCounts !== undefined) {
    needTierRegistry();
    const entries = Object.entries(opts.tierCounts) as [ElemTier, number][];
    if (entries.length === 0) {
      throw new Error("직접 배분이 비어 있습니다 — 갈래별 개수를 주십시오");
    }
    for (const [t, n] of entries) {
      if (!(ELEM_TIERS as readonly string[]).includes(t)) {
        throw new Error(
          `모르는 갈래입니다: «${t}» — ${ELEM_TIERS.join("·")} 중에서 고르십시오`,
        );
      }
      if (!Number.isInteger(n) || n <= 0) {
        throw new Error(`«${t}» 개수가 이상합니다: ${n} (1 이상 정수)`);
      }
    }
    const sum = entries.reduce((a, [, n]) => a + n, 0);
    if (opts.count !== undefined && opts.count !== sum) {
      throw new Error(
        `count(${opts.count})와 직접 배분의 합(${sum})이 다릅니다 — 배분의 합이 곧 개수이니 count 는 생략하십시오`,
      );
    }
    count = sum;
    // ELEM_TIERS 선언 순서로 낸다 — 연산이 앞, 심화가 뒤 (지면 배치 관행)
    tierPlan = ELEM_TIERS.flatMap((t) =>
      Array<ElemTier | null>(opts.tierCounts![t] ?? 0).fill(t),
    );
  } else {
    if (
      opts.count === undefined ||
      !Number.isInteger(opts.count) ||
      opts.count <= 0
    ) {
      throw new Error(`문항 수가 이상합니다: ${opts.count}`);
    }
    count = opts.count;
    if (opts.preset !== undefined) {
      needTierRegistry();
      const alloc = allocateByPreset(opts.preset, count);
      tierPlan = ELEM_TIERS.flatMap((t) =>
        Array<ElemTier | null>(alloc[t]).fill(t),
      );
    } else if (opts.tier !== undefined) {
      needTierRegistry();
      tierPlan = Array<ElemTier | null>(count).fill(opts.tier);
    } else {
      tierPlan = Array<ElemTier | null>(count).fill(null);
    }
  }

  const items: GenItem[] = [];
  const seen = new Set<string>();
  tierPlan.forEach((tier, i) => {
    let itemSeed = seed + i * SEED_STRIDE;
    for (let tryNo = 0; ; tryNo += 1) {
      const problem = generateElementaryProblem(
        unit,
        itemSeed,
        tier ?? undefined,
      );
      const key = `${tier}|${problem.content}|${problem.answer}`;
      if (!seen.has(key)) {
        seen.add(key);
        items.push({ tier, seed: itemSeed, problem });
        break;
      }
      if (tryNo >= DEDUPE_TRIES) {
        throw new Error(
          `${grade} ${unit.section}${tier ? ` «${tier}»` : ""} 의 변형 공간이 좁아 ` +
            `${count}문항을 겹침 없이 못 냅니다 (${items.length}개까지 나옴) — 문항 수를 줄이십시오`,
        );
      }
      itemSeed += DEDUPE_STRIDE;
    }
  });
  return items;
}
