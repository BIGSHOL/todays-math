/**
 * eywa 진도 원문 → 우리 `Unit` (연계 1단계).
 *
 * ## 왜 이렇게 잇나
 *
 * 우리 단원 트리는 eywa `curriculum.ts` 에서 생성했다(T0.3). 2026-08-15 에
 * 735개가 **완전 일치**함을 확인했고(`scripts/qa/compare-eywa-curriculum.mjs`),
 * eywa 는 진도를 그 파일의 **차시 문자열**로 적는다
 * (`lesson_reports.progress = "수학 <차시>"`). 그래서 그 문자열이 그대로 열쇠다.
 *
 * ## 🔴 열쇠를 **정본**에서 가져온다
 *
 * eywa 에는 `progress_entries.global_position` 이라는 정수 위치도 있다. 그것은
 * 쓰지 않는다 — ⑴ `curriculum.ts` 를 flatten 한 배열의 **색인**이라 파일 순서가
 * 바뀌면 통째로 밀리는 **파생물**이고, ⑵ eywa 가 고등을 일부러 뺐다.
 * 실측(2026-08-21, 최근 120일): 파생물은 학생 171명, **원문은 195명**.
 *
 * 그리고 이 판정기는 eywa `curriculum.ts` 를 **런타임에 읽지 않는다.** 정본은
 * 우리 `unit` 테이블이다. 파일을 읽으면 우리 DB 와 갈라져도 아무도 모른다.
 *
 * ## 이 판정기가 지켜야 하는 것
 *
 * 1. **미분류를 반드시 출력한다.** 손으로 적은 어휘 목록은 샌다 —
 *    실측 19.3% 가 교육과정에 없는 **교재 어휘**다(「방정식(2)」·「일차식의 뜻 1」).
 *    조용히 버리면 「진도가 멈춘 학생」이 아무에게도 안 보인다.
 * 2. **못 가르면 «애매»로 둔다.** 한 학년에 같은 이름의 대단원이 **두 번** 나오는
 *    곳이 5군데다(초2 길이 재기 · 초3 나눗셈/곱셈 · 초6 분수/소수의 나눗셈 —
 *    1학기와 2학기). 틀린 단원으로 출제하는 것은 **조용한 오답**이라 안 내느니만
 *    못하다. 가르는 근거는 **본문 밖**에서 온다 — 그 학생이 지금 어디까지 왔나.
 * 3. **시험 기간은 «진도 없음»이지 «진도 뒤로»가 아니다.** 「월말평가」·「내신대비」가
 *    적힌 날은 진도를 안 옮긴다(실측: 가장 최근 보고서의 29.6% 가 이 부류다).
 */

/** 우리 `unit` 행 — 이 모듈이 보는 전부다. */
export interface UnitRow {
  id: string;
  grade: string;
  chapter: string;
  section: string;
  orderIndex: number;
}

export type ProgressKind =
  /** 소단원(차시) 하나를 정확히 가리킨다. */
  | "차시"
  /** 대단원 이름 — 그 대단원의 차시 전부. */
  | "대단원"
  /** 「… 대단원 총괄」 — 그 대단원을 끝냈다는 뜻. **확인테스트를 낼 때다.** */
  | "총괄"
  /** 후보가 둘 이상이라 못 가른다. 자동으로 고르지 않는다. */
  | "애매"
  /** 「월말평가」·「내신대비」 — 진도가 아니다. */
  | "시험기간"
  /** 교육과정에 없는 말. **반드시 남겨서 보이게 한다.** */
  | "미분류"
  | "빈줄";

export interface LineVerdict {
  kind: ProgressKind;
  /** 가리키는 단원들. 「차시」면 하나, 「대단원」·「총괄」이면 그 안의 차시 전부. */
  units: UnitRow[];
  /** 판정을 만든 원문 줄 — 미분류를 사람이 눈으로 보려면 이게 있어야 한다. */
  raw: string;
}

