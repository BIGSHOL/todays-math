/**
 * 트랙 1 — **본문을 읽지 않고** 배정 단원의 학년이 원본과 맞는지 전수 판정한다.
 * **읽기 전용 · 보고만 한다. DB 를 고치지 않는다.**
 *
 *   # 전수 판정 (DB 접속)
 *   node node_modules/tsx/dist/cli.mjs -r dotenv/config \
 *     scripts/classify/audit-metadata-unit.ts \
 *     dotenv_config_path=<메인 워크트리>/.env
 *
 *   # 판정기 자체 시험만 (DB 미접속) — 손상 입력 + 회귀 픽스처
 *   node node_modules/tsx/dist/cli.mjs scripts/classify/audit-metadata-unit.ts --self-test
 *
 *   # 이미 내려받은 스냅샷으로 재판정 (반복 검토용)
 *   ... audit-metadata-unit.ts --snapshot .tmp-orca/meta.jsonl
 *
 * ── 왜 본문을 안 보고도 판정이 되는가 ────────────────────────────────────────
 * `sourceFile` 은 사람이 손으로 정리한 N드라이브 경로다. 여기엔 **서로 다른 두 곳**에
 * 학년/과목이 적혀 있다.
 *
 *   N:\…\1학기 기말\고1\[칠성고][1][공수1][25-1-기말대비][미래엔] (완료).PDF
 *                    ~~~~  ~~~~~~~~~~~~~~~~~~
 *                    폴더   파일명 대괄호
 *
 * 둘은 다른 사람이 다른 시점에 적은 값이라 **서로 독립인 근거**로 쓸 수 있다(CLAUDE.md
 * 2026-08-17 교훈: "본문과 독립인 근거를 하나 더 요구하라"). 여기에 같은 편(examId)의
 * 형제 행들이 어느 학년에 몰려 있는지를 셋째 근거로 쓴다 — 이건 아래 과목→학년 표에
 * **전혀 기대지 않는다.**
 *
 * ── 절대 밟지 말아야 할 함정 ────────────────────────────────────────────────
 * 고등의 `unit.grade` 는 **학년이 아니라 과목명**이다(공통수학1·대수·미적분1 …).
 * `고1 ≠ 공통수학1` 로 세면 4,026건(16%)이 거짓 경보로 뜬다. 그래서 학년은
 * **학년 → 허용 과목 집합** 으로 풀고, 과목은 따로 1:1 로 좁힌다.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { OUT_DIR } from "./paths";

// ─────────────────────────────────────────────────────────────────────────────
// 어휘표
// ─────────────────────────────────────────────────────────────────────────────

// `Unit.grade` 가 실제로 갖는 값은 2026-08-17 실측 15종 — 초2~초6 · 중1~중3 · 아래 고등 7종.
// 초등은 `gradesForSchoolYear` 가 `초N`→{초N} 으로 그때그때 만들므로 상수로 두지 않는다.
const MIDDLE = ["중1", "중2", "중3"] as const;
const HIGH_1 = ["공통수학1", "공통수학2"] as const;
/** 고2·고3 선택과목 — 학년만으로는 못 좁힌다. 과목 근거가 있어야 1:1 이 된다. */
const HIGH_ELECTIVE = [
  "대수",
  "미적분1",
  "미적분2",
  "확률과 통계",
  "기하",
] as const;
const HIGH_ALL = [...HIGH_1, ...HIGH_ELECTIVE];

/**
 * 경로에 적힌 과목 표기 → 기대 `unit.grade` **집합**.
 *
 * ⚠️ 단일값이 아니라 집합인 이유: `공수` 처럼 1·2 를 안 적은 표기가 실제로 있다(25건).
 *    적재기는 이걸 `공수1` 로 단정해 DB `subject` 에 넣었는데(실측), 우리는 단정하지
 *    않는다 — 단정하면 그 25건에서 «공통수학2 배정»을 거짓 경보로 띄운다.
 *
 * ⚠️ 수1→대수 · 수2→미적분1 · 미적분→미적분2 는 교육과정 개정 대응 표다.
 *    실측(2026-08-17)으로 각각 3,882/3,882 · 3,858/3,858 · 1,606/1,606 = 100% 일치라
 *    이 감사에서는 사실로 쓴다. 원장님 확정 대상이라는 점은 08 §5.1.5 참조.
 */
const SUBJECT_TO_GRADES: Record<string, readonly string[]> = {
  수상: ["공통수학1"],
  고등수학상: ["공통수학1"],
  상1: ["공통수학1"],
  공수1: ["공통수학1"],
  수하: ["공통수학2"],
  고등수학하: ["공통수학2"],
  공수2: ["공통수학2"],
  공수: HIGH_1, // 1·2 미표기 — 좁히지 않는다
  수1: ["대수"],
  심화수1: ["대수"],
  수2: ["미적분1"],
  문과수2: ["미적분1"],
  미적분: ["미적분2"],
  미적: ["미적분2"],
  미적분1: ["미적분2"],
  확통: ["확률과 통계"],
  확률과통계: ["확률과 통계"],
  기하: ["기하"],
  기벡: ["기하"],
  수학: MIDDLE, // 중등은 과목이 늘 「수학」 — 학년을 못 가른다
};

