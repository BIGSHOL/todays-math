import type { MapResult, UnitLike } from "./types";

const GRADE_ALIASES: Record<string, string> = {
  middle_1: "중1",
  middle_2: "중2",
  middle_3: "중3",
  elementary_3: "초3",
  elementary_4: "초4",
  elementary_5: "초5",
  elementary_6: "초6",
  high_1: "공통수학1",
  high_2: "공통수학2",
  공수1: "공통수학1",
  공수2: "공통수학2",
  공통수학1: "공통수학1",
  공통수학2: "공통수학2",
};

export function normalizeGrade(
  raw: string | number | null | undefined,
): string | null {
  // 시험지 메타의 학년/과목은 JSON `null` 로 오는 일이 흔하다 — 던지면 이관이 통째로 죽는다.
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw === "number") {
    if (raw === 1) return "공통수학1";
    if (raw === 2) return "공통수학2";
    return null;
  }
  const trimmed = raw.trim();
  if (GRADE_ALIASES[trimmed]) return GRADE_ALIASES[trimmed];

  const conceptId = trimmed.match(/^(e|m|h)(\d)/i);
  if (conceptId) {
    const n = conceptId[2];
    const kind = conceptId[1].toLowerCase();
    if (kind === "e") return `초${n}`;
    if (kind === "m") return `중${n}`;
    if (kind === "h") return n === "1" ? "공통수학1" : "공통수학2";
  }

  const book = trimmed.match(/중([123])(?:\s*[-–]\s*[12])?/);
  if (book) return `중${book[1]}`;
  const elem = trimmed.match(/초([1-6])/);
  if (elem) return `초${elem[1]}`;

  return trimmed;
}

/**
 * 시험지 표기 → 우리 소단원 이름. **뜻이 1:1 로 같은데 글자가 아예 다른 것만** 넣는다.
 * 유사도(0.13~0.46)로는 안 붙어서 사람이 판단한 목록이다(2026-08-15 실측).
 *
 * ⚠️ 중단원급 힌트("일차함수와 그래프", "정비례와 반비례", "도형의 이동")는
 * **넣지 않는다**. 소단원 여러 개에 걸쳐 있어 하나를 고르면 임의 배정이 되고,
 * 그 소단원으로 출제할 때 결이 다른 문제가 섞인다. 미분류로 두면 나중에
 * 재실행으로 회수된다. 넣으려면 원장님 확인을 받을 것.
 */
const SECTION_ALIASES: Record<string, Record<string, string>> = {
  중2: {
    // 중2 '식의 계산'에서 다항식은 덧셈·뺄셈, 단항식은 곱셈·나눗셈을 다룬다.
    다항식의계산: "다항식의 덧셈과 뺄셈",
    단항식의계산: "단항식의 곱셈과 나눗셈",
  },
  공통수학1: {
    // 판별식으로 교점 개수를 따지는 그 단원이다.
    이차함수와직선의위치관계: "이차방정식과 이차함수의 관계",
    // 미정계수법 = 항등식의 계수를 결정하는 방법.
    미정계수법: "항등식",
  },
  공통수학2: {
    명제의참거짓: "명제와 조건",
  },
  중3: {
    // 원과 직선의 위치관계 = 접선 단원.
    원과직선: "원의 접선",
  },
  대수: {
    삼각함수가포함된방정식과부등식: "삼각방정식",
  },
  미적분1: {
    // 미분가능성 ↔ 연속성은 미분계수의 정의에서 다룬다.
    미분가능성과연속성: "미분계수",
    // 다항함수의 최대·최소는 극대·극소에서 다룬다.
    함수의최댓값과최솟값: "함수의 극대와 극소",
  },
  미적분2: {
    급수의수렴과발산: "급수의 뜻과 계산",
    매개변수로나타낸함수의미분법: "여러 가지 미분법",
  },
  /**
   * ⭐ **원장님 확정 2026-08-16.** 아래 다섯은 트랙 G 가 임의로 고른 것이 아니라
   * 원장님이 직접 배정하신 것이다. 근거를 남겨 둔다 — 나중에 "누가 왜 이렇게 정했나"
   * 를 물을 때 코드 안에 답이 있어야 한다.
   *
   * **왜 사람이 정해야 했나**: 두 소단원 이름이 `공간도형-위치관계(1)` · `(2)` 로
   * 괄호 안 번호만 다른데, `normalizeForCompare` 가 괄호를 떼므로 비교 시점에
   * **두 이름이 완전히 같은 문자열**이 된다. 유사도로는 영원히 동점이라 기계가
   * 구분할 수 없다. 교육과정 정본(eywa `curriculum.ts` 1271~1272행)에도 차시명
   * 두 줄뿐이고, 두 단원 모두 실적이 0 건이라 실측으로도 정할 수 없었다.
   *
   * **왜 유사도 하한을 낮추는 것으로는 못 고치나**: 대상 13문항 중 11건이 트리
   * 이름과 공유하는 bigram 이 아예 0 이다(유사도 0.000). 하한을 아무리 낮춰도
   * 안 붙는다. 별칭만이 유일한 길이다.
   *
   * 배정 (원장님): 위치 관계 자체는 (1), 이루는 각은 (2).
   *   (1) ← 직선과 평면의 위치관계 · 수직 · 평행과 수직   (실측 4문항)
   *   (2) ← 두 직선/두 평면이 이루는 각의 크기            (실측 9문항)
   *
   * `aliasKey()` 가 공백·구두점을 털므로 `직선과 평면의 위치 관계`(띄어쓰기 다른 판)도
   * 같은 키로 들어온다 — 항목을 따로 만들지 않는다.
   *
   * ⚠️ 이 표에 무언가를 더할 때는 위와 같은 근거와 확정 주체를 함께 적을 것.
   * 매핑률을 올리려고 뜻이 어긋나는 것을 밀어 넣지 말 것(이 파일 머리 주석 참조).
   */
  기하: {
    직선과평면의위치관계: "공간도형-위치관계(1)",
    직선과평면의수직: "공간도형-위치관계(1)",
    직선과평면의평행과수직: "공간도형-위치관계(1)",
    두직선이이루는각의크기: "공간도형-위치관계(2)",
    두평면이이루는각의크기: "공간도형-위치관계(2)",
  },
};