export interface TextVerdict {
  lines: LineVerdict[];
  /** 그날의 **현재 진도** — 진도인 줄 중 마지막. 시험기간뿐인 날은 null. */
  current: LineVerdict | null;
  /** 그날 닿은 가장 먼 `orderIndex`. 진도가 없으면 null. */
  furthestOrderIndex: number | null;
  /** 못 푼 줄의 **원문**. 화면에 찍어야 한다. */
  unresolved: string[];
  /** 「월말평가」류가 한 줄이라도 있었나. */
  examPeriod: boolean;
}

export interface ResolveOptions {
  /**
   * 그 학생이 **직전에 서 있던 위치**(`Unit.orderIndex`). 「애매」를 가르는
   * 유일한 근거다 — 본문 안에는 1학기인지 2학기인지가 없다.
   */
  nearOrderIndex?: number | null;
}

/**
 * 앞에 붙은 차례 번호를 벗긴다. 실측한 **세 가지 모양만** 본다:
 *   · `1.` `1. `  중·고 대단원, edutrix 이관 포맷 (`1.회전체`)
 *   · `1-1 `      초등 대단원 (`1-1 분수의 나눗셈`)
 *   · `1-1-1 `    초등 차시   (`2-1-1 분모가 같은 (분수)÷(분수) 알아보기`)
 *
 * 🔴 맨 숫자(`1 `)는 **안 벗긴다** — 「1보다 작은 소수」처럼 숫자로 시작하는
 *    이름이 실제로 있다. 벗기는 조건에 `.` 또는 `-숫자` 를 반드시 요구한다.
 */
const ORDINAL = /^(?:\d+(?:-\d+)+|\d+\.)\s*/;

const stripOrdinal = (s: string) => s.replace(ORDINAL, "").trim();

/**
 * 로마숫자 — eywa 는 차시에 `일차식의 뜻Ⅰ` 처럼 쓰는데 진도엔 `일차식의 뜻 1` 로
 * 적힌다. 학년 라벨(`미적분Ⅰ` ↔ `미적분1`)에서 이미 겪은 그 표기 차이다.
 */
const ROMAN: Record<string, string> = {
  Ⅰ: "1",
  Ⅱ: "2",
  Ⅲ: "3",
  Ⅳ: "4",
  Ⅴ: "5",
};

/**
 * **느슨한 열쇠** — 번호를 벗기고, 로마숫자를 아라비아로, 공백을 전부 지운다.
 * 「분수의 크기비교」↔「분수의 크기 비교」, 「삼각형의 닮음조건」↔「삼각형의 닮음 조건」.
 *
 * 🔴 **정확 일치가 실패했을 때만** 본다. 그리고 여기까지만 한다 — 「문자의 사용과
 *    식의 계산」은 우리 「문자의 사용과 식의 값」과 80% 닮았지만 **다른 차시**다.
 *    닮음으로 이으면 틀린 단원으로 조용히 출제된다.
 *
 * 이 규칙이 **원래 갈라져 있던 이름을 합치는 경우는 1종뿐**이다(실측 735단원:
 * 「두 직선의 위치 관계」/「두 직선의 위치관계」 — 우리 데이터가 같은 것을 두 가지로
 * 적어 둔 것이라 합쳐지는 편이 옳다). 대단원은 0종. 즉 이 규칙은 아무것도 안 깎는다.
 */
const looseKey = (s: string) =>
  stripOrdinal(s)
    .replace(/[ⅠⅡⅢⅣⅤ]/g, (m) => ROMAN[m] ?? m)
    .replace(/\s+/g, "");

/**
 * 「… 총괄」 꼬리. 「대단원 총괄」·「(단원) 총괄」·「단원 총괄」·맨 「총괄」 넷 다 실측된다.
 * 앞의 이름만 남긴다.
 */
const SUMMARY = /^(.*?)\s*(?:\(단원\)|대단원|단원)?\s*총괄$/;

/**
 * 진도가 아닌 것. 🔴 이 검사는 차시·대단원 조회 **다음**에 온다 — 교육과정에
 * 이 낱말이 든 차시가 생겨도 그쪽이 먼저 이긴다.
 */
const EXAM_PERIOD = /(평가|시험|내신|대비|모의고사|총정리|오답|보강)/;

/** 같은 이름을 가리키는 한 무리 — (학년, 대단원) 하나가 한 무리다. */
interface Group {
  key: string;
  units: UnitRow[];
}