/** 학년 표기 → 기대 `unit.grade` 집합. **고등은 학년이 곧 과목명이 아니다.** */
function gradesForSchoolYear(token: string): readonly string[] | null {
  const m = token.match(/^(초|중|고)([1-6])$/);
  if (!m) return null;
  const [, level, digit] = m;
  if (level === "초") return [`초${digit}`];
  if (level === "중") return digit <= "3" ? [`중${digit}`] : null;
  if (digit === "1") return HIGH_1;
  if (digit === "2" || digit === "3") return HIGH_ELECTIVE;
  return null;
}

/**
 * 공백을 지운 사본으로 대조한다.
 *
 * ⚠️ 부모 세션 실측(2026-08-17): OCR·수작업 문자열은 토큰 한가운데 공백이 끼어
 *    («수  열», «[ 확통 ]», «중 3») 정규식이 **에러 없이 조용히 죽는다.** 경로에도
 *    `[25-1 중간]`, `( 완료)`, `[비상](완료)` 같은 실제 사례가 있다. 그래서 토큰
 *    비교는 전부 이 함수를 거친다.
 */
const squeeze = (value: unknown): string =>
  String(value ?? "").replace(/\s+/g, "");

// ─────────────────────────────────────────────────────────────────────────────
// 경로 파서 — 두 갈래를 **각각** 뽑는다 (합치지 않는다)
// ─────────────────────────────────────────────────────────────────────────────

export type PathSignals = {
  /** 폴더 표기에서 뽑은 학년 (`…\고1\…`). 없으면 null. */
  폴더학년: string | null;
  /** 폴더 표기에서 뽑은 과목 (`…\확통\…`). 없으면 null. */
  폴더과목: string | null;
  /** 파일명 첫 대괄호 = 학교명. */
  파일학교: string | null;
  /** 학교명 접미사에서 뽑은 학교급 (중/고). */
  학교급: "중" | "고" | null;
  /** 파일명 둘째 대괄호 = 학년 숫자. */
  파일학년숫자: string | null;
  /** 학교급 + 학년숫자 (`고1`). 둘 중 하나라도 없으면 null. */
  파일학년: string | null;
  /** 파일명 대괄호 **전체**를 훑어 찾은 과목 표기. */
  파일과목: string | null;
  /**
   * 파일명 대괄호의 학기(`[25-1-기말]` → "1"). **판정에는 쓰지 않는다** — §규칙비교 참조.
   * 뽑아 두는 이유는 「왜 안 쓰는지」를 매 실행마다 수치로 다시 보이기 위해서다.
   */
  파일학기: string | null;
};

const EMPTY_SIGNALS: PathSignals = {
  폴더학년: null,
  폴더과목: null,
  파일학교: null,
  학교급: null,
  파일학년숫자: null,
  파일학년: null,
  파일과목: null,
  파일학기: null,
};

/**
 * `sourceFile` 한 줄을 신호로 쪼갠다. **손상 입력에서도 절대 던지지 않는다.**
 *
 * 과목 표기를 둘째 대괄호로 고정하지 않고 **전 대괄호를 훑는** 이유: 실제로
 * `[화원고][2][25-2-기말][확통][미래엔]` 처럼 넷째 칸에 과목이 적힌 편이 있다(43행).
 * 적재기는 셋째 칸만 봐서 그 43행의 `subject` 를 NULL 로 흘렸다 — 우리는 주워 담는다.
 */