/**
 * 시험지가 **중단원 이름으로만** 태그한 경우. 소단원 여러 개에 걸쳐 1:1 로
 * 못 붙이므로 중단원만 확정하고, 소단원은 그 안에서 최근접을 고른다.
 * 틀려도 **같은 중단원 안**이라 그 단원 출제에 결이 아주 다른 문제는 안 섞인다.
 *
 * 2026-08-15 B단계 실측 상위 미분류에서 뽑았다. 트리에 중단원 자체가 없으면
 * 붙이지 않는다(예: 확률과 통계 '원순열' 은 중단원 `1. 경우의 수` 로 간다).
 */
const CHAPTER_ALIASES: Record<string, Record<string, string>> = {
  중1: {
    정비례와반비례: "4. 그래프와 비례",
    좌표와그래프: "4. 그래프와 비례",
  },
  중2: {
    일차함수와그래프: "4. 함수",
    일차함수와그그래프: "4. 함수",
  },
  중3: {
    제곱근과실수: "1. 실수와 그 계산",
    이차함수의활용: "4. 이차함수",
  },
  미적분1: {
    방정식과부등식에의활용: "2. 미분",
  },
  미적분2: {
    여러가지함수의정적분: "3. 적분법",
  },
  "확률과 통계": {
    원순열: "1. 경우의 수",
  },
};

/** 중단원 별칭이 걸리면 그 중단원 안에서 이름이 가장 닮은 소단원. */
function chapterAliasHit(
  pool: UnitLike[],
  hint: string,
  grade: string,
): UnitLike | undefined {
  const chapter = CHAPTER_ALIASES[grade]?.[aliasKey(hint)];
  if (!chapter) return undefined;
  const inChapter = pool.filter((unit) => unit.chapter === chapter);
  if (inChapter.length === 0) return undefined;
  let best = inChapter[0];
  let bestScore = -1;
  for (const unit of inChapter) {
    const score = similarity(hint, unit.section);
    if (score > bestScore) {
      bestScore = score;
      best = unit;
    }
  }
  return best;
}

function aliasKey(value: string): string {
  return value.replace(/[\s.,·]/g, "");
}

function aliasHit(
  pool: UnitLike[],
  hint: string,
  grade: string,
): UnitLike | undefined {
  const section = SECTION_ALIASES[grade]?.[aliasKey(hint)];
  if (!section) return undefined;
  return pool.find((unit) => unit.section === section);
}

function includesLoose(haystack: string, needle: string): boolean {
  return haystack.replace(/\s+/g, "").includes(needle.replace(/\s+/g, ""));
}