export interface UnitIndex {
  /** 차시 이름(원문 · 번호 벗긴 것) → 무리들 */
  bySection: Map<string, Group[]>;
  /** 대단원 이름(원문 · 번호 벗긴 것) → 무리들 */
  byChapter: Map<string, Group[]>;
  /** 느슨한 열쇠 → 무리들. **정확 일치가 다 실패한 뒤에만** 본다. */
  bySectionLoose: Map<string, Group[]>;
  byChapterLoose: Map<string, Group[]>;
  units: readonly UnitRow[];
}

function push(
  map: Map<string, Group[]>,
  key: string,
  groupKey: string,
  unit: UnitRow,
) {
  if (!key) return;
  let groups = map.get(key);
  if (!groups) {
    groups = [];
    map.set(key, groups);
  }
  let group = groups.find((g) => g.key === groupKey);
  if (!group) {
    group = { key: groupKey, units: [] };
    groups.push(group);
  }
  if (!group.units.some((u) => u.id === unit.id)) group.units.push(unit);
}

/**
 * 우리 `unit` 행에서 색인을 만든다. 이름은 **원문과 번호 벗긴 것을 둘 다** 넣는다 —
 * 진도엔 「분모가 같은 (분수)÷(분수) 알아보기」로 적히는데 우리 section 은
 * 「2-1-1 분모가 같은 …」이라 한쪽만 넣으면 못 만난다.
 */
export function buildUnitIndex(units: readonly UnitRow[]): UnitIndex {
  const bySection = new Map<string, Group[]>();
  const byChapter = new Map<string, Group[]>();
  const bySectionLoose = new Map<string, Group[]>();
  const byChapterLoose = new Map<string, Group[]>();
  for (const unit of units) {
    const chapterKey = `${unit.grade}||${unit.chapter}`;
    // 차시는 그 자체가 한 무리다 — 같은 이름의 차시가 여러 단원에 있으면 갈린다.
    const sectionKey = `${chapterKey}||${unit.section}`;
    for (const name of new Set([
      unit.section.trim(),
      stripOrdinal(unit.section),
    ]))
      push(bySection, name, sectionKey, unit);
    for (const name of new Set([
      unit.chapter.trim(),
      stripOrdinal(unit.chapter),
    ]))
      push(byChapter, name, chapterKey, unit);
    push(bySectionLoose, looseKey(unit.section), sectionKey, unit);
    push(byChapterLoose, looseKey(unit.chapter), chapterKey, unit);
  }
  return { bySection, byChapter, bySectionLoose, byChapterLoose, units };
}

/** 무리 안에서 `nearOrderIndex` 에 가장 가까운 거리. */
function distance(group: Group, near: number): number {
  return Math.min(...group.units.map((u) => Math.abs(u.orderIndex - near)));
}

/**
 * 후보 무리가 여럿이면 「애매」다. `nearOrderIndex` 가 있으면 **가장 가까운 하나**를
 * 고른다 — 다만 **동점이면 안 고른다**(가르지 못한 것을 가른 척하지 않는다).
 */
function settle(
  kind: ProgressKind,
  groups: Group[],
  raw: string,
  near?: number | null,
): LineVerdict {
  if (groups.length === 1) return { kind, units: groups[0]!.units, raw };
  if (near != null && Number.isFinite(near)) {
    const scored = groups
      .map((g) => ({ g, d: distance(g, near) }))
      .sort((a, b) => a.d - b.d);
    if (scored.length > 1 && scored[0]!.d !== scored[1]!.d)
      return { kind, units: scored[0]!.g.units, raw };
  }
  return { kind: "애매", units: groups.flatMap((g) => g.units), raw };
}

interface Hit {
  kind: ProgressKind;
  groups: Group[];
}

/**
 * 라벨(「수학 」)을 앞에서 한 토막씩 벗기며 찾는다 — eywa 원스크린이
 * `"<과목라벨> <차시>"` 로 저장하기 때문이다. 다섯 토막까지만 벗긴다.
 *
 * `chapterOnly` 는 「… 총괄」용 — 총괄은 대단원만 가리킨다.
 */