export function parseSourcePath(sourceFile: unknown): PathSignals {
  const raw = typeof sourceFile === "string" ? sourceFile : "";
  if (raw.trim() === "") return { ...EMPTY_SIGNALS };

  const segments = raw.split(/[\\/]+/).filter((s) => s.trim() !== "");
  const base = segments.length > 0 ? segments[segments.length - 1] : "";
  const folders = segments.slice(0, -1);

  let 폴더학년: string | null = null;
  let 폴더과목: string | null = null;
  for (const folder of folders) {
    const token = squeeze(folder);
    if (/^(초|중|고)[1-6]$/.test(token) && gradesForSchoolYear(token))
      폴더학년 = token;
    if (SUBJECT_TO_GRADES[token]) 폴더과목 = token;
  }

  const brackets = [...base.matchAll(/\[([^\]]*)\]/g)].map((m) => m[1]);
  const 파일학교 = brackets.length > 0 ? brackets[0].trim() || null : null;
  const squeezedSchool = squeeze(파일학교);
  const 학교급 = squeezedSchool.endsWith("중")
    ? "중"
    : squeezedSchool.endsWith("고")
      ? "고"
      : null;

  const secondRaw = brackets.length > 1 ? squeeze(brackets[1]) : "";
  const 파일학년숫자 = /^[1-6]$/.test(secondRaw) ? secondRaw : null;

  let 파일과목: string | null = null;
  for (const bracket of brackets.slice(1)) {
    const token = squeeze(bracket);
    if (SUBJECT_TO_GRADES[token]) {
      파일과목 = token;
      break;
    }
  }

  let 파일학기: string | null = null;
  for (const bracket of brackets) {
    const m = squeeze(bracket).match(/^\[?\d{2}년?-?([12])-?(?:기말|중간)/);
    if (m) {
      파일학기 = m[1];
      break;
    }
  }

  return {
    폴더학년,
    폴더과목,
    파일학교,
    학교급,
    파일학년숫자,
    파일학년: 학교급 && 파일학년숫자 ? `${학교급}${파일학년숫자}` : null,
    파일과목,
    파일학기,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 판정
// ─────────────────────────────────────────────────────────────────────────────

export type Row = {
  id: string;
  externalId: string | null;
  source: string;
  school: string | null;
  subject: string | null;
  examId: string | null;
  sourceFile: string | null;
  unit: { grade: string; chapter: string; section: string } | null;
};

export type Judgement = {
  기대학년: readonly string[] | null;
  /** 어떤 신호로 좁혔는지 — 행마다 남긴다. 근거 없는 판정은 교정할 수 없다. */
  근거: string[];
  /** 두 갈래가 서로 어긋나 **근거로 못 쓴** 것. */
  상충: string[];
  /** 신호 가짓수 — 확신도의 밑절미. */
  독립신호수: number;
};

const intersect = (a: readonly string[], b: readonly string[]) =>
  a.filter((x) => b.includes(x));

/**
 * 한 행의 기대 `unit.grade` 집합을 메타데이터만으로 좁힌다.
 *
 * 좁히는 순서가 아니라 **교집합**이다. 어느 한 신호를 «더 믿는» 순간, 그 신호가
 * 손상된 행에서 판정이 조용히 뒤집힌다(CLAUDE.md 2026-08-16 교훈).
 * 교집합이 비면 좁히지 않고 **상충으로 남겨 보류**한다.
 */
export function judge(row: Row): Judgement {
  const p = parseSourcePath(row.sourceFile);
  const 근거: string[] = [];
  const 상충: string[] = [];
  let 독립신호수 = 0;

  // ── 신호 1: 과목 (두 갈래 — 폴더 / 파일명 대괄호) ──────────────────────────
  //
  // ⚠️ 두 갈래를 **글자로** 견주면 안 된다. 같은 과목을 폴더는 `미적`, 파일명은
  //    `미적분` 으로 적는다 — 글자 비교는 이 835행을 「상충」으로 몰아 과목 근거를
  //    통째로 날린다(실측: 상충 57 → 895 로 부풀었다). 뜻(기대 학년 집합)으로 견준다.
  let 과목집합: readonly string[] | null = null;
  const 같은뜻 = (a: string, b: string) =>
    JSON.stringify(SUBJECT_TO_GRADES[a] ?? null) ===
    JSON.stringify(SUBJECT_TO_GRADES[b] ?? null);
  if (p.폴더과목 && p.파일과목 && !같은뜻(p.폴더과목, p.파일과목)) {
    상충.push(`과목상충(폴더=${p.폴더과목} 파일명=${p.파일과목})`);
  } else {
    const 과목 =
      p.파일과목 ?? p.폴더과목 ?? (row.subject ? squeeze(row.subject) : null);
    if (과목 && SUBJECT_TO_GRADES[과목]) {
      과목집합 = SUBJECT_TO_GRADES[과목];
      const 출처 = p.파일과목 ? "파일명" : p.폴더과목 ? "폴더" : "subject컬럼";
      근거.push(`과목=${과목}(${출처})→${과목집합.join("|")}`);
      독립신호수 += 1;
      if (p.폴더과목 && p.파일과목) 근거.push("과목 두 갈래 일치");
    }
  }

  // ── 신호 2: 학년 (두 갈래 — 폴더 / 파일명 대괄호) ──────────────────────────
  let 학년집합: readonly string[] | null = null;
  if (p.폴더학년 && p.파일학년 && p.폴더학년 !== p.파일학년) {
    상충.push(`학년상충(폴더=${p.폴더학년} 파일명=${p.파일학년})`);
  } else {
    const 학년 = p.파일학년 ?? p.폴더학년;
    const set = 학년 ? gradesForSchoolYear(학년) : null;
    if (학년 && set) {
      학년집합 = set;
      근거.push(
        `학년=${학년}(${p.파일학년 ? "파일명" : "폴더"})→${set.join("|")}`,
      );
      독립신호수 += 1;
      if (p.폴더학년 && p.파일학년) 근거.push("학년 두 갈래 일치");
    }
  }

  // ── 신호 3: 학교급 — 학년 숫자가 없어도 초등은 배제된다 ────────────────────
  const 학교급 =
    p.학교급 ??
    (squeeze(row.school).endsWith("중")
      ? "중"
      : squeeze(row.school).endsWith("고")
        ? "고"
        : null);
  let 학교급집합: readonly string[] | null = null;
  if (학교급) {
    학교급집합 = 학교급 === "중" ? MIDDLE : HIGH_ALL;
    if (!학년집합 && !과목집합) {
      근거.push(
        `학교급=${학교급}(${row.school ?? p.파일학교})→${학교급집합.join("|")}`,
      );
      독립신호수 += 1;
    }
  }

  // ── 신호 4: source — N드라이브 기출은 전부 중·고 시험지다(부록 A-1) ────────
  // 메타가 통째로 없는 past_exam 행에도 걸리는 유일한 신호다.
  let source집합: readonly string[] | null = null;
  if (row.source === "past_exam") {
    source집합 = [...MIDDLE, ...HIGH_ALL];
    if (!학년집합 && !과목집합 && !학교급집합) {
      근거.push("source=past_exam→초등 배제");
      독립신호수 += 1;
    }
  }

  // ── 교집합 ────────────────────────────────────────────────────────────────
  let 기대학년: readonly string[] | null = null;
  for (const candidate of [과목집합, 학년집합, 학교급집합, source집합]) {
    if (!candidate) continue;
    if (기대학년 === null) {
      기대학년 = candidate;
      continue;
    }
    const merged = intersect(기대학년, candidate);
    if (merged.length === 0) {
      상충.push("신호 교집합 공집합");
      return { 기대학년: null, 근거, 상충, 독립신호수 };
    }
    기대학년 = merged;
  }

  return { 기대학년, 근거, 상충, 독립신호수 };
}

// ─────────────────────────────────────────────────────────────────────────────
// 자체 시험 — **손상된 입력으로 먼저 시험한다** (CLAUDE.md 2026-08-16 교훈)
// ─────────────────────────────────────────────────────────────────────────────

type Case = { 이름: string; 입력: unknown; 기대: Partial<PathSignals> };

const 손상입력: Case[] = [
  {
    이름: "빈 문자열",
    입력: "",
    기대: { 파일학교: null, 파일학년: null, 파일과목: null, 폴더학년: null },
  },
  { 이름: "null", 입력: null, 기대: { 파일학교: null, 파일학년: null } },
  {
    이름: "undefined",
    입력: undefined,
    기대: { 파일학교: null, 파일학년: null },
  },
  { 이름: "숫자", 입력: 12345, 기대: { 파일학교: null, 파일학년: null } },
  { 이름: "공백만", 입력: "   ", 기대: { 파일학교: null, 파일학년: null } },
  {
    이름: "경로만(파일명 없음)",
    입력: "N:\\개인\\기출\\24 기출\\1학기 기말\\고1\\",
    기대: { 폴더학년: null, 파일학교: null },
  },
  {
    이름: "대괄호 없음",
    입력: "N:\\개인\\기출\\중3\\영남중 24-1 기말.PDF",
    기대: { 폴더학년: "중3", 파일학교: null, 파일학년: null },
  },
  {
    이름: "빈 대괄호",
    입력: "N:\\기출\\고1\\[][][][] (완료).PDF",
    기대: { 폴더학년: "고1", 파일학교: null, 파일학년: null },
  },
  {
    이름: "닫히지 않은 대괄호",
    입력: "N:\\기출\\중2\\[대곡중][2][23-1-기말 (완료).hwp",
    기대: { 폴더학년: "중2", 파일학교: "대곡중", 파일학년: "중2" },
  },
  {
    이름: "학년 두 자리",
    입력: "N:\\기출\\중12\\[대곡중][12][23-1-기말].hwp",
    기대: { 폴더학년: null, 파일학년숫자: null, 파일학년: null },
  },
  {
    이름: "학년 0",
    입력: "N:\\기출\\[대곡중][0][23-1-기말].hwp",
    기대: { 파일학년숫자: null, 파일학년: null },
  },
  {
    이름: "학년 자리에 과목",
    입력: "N:\\기출\\[대곡중][수1][23-1-기말].hwp",
    기대: { 파일학년숫자: null, 파일학년: null, 파일과목: "수1" },
  },
  {
    이름: "토큰 안 공백(폴더)",
    입력: "N:\\기출\\고 1\\[칠성고][1][공수1][25-1].PDF",
    기대: { 폴더학년: "고1", 파일학년: "고1" },
  },
  {
    이름: "토큰 안 공백(대괄호)",
    입력: "N:\\기출\\[ 화원고 ][ 2 ][ 확 통 ][미래엔].hwp",
    기대: { 파일학교: "화원고", 파일학년: "고2", 파일과목: "확통" },
  },
  {
    이름: "슬래시 경로",
    입력: "N:/개인/기출/중3/[영남중][3][24-1-기말][동아강].PDF",
    기대: { 폴더학년: "중3", 파일학년: "중3" },
  },
  {
    이름: "중복 구분자",
    입력: "N:\\\\기출\\\\고1\\\\[대건고][1][공수1][25-1].PDF",
    기대: { 폴더학년: "고1", 파일학년: "고1" },
  },
  {
    이름: "학교급 없는 학교명",
    입력: "N:\\기출\\[가나다][2][수1][25-1].hwp",
    기대: { 학교급: null, 파일학년: null, 파일과목: "수1" },
  },
  {
    이름: "과목이 넷째 칸",
    입력: "N:\\기출\\[화원고][2][25-2-기말][확통][미래엔] (완료).hwp",
    기대: { 파일과목: "확통", 파일학년: "고2" },
  },
  {
    이름: "폴더에 학년·과목 둘 다",
    입력: "N:\\기출\\고1\\공수2\\[이서고][1][공수2][25-1].hwp",
    기대: { 폴더학년: "고1", 폴더과목: "공수2", 파일과목: "공수2" },
  },
  {
    이름: "학년 폴더가 두 번(뒤가 이김)",
    입력: "N:\\기출\\중2\\중3\\[중리중][3][24-1].PDF",
    기대: { 폴더학년: "중3", 파일학년: "중3" },
  },
  {
    이름: "학교명에 「고」가 중간",
    입력: "N:\\기출\\[고성중][2][24-1].hwp",
    기대: { 학교급: "중", 파일학년: "중2" },
  },
];

/** 손상 입력이 **판정까지** 흘러가도 던지지 않고 보류로 끝나는지. */
const 손상판정: { 이름: string; row: Row; 기대: "보류" | "판정" }[] = [
  {
    이름: "메타 전무 + manual",
    row: {
      id: "x",
      externalId: null,
      source: "manual",
      school: null,
      subject: null,
      examId: null,
      sourceFile: null,
      unit: { grade: "초5", chapter: "", section: "" },
    },
    기대: "보류",
  },
  {
    이름: "메타 전무 + past_exam",
    row: {
      id: "x",
      externalId: null,
      source: "past_exam",
      school: null,
      subject: null,
      examId: null,
      sourceFile: null,
      unit: { grade: "초5", chapter: "", section: "" },
    },
    기대: "판정",
  },
  {
    이름: "unit 없음",
    row: {
      id: "x",
      externalId: null,
      source: "past_exam",
      school: "칠성고",
      subject: "공수1",
      examId: "1",
      sourceFile: "",
      unit: null,
    },
    기대: "판정",
  },
  {
    이름: "subject 컬럼이 쓰레기",
    row: {
      id: "x",
      externalId: null,
      source: "transformed",
      school: null,
      subject: "???",
      examId: null,
      sourceFile: null,
      unit: { grade: "중1", chapter: "", section: "" },
    },
    기대: "보류",
  },
];

function selfTest(): number {
  let 실패 = 0;
  console.log("── 손상 입력 파서 시험 ──");
  for (const c of 손상입력) {
    let got: PathSignals;
    try {
      got = parseSourcePath(c.입력);
    } catch (e) {
      console.log(`  ✗ ${c.이름}: 예외 ${String(e)}`);
      실패 += 1;
      continue;
    }
    const bad = Object.entries(c.기대).filter(
      ([k, v]) => got[k as keyof PathSignals] !== v,
    );
    if (bad.length === 0) console.log(`  ✓ ${c.이름}`);
    else {
      console.log(
        `  ✗ ${c.이름}: ${bad.map(([k, v]) => `${k} 기대=${v} 실제=${got[k as keyof PathSignals]}`).join(", ")}`,
      );
      실패 += 1;
    }
  }
  console.log("── 손상 입력 판정 시험 ──");
  for (const c of 손상판정) {
    let j: Judgement;
    try {
      j = judge(c.row);
    } catch (e) {
      console.log(`  ✗ ${c.이름}: 예외 ${String(e)}`);
      실패 += 1;
      continue;
    }
    const got = j.기대학년 === null ? "보류" : "판정";
    if (got === c.기대) console.log(`  ✓ ${c.이름} (${got})`);
    else {
      console.log(`  ✗ ${c.이름}: 기대=${c.기대} 실제=${got}`);
      실패 += 1;
    }
  }
  console.log("── 회귀 픽스처(부록 A-1) 경로 파싱 ──");
  const 픽스처 =
    "N:\\개인\\기출\\HWP 2 PDF\\기출\\24 기출\\1학기 기말\\고1\\[칠성고][1][공수1][25-1-기말대비][미래엔] (완료).PDF";
  const 판정 = judge({
    id: "fixture",
    externalId: "4509-5",
    source: "past_exam",
    school: "칠성고",
    subject: "공수1",
    examId: "4509",
    sourceFile: 픽스처,
    unit: {
      grade: "초3",
      chapter: "2-3 원",
      section: "2-3-1 원의 중심, 지름, 반지름",
    },
  });
  const 잡힘 = 판정.기대학년 !== null && !판정.기대학년.includes("초3");
  console.log(
    `  ${잡힘 ? "✓" : "✗"} 4509-5 오분류로 잡힘 — 기대학년=${판정.기대학년?.join("|")} 근거=${판정.근거.join(" ; ")}`,
  );
  if (!잡힘) 실패 += 1;
  return 실패;
}

// ─────────────────────────────────────────────────────────────────────────────
// 본체
// ─────────────────────────────────────────────────────────────────────────────

type Mismatch = {
  externalId: string | null;
  problemId: string;
  source: string;
  examId: string | null;
  school: string | null;
  subject: string | null;
  현재단원: string;
  기대학년: string[];
  근거: string[];
  편다수단원: string | null;
  편행수: number;
  편내소수파: boolean;
  확신도: "상" | "중" | "하";
  sourceFile: string | null;
};

async function loadRows(): Promise<Row[]> {
  const snapshotArg = process.argv.find((a) => a.startsWith("--snapshot"));
  if (snapshotArg) {
    const path = snapshotArg.includes("=")
      ? snapshotArg.split("=")[1]
      : process.argv[process.argv.indexOf(snapshotArg) + 1];
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .map((l) => JSON.parse(l) as Row);
  }
  const { PrismaClient } = await import("@prisma/client");
  const prisma = new PrismaClient();
  try {
    const out: Row[] = [];
    let cursor: string | undefined;
    for (;;) {
      const batch = await prisma.problem.findMany({
        select: {
          id: true,
          externalId: true,
          source: true,
          school: true,
          subject: true,
          examId: true,
          sourceFile: true,
          unit: { select: { grade: true, chapter: true, section: true } },
        },
        orderBy: { id: "asc" },
        take: 5000,
        ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      });
      if (batch.length === 0) break;
      out.push(...(batch as unknown as Row[]));
      cursor = batch[batch.length - 1].id;
      process.stdout.write(`\r내려받는 중 ${out.length}`);
    }
    process.stdout.write("\n");
    return out;
  } finally {
    await prisma.$disconnect();
  }
}

/** 같은 편(examId)의 형제 행들이 몰려 있는 학년. **과목→학년 표에 기대지 않는 셋째 근거다.** */
function dominantByExam(
  rows: Row[],
): Map<string, { grade: string; n: number; total: number }> {
  const groups = new Map<string, Map<string, number>>();
  for (const r of rows) {
    if (!r.examId || !r.unit) continue;
    if (!groups.has(r.examId)) groups.set(r.examId, new Map());
    const m = groups.get(r.examId)!;
    m.set(r.unit.grade, (m.get(r.unit.grade) ?? 0) + 1);
  }
  const out = new Map<string, { grade: string; n: number; total: number }>();
  for (const [examId, m] of groups) {
    const sorted = [...m.entries()].sort((a, b) => b[1] - a[1]);
    out.set(examId, {
      grade: sorted[0][0],
      n: sorted[0][1],
      total: [...m.values()].reduce((a, b) => a + b, 0),
    });
  }
  return out;
}

async function main() {
  if (process.argv.includes("--self-test")) {
    const 실패 = selfTest();
    console.log(
      실패 === 0 ? "\n자체 시험 전부 통과" : `\n자체 시험 실패 ${실패}건`,
    );
    process.exit(실패 === 0 ? 0 : 1);
  }

  const rows = await loadRows();
  const dominant = dominantByExam(rows);

  // 근거별 집계 — **0건인 가드는 죽은 것으로 의심한다**(부모 세션 경고, 2026-08-17).
  const 신호집계 = new Map<string, number>();
  const bump = (k: string) => 신호집계.set(k, (신호집계.get(k) ?? 0) + 1);

  const mismatches: Mismatch[] = [];
  const 편다수결단독: Mismatch[] = [];
  const 상충행: {
    externalId: string | null;
    상충: string[];
    현재단원: string;
    sourceFile: string | null;
    examId: string | null;
  }[] = [];
  let 판정가능 = 0,
    보류 = 0,
    정상 = 0;
  /** 「문제 없음」쪽을 층으로 갈라 담는다 — 한 층이 육안 표본을 통째로 삼키지 않게. */
  const 정상층: Record<string, Mismatch[]> = {
    "A. 편 다수와 다름(메타로는 허용)": [],
    "B. 기대집합이 안 좁혀짐(5종 이상)": [],
    "C. 신호가 source 하나뿐(메타 전무 past_exam)": [],
    "D. 기대집합 2종(고1 공통수학1·2 구분 불가)": [],
    "E. 근거 두 갈래 + 편 다수 일치(대조군)": [],
  };

  for (const row of rows) {
    const j = judge(row);
    for (const 근거 of j.근거) bump(근거.split("=")[0].split("(")[0]);
    for (const c of j.상충) {
      bump(c.split("(")[0]);
    }
    if (j.상충.length > 0) {
      상충행.push({
        externalId: row.externalId,
        상충: j.상충,
        examId: row.examId,
        현재단원: row.unit
          ? `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`
          : "(unit 없음)",
        sourceFile: row.sourceFile,
      });
    }
    if (j.기대학년 === null || !row.unit) {
      보류 += 1;
      continue;
    }
    판정가능 += 1;

    const dom = row.examId ? (dominant.get(row.examId) ?? null) : null;
    const 편내소수파 =
      dom !== null && dom.total > 1 && row.unit.grade !== dom.grade;
    const base: Mismatch = {
      externalId: row.externalId,
      problemId: row.id,
      source: row.source,
      examId: row.examId,
      school: row.school,
      subject: row.subject,
      현재단원: `${row.unit.grade} / ${row.unit.chapter} / ${row.unit.section}`,
      기대학년: [...j.기대학년],
      근거: j.근거,
      편다수단원: dom?.grade ?? null,
      편행수: dom?.total ?? 0,
      편내소수파,
      확신도: "중",
      sourceFile: row.sourceFile,
    };

    if (j.기대학년.includes(row.unit.grade)) {
      정상 += 1;
      // 층을 나눠 담는다. 층 A 는 「메타로는 통과했지만 같은 편의 형제들과 어긋난」 행 —
      // 메타 근거가 못 좁힌 자리를 편 다수결이 비추는 유일한 구간이라 전량 남긴다.
      if (편내소수파) {
        정상층["A. 편 다수와 다름(메타로는 허용)"].push(base);
        편다수결단독.push({
          ...base,
          확신도: "하",
          근거: [
            ...j.근거,
            `편 다수단원=${dom!.grade}(${dom!.n}/${dom!.total})와 다름`,
          ],
        });
      } else if (
        j.독립신호수 <= 1 &&
        j.근거.some((g) => g.startsWith("source"))
      ) {
        정상층["C. 신호가 source 하나뿐(메타 전무 past_exam)"].push(base);
      } else if (j.기대학년.length >= 5) {
        정상층["B. 기대집합이 안 좁혀짐(5종 이상)"].push(base);
      } else if (j.기대학년.length >= 2) {
        정상층["D. 기대집합 2종(고1 공통수학1·2 구분 불가)"].push(base);
      } else {
        정상층["E. 근거 두 갈래 + 편 다수 일치(대조군)"].push(base);
      }
      continue;
    }

    const 확신도: "상" | "중" | "하" =
      j.독립신호수 >= 2 && 편내소수파
        ? "상"
        : j.독립신호수 >= 2 || 편내소수파
          ? "중"
          : "하";
    mismatches.push({
      ...base,
      확신도,
      근거: [
        ...j.근거,
        ...(편내소수파
          ? [`편 다수단원=${dom!.grade}(${dom!.n}/${dom!.total})와 다름`]
          : []),
      ],
    });
  }

  // ── 회귀 픽스처: 부록 A-1 의 초등 배정 past_exam 은 전량 잡혀야 한다 ────────
  const 초등기출 = rows.filter(
    (r) => r.source === "past_exam" && /^초/.test(r.unit?.grade ?? ""),
  );
  const 잡힌초등기출 = new Set(
    mismatches
      .filter((m) => m.source === "past_exam" && /^초/.test(m.현재단원))
      .map((m) => m.problemId),
  );
  const 놓친초등기출 = 초등기출.filter((r) => !잡힌초등기출.has(r.id));
  const fixture4509 = mismatches.some((m) => m.externalId === "4509-5");

  mismatches.sort((a, b) => {
    const rank = { 상: 0, 중: 1, 하: 2 } as const;
    return (
      rank[a.확신도] - rank[b.확신도] ||
      String(a.examId).localeCompare(String(b.examId))
    );
  });

  // ── 규칙 비교: 「학기 토큰으로 고1 을 공통수학1·2 로 가른다」를 **같은 열쇠에서** 견준다 ──
  //
  // 유혹적인 규칙이다. 위 층 A(=고1 편에서 공통수학1·2 가 섞인 행)를 메타만으로 갈라줄
  // 유일한 후보다. 그런데 경보 건수를 맞춰 세어 보면 값이 안 맞는다 — 아래 수치를
  // **매 실행마다 다시 찍어** 누가 봐도 기각 이유가 보이게 한다.
  const 학기규칙 = { 잡는것: 0, 헛경보: 0, 헛경보편: new Set<string>() };
  for (const row of rows) {
    if (!row.unit) continue;
    const p = parseSourcePath(row.sourceFile);
    if (p.파일학년 !== "고1" && p.파일학년 !== "고2") continue;
    if (!p.파일학기) continue;
    const 학기기대 =
      p.파일학년 === "고1"
        ? p.파일학기 === "1"
          ? ["공통수학1"]
          : ["공통수학2"]
        : p.파일학기 === "1"
          ? ["대수", "미적분1"]
          : ["미적분2", "확률과 통계", "기하"];
    if (학기기대.includes(row.unit.grade)) continue;
    const j = judge(row);
    // 과목 근거가 그 배정을 **뒷받침**하는데도 학기 규칙만 아니라고 우기면 헛경보다.
    if (j.기대학년?.length === 1 && j.기대학년[0] === row.unit.grade) {
      학기규칙.헛경보 += 1;
      if (row.examId) 학기규칙.헛경보편.add(row.examId);
    } else if (j.기대학년?.includes(row.unit.grade)) {
      학기규칙.잡는것 += 1; // 메타 규칙이 못 좁힌 자리를 새로 잡은 것
    }
  }

  /** 층마다 고르게, **실행마다 같은** 표본을 뽑는다(무작위 금지 — 재현이 안 된다). */
  const stride = <T>(arr: T[], n: number): T[] => {
    if (arr.length <= n) return arr;
    const step = arr.length / n;
    return Array.from({ length: n }, (_, i) => arr[Math.floor(i * step)]);
  };
  const 정상표본 = Object.fromEntries(
    Object.entries(정상층).map(([k, v]) => [
      k,
      { 전체: v.length, 표본: stride(v, 20) },
    ]),
  );

  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(
    `${OUT_DIR}/metadata-unit-mismatch.json`,
    JSON.stringify(
      {
        생성: "scripts/classify/audit-metadata-unit.ts (읽기 전용 · DB 미수정)",
        분모: {
          전체행: rows.length,
          판정가능,
          보류,
          정상,
          오분류: mismatches.length,
          편다수결단독의심: 편다수결단독.length,
        },
        신호별집계: Object.fromEntries(
          [...신호집계.entries()].sort((a, b) => b[1] - a[1]),
        ),
        회귀픽스처: {
          "past_exam·초등단원 전수": 초등기출.length,
          "그중 잡은 것": 초등기출.length - 놓친초등기출.length,
          "놓친 것": 놓친초등기출.map((r) => ({
            externalId: r.externalId,
            unit: r.unit?.grade,
            school: r.school,
            subject: r.subject,
          })),
          "4509-5 잡힘": fixture4509,
        },
        규칙비교_학기토큰: {
          설명: "고1/고2 행에 대해 학기 토큰으로 과목을 좁히는 규칙. 같은 행 집합에서 견준다.",
          "메타 규칙이 못 잡던 것을 새로 잡음": 학기규칙.잡는것,
          "과목 근거가 배정을 뒷받침하는데도 경보": 학기규칙.헛경보,
          "헛경보가 걸린 편 수": 학기규칙.헛경보편.size,
          판정: "기각",
        },
        근거상충: { 건수: 상충행.length, 목록: 상충행 },
        편다수결단독의심: 편다수결단독,
        "정상판정 층별 표본(육안 확인용)": 정상표본,
        목록: mismatches,
      },
      null,
      1,
    ),
    "utf8",
  );

  console.log(`\n전체 ${rows.length} — 판정가능 ${판정가능} · 보류 ${보류}`);
  console.log(
    `판정가능 ${판정가능} 중 정상 ${정상} · **오분류 ${mismatches.length}**`,
  );
  console.log(
    `  확신도 상 ${mismatches.filter((m) => m.확신도 === "상").length} · 중 ${mismatches.filter((m) => m.확신도 === "중").length} · 하 ${mismatches.filter((m) => m.확신도 === "하").length}`,
  );
  console.log(`편 다수결로만 의심(메타로는 허용) ${편다수결단독.length}행`);
  console.log(`근거 상충(판정 보류) ${상충행.length}행`);
  console.log("\n── 정상 판정 층별 ──");
  for (const [k, v] of Object.entries(정상층))
    console.log(`  ${k}: ${v.length}`);
  console.log(
    `\n── 규칙비교(학기 토큰) ── 새로 잡음 ${학기규칙.잡는것} vs 헛경보 ${학기규칙.헛경보}행/${학기규칙.헛경보편.size}편 → 기각`,
  );
  console.log("\n── 신호별 집계 (0건이면 죽은 가드다) ──");
  for (const [k, v] of [...신호집계.entries()].sort((a, b) => b[1] - a[1]))
    console.log(`  ${k}: ${v}`);
  console.log(
    `\n── 회귀 픽스처 ──\n  past_exam·초등단원 ${초등기출.length}건 중 ${초등기출.length - 놓친초등기출.length}건 잡음 · 4509-5 ${fixture4509 ? "잡힘" : "**놓침**"}`,
  );
  if (놓친초등기출.length > 0 || !fixture4509) {
    console.error("\n회귀 픽스처 실패 — 판정기가 틀렸다. 보고서를 믿지 말 것.");
    process.exitCode = 1;
  }
  console.log(`\n→ ${OUT_DIR}/metadata-unit-mismatch.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