export function mapUnitHint(
  hint: string,
  units: UnitLike[],
  gradeHint?: string | number,
): MapResult {
  const cleaned = hint.trim();
  if (!cleaned) {
    return { status: "unclassified", reason: "단원 힌트가 비어 있습니다." };
  }

  const grade = normalizeGrade(gradeHint);
  const scoped = grade ? units.filter((unit) => unit.grade === grade) : units;
  const pool = scoped.length > 0 ? scoped : units;

  const tokens = cleaned
    .split(/[~～,，/|·]+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const hints = tokens.length > 0 ? tokens : [cleaned];

  // 사람이 확정한 별칭이 먼저다 — 글자가 달라도 뜻이 같은 것들이라
  // 부분문자열·유사도보다 신뢰도가 높다.
  // 쪼개기 전 원문을 먼저 본다 — "명제의 참, 거짓" 은 쉼표로 쪼개면
  // ["명제의 참", "거짓"] 이 되어 별칭에 걸리지 않는다.
  if (grade) {
    for (const candidate of [cleaned, ...hints]) {
      const alias = aliasHit(pool, candidate, grade);
      if (alias) return { status: "mapped", unitId: alias.id };
    }
  }

  for (const hint of hints) {
    const sectionHit = longestHit(pool, hint, "section");
    if (sectionHit) return { status: "mapped", unitId: sectionHit.id };
  }
  for (const hint of hints) {
    const chapterHit = longestHit(pool, hint, "chapter");
    if (chapterHit) return { status: "mapped", unitId: chapterHit.id };
  }

  // 중단원 이름으로만 태그된 문항 — 중단원은 확정하고 소단원은 최근접.
  if (grade) {
    for (const candidate of [cleaned, ...hints]) {
      const alias = chapterAliasHit(pool, candidate, grade);
      if (alias) return { status: "mapped", unitId: alias.id };
    }
  }

  // 부분문자열로 안 붙는 표기 차이를 여기서 건진다.
  // 시험지는 "나머지정리와 인수정리", 우리 트리는 "나머지와 인수정리(1)" 처럼
  // 같은 단원인데 글자가 조금씩 다르다(실측 1,360건 중 다수).
  //
  // ⚠️ 학년이 **해석된** 경우에만 한다. 학년을 모르면 pool 이 초1~고3 전체라
  // 중등 "좌표와 그래프" 가 초2 "표와 그래프" 에 붙는다(실측 25건).
  // `scoped.length > 0` 만으로는 못 막는다 — 학년이 null 이면 scoped 가
  // 곧 units 전체라 언제나 참이다.
  // 장(chapter) 이름에도 하지 않는다 — 소단원 여러 개를 묶은 이름이라
  // 붙여 봐야 그중 아무 소단원에 실린다.
  if (grade && scoped.length > 0) {
    for (const hint of hints) {
      const fuzzySection = bestSimilar(scoped, hint, "section");
      if (fuzzySection) return { status: "mapped", unitId: fuzzySection.id };
    }
  }

  return {
    status: "unclassified",
    reason: `단원 힌트 '${cleaned}'를 교육과정 트리에 연결하지 못했습니다.`,
  };
}

function longestHit(
  pool: UnitLike[],
  hint: string,
  field: "section" | "chapter",
): UnitLike | undefined {
  const hits = pool.filter(
    (unit) =>
      includesLoose(unit[field], hint) || includesLoose(hint, unit[field]),
  );
  if (hits.length === 0) return undefined;
  hits.sort((a, b) => b[field].length - a[field].length);
  return hits[0];
}

/**
 * 유사도 하한. 이 아래는 붙이지 않고 미분류로 남긴다.
 *
 * 틀린 단원에 붙은 문항은 그 단원으로 출제할 때 엉뚱한 문제로 섞여 나간다.
 * 미분류는 나중에 다시 시도하면 그만이므로 **의심스러우면 안 붙이는 쪽**이다.
 * 실측(2026-08-15): 같은 단원의 표기 차이는 0.80 이상,
 * 중단원급 모호 힌트("제곱근과 실수" ↔ "제곱근의 뜻과 성질")는 0.33 으로
 * 사이가 넓게 벌어진다.
 */
const SIMILARITY_FLOOR = 0.6;

/** 비교용 정규화 — 공백·장 번호·괄호 차시 표기·구두점을 턴다. */
function normalizeForCompare(value: string): string {
  return value
    .replace(/^\s*\d+\s*[.)]\s*/, "")
    .replace(/\([^)]*\)/g, "")
    .replace(/[\s.,·'"''""\[\]{}]/g, "");
}

function bigrams(value: string): Set<string> {
  const out = new Set<string>();
  for (let i = 0; i + 1 < value.length; i += 1) out.add(value.slice(i, i + 2));
  return out;
}

/** 문자 바이그램 Dice 계수(0~1). 띄어쓰기·어미 차이에 강하다. */
function similarity(a: string, b: string): number {
  const left = bigrams(normalizeForCompare(a));
  const right = bigrams(normalizeForCompare(b));
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) if (right.has(gram)) shared += 1;
  return (2 * shared) / (left.size + right.size);
}

/**
 * 하한을 넘는 후보 중 가장 닮은 단원. 동점이면 교육과정 순서상 앞선 쪽
 * (예: "나머지와 인수정리(1)" 과 "(2)" 는 동점이므로 (1)).
 */
function bestSimilar(
  pool: UnitLike[],
  hint: string,
  field: "section" | "chapter",
): UnitLike | undefined {
  let best: UnitLike | undefined;
  let bestScore = 0;
  for (const unit of pool) {
    const score = similarity(hint, unit[field]);
    if (score > bestScore) {
      bestScore = score;
      best = unit;
    }
  }
  return bestScore >= SIMILARITY_FLOOR ? best : undefined;
}