function lookup(
  index: UnitIndex,
  text: string,
  loose: boolean,
  chapterOnly = false,
): Hit | null {
  const sections = loose ? index.bySectionLoose : index.bySection;
  const chapters = loose ? index.byChapterLoose : index.byChapter;
  const key = (s: string) => (loose ? looseKey(s) : s);
  let s = stripOrdinal(text);
  for (let i = 0; i < 5; i += 1) {
    for (const candidate of new Set([key(s), key(stripOrdinal(s))])) {
      if (!candidate) continue;
      if (!chapterOnly) {
        const section = sections.get(candidate);
        if (section) return { kind: "차시", groups: section };
      }
      const chapter = chapters.get(candidate);
      if (chapter)
        return { kind: chapterOnly ? "총괄" : "대단원", groups: chapter };
    }
    const space = s.indexOf(" ");
    if (space < 0) break;
    s = s.slice(space + 1).trim();
  }
  return null;
}

/**
 * 한 줄을 판정한다.
 *
 * 순서가 중요하다 — **정확 일치가 언제나 느슨한 일치를 이긴다.** 느슨한 쪽을
 * 먼저 보면 「일차식의 뜻Ⅰ」이 있는데도 엉뚱한 것이 먼저 걸릴 수 있다.
 */
export function resolveProgressLine(
  index: UnitIndex,
  line: string,
  options: ResolveOptions = {},
): LineVerdict {
  const raw = line.trim();
  if (!raw) return { kind: "빈줄", units: [], raw: line };
  const near = options.nearOrderIndex;

  // ① 정확 일치 → ② 느슨한 일치(공백·로마숫자)
  for (const loose of [false, true]) {
    const hit = lookup(index, raw, loose);
    if (hit) return settle(hit.kind, hit.groups, raw, near);
  }

  // ③ 「… 대단원 총괄」 — 그 대단원을 끝냈다는 뜻. **확인테스트를 낼 때다.**
  const summary = SUMMARY.exec(stripOrdinal(raw));
  if (summary?.[1]?.trim()) {
    for (const loose of [false, true]) {
      const hit = lookup(index, summary[1]!.trim(), loose, true);
      if (hit) return settle("총괄", hit.groups, raw, near);
    }
  }

  if (EXAM_PERIOD.test(raw)) return { kind: "시험기간", units: [], raw };
  return { kind: "미분류", units: [], raw };
}

const PROGRESS_KINDS = new Set<ProgressKind>(["차시", "대단원", "총괄"]);

/**
 * 하루치 진도 원문(여러 줄)을 판정한다.
 *
 * 🔴 **줄을 다 본다.** eywa 자신의 `positionOf` 는 마지막 줄만 보는데, 그러면
 *    「다면체 / 정다면체 / 회전체」에서 앞의 둘이 사라진다. 우리는 확인테스트
 *    **범위**를 잡아야 하므로 그날 닿은 자리를 다 알아야 한다.
 *
 * 앞줄이 위치를 정하면 그 값이 뒷줄의 「애매」를 가르는 근거가 된다.
 */
export function resolveProgressText(
  index: UnitIndex,
  text: string | null | undefined,
  options: ResolveOptions = {},
): TextVerdict {
  const lines: LineVerdict[] = [];
  const unresolved: string[] = [];
  let near = options.nearOrderIndex ?? null;
  let current: LineVerdict | null = null;
  let furthest: number | null = null;
  let examPeriod = false;

  for (const line of (text ?? "").split(/\r?\n/)) {
    if (!line.trim()) continue;
    const verdict = resolveProgressLine(index, line, { nearOrderIndex: near });
    lines.push(verdict);
    if (verdict.kind === "미분류") unresolved.push(verdict.raw);
    if (verdict.kind === "시험기간") examPeriod = true;
    if (!PROGRESS_KINDS.has(verdict.kind)) continue;
    current = verdict;
    for (const unit of verdict.units) {
      if (furthest === null || unit.orderIndex > furthest)
        furthest = unit.orderIndex;
      near = unit.orderIndex;
    }
  }

  return {
    lines,
    current,
    furthestOrderIndex: furthest,
    unresolved,
    examPeriod,
  };
}
