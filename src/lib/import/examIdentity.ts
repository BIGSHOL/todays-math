/**
 * 기출 시험지의 **정체** — 「이 편은 어느 학교의 몇 년 몇 학기 무슨 시험인가」.
 *
 * `Exam` 한 행을 만들려면 학교·학교급·학년·과목·연도·학기·회차가 **전부** 있어야 한다
 * (스키마가 전부 NOT NULL). 하나라도 모르면 그 편은 `Exam` 을 만들지 않는다 —
 * 추측한 값을 흘리면 「오늘의 시험」이 **틀린 근거로 예측한다**.
 *
 * ## 근거를 넷 쓴다. 시점은 **다수결**로 정한다
 *
 * | 근거 | 무엇을 주나 |
 * |---|---|
 * | ① 원본 **문서 제목줄** | 연·학기·회차·대비 |
 * | ② **파일명** | 학교·학년·과목표기·교과서·연·학기·회차 |
 * | ③ 원본이 놓인 **폴더 경로** | 연·학기·회차 (일부만 말할 수 있다) |
 * | ④ 문항이 붙은 **단원 라벨** | 우리 교육과정 과목 |
 *
 * ### ⭐ 왜 어느 하나를 정본으로 못 삼나 (2026-08-18 실측, 2,701편)
 *
 * **둘 다 틀린다.** 처음엔 「문서 제목이 정본」으로 짰는데, 폴더를 셋째 표로 세워 보니
 * 갈라졌다:
 *
 * - **파일명이 틀린 편 35** — 완료본에는 「{학교} 25년 2학기 중간고사 대비」라는 머리말이
 *   **모든 편에** 찍혀 있고 그 연도는 시험 연도 **+1** 이다. 파일명이 제목 대신 그 머리말을
 *   집어 갔다(`[강북고][1][공수2][25-2-중간대비]` 의 제목은 `2024년 2학기 중간고사`).
 * - **문서 제목이 틀린 편 21** — 다른 시험지의 제목줄이 그대로 붙어 있다
 *   (`[영진고][1][수상][24-1-중간]` 의 제목이 `2024년 2학기 기말고사`).
 *   이 부류가 **자연키 충돌 2쌍**을 만들었다 — 가드가 없었으면 한 편이 조용히 덮였다.
 *
 * 그래서 둘이 다르면 **폴더가 어느 쪽을 지지하는지** 보고, 폴더가 갈라 주지 못하면
 * **고르지 않는다**(미분류). **파생물을 정본으로 읽지 않는다**(CLAUDE.md 2026-08-18).
 *
 * ### ⭐ 왜 과목을 파일명에서 안 가져오나
 *
 * 중학교 편 1,513개에는 과목 칸이 **아예 없다**. 고등도 `수1`·`공수`처럼 표기가 흔들린다.
 * 반면 문항이 붙은 `Unit.grade` 는 우리 트리 라벨 그 자체다. 실측에서 파일명 과목 토큰과
 * 단원 라벨은 **한 조합도 갈리지 않았다**(예: `수1`→대수 273편 전량). 그래서 과목은 ③이
 * 정하고, 파일명 표기는 `subjectRaw` 로 **버리지 않고 보존한다**.
 *
 * ## 이 모듈은 DB·파일을 만지지 않는다
 *
 * 순수 함수만 둔다. 파일을 읽는 것은 `scripts/qa/extract-exam-header.py`(줄만 뜬다)이고,
 * 뜻을 정하는 규칙은 **여기 한 곳에만** 있다 — 두 벌이 되면 같이 눈이 먼다.
 */

/** 회차. `Exam.round`·`examRoundSchema` 와 같은 표기다. */
export type ExamRoundLabel = "중간" | "기말";
export type ExamLevelLabel = "중" | "고";

export interface ExamFileNameParse {
  school: string;
  grade: number;
  /** 시험지 원본의 과목 표기. 중학교 편에는 없다 — 지어내지 않는다. */
  subjectRaw: string | null;
  publisher: string | null;
  year: number;
  semester: 1 | 2;
  round: ExamRoundLabel;
  /** 파일명에 「대비」가 붙어 있었다. **시점 판단에 쓰지 않는다**(머리말을 집어 온 것일 수 있다). */
  prepLabelled: boolean;
}

export interface ExamHeaderParse {
  year: number;
  semester: 1 | 2;
  round: ExamRoundLabel;
  /** 제목 자체가 「… 대비」다 — 그 편은 학교의 실제 시험이 아니다. */
  prep: boolean;
  school: string | null;
  grade: number | null;
  subjectRaw: string | null;
}

/**
 * 제목줄이 **훼손된** 편(실측 8편) — `2024년 학기 고사` 처럼 학기·회차 글자가 빠졌다.
 * 연도만 읽히므로 시점을 확정하지 못한다. 「제목이 없다」와 **구분해서** 다룬다:
 * 없으면 파일명을 쓰지만, 훼손이면 파일명이 그 연도와 맞는지 먼저 확인한다.
 */
export interface ExamHeaderDegraded {
  degraded: true;
  year: number | null;
  line: string;
}

export interface SubjectResolution {
  subject: string;
  level: ExamLevelLabel;
  /** 최빈 라벨이 그 편에서 차지하는 비율. 낮으면 단원 배정이 섞였다는 신호다. */
  ratio: number;
}

/**
 * 대괄호 토큰.
 *
 * ⚠️ 한때 `\[+…\]+` 로 «겹친 대괄호(`[[23-1-중간]`, 실측 3편)» 를 막는다고 적어 두었는데,
 * **변이 시험에서 살아남았다** — 홑괄호 정규식도 같은 결과를 낸다(`[` 다음이 `[` 면 그
 * 자리에서 실패하고 한 칸 밀려 제대로 잡는다). 아무것도 안 가르는 장치라 지웠다.
 * (죽은 검사를 남겨 두면 「막고 있다」고 잘못 읽힌다 — CLAUDE.md 2026-08-18.)
 */
const BRACKET = /\[([^[\]]*)\]/g;

/**
 * 기간 토큰. 실측 37종이 하이픈·공백·「년」·네자리 연도로 흔들린다.
 * 「대비」·「고사」는 꼬리로 흘리되 **붙었다는 사실만** 남긴다.
 */
// 캡처 순서: 1 연도 · 2 학기 · 3 회차 · 4 「대비」 (tsconfig target 이 ES2017 이라 명명 캡처 불가)
const PERIOD =
  /^(\d{2,4})\s*년?\s*[-\s]*([12])\s*학?기?\s*[-\s]*(중간|기말)\s*(?:고사)?\s*(대비)?\s*$/;

/** 학년 칸 — 한 자리 숫자. */
const GRADE_TOKEN = /^[1-3]$/;

/** 문서 제목줄: 「2024년 2학기 중간고사」 · 「2025년 2학기 중간고사 대비」 */
// 캡처 순서: 1 연도 · 2 학기 · 3 회차 · 4 「대비」
const HEADER_TITLE =
  /^(\d{4})\s*년\s*([12])\s*학기\s*(중간|기말)\s*고사\s*(대비)?\s*$/;

/**
 * 제목줄이 있기는 한데 학기·회차가 빠진 모양 — `2024년 학기 고사`.
 * ⚠️ 머리말(`{학교} 25년 1학기 중간고사 대비`)이 여기 걸리면 안 되므로 **네 자리 연도**로
 * 시작하고 앞에 다른 글자가 없어야 한다(머리말은 학교명이 앞에 오고 연도가 두 자리다).
 */
// 캡처 순서: 1 연도
const HEADER_TITLE_DEGRADED =
  /^(\d{4})\s*년[^가-힣\d]*(?:[12]?\s*학기)?[^가-힣\d]*(?:중간|기말)?\s*고사\s*(?:대비)?\s*$/;

/** 제목 다음 줄: 「강북고 1학년 수학」 · 「경북고 2학년 확률과통계」 */
// 캡처 순서: 1 학교 · 2 학년 · 3 과목
const HEADER_WHO = /^(\S+?)\s+([1-3])\s*학년\s*(.*?)$/;

/** 제목줄이 앞에서 몇 줄 안에 있는지. 실측 전량 1줄이지만 여백 줄을 견디게 둔다. */
const HEADER_SCAN_LINES = 4;

function toFullYear(raw: string): number {
  const n = Number(raw);
  return n < 100 ? 2000 + n : n;
}

function basename(p: string): string {
  const parts = p.replace(/\\/g, "/").split("/");
  return parts[parts.length - 1] ?? "";
}

/**
 * 파일명을 **구조로** 읽는다 — 토큰 목록을 손으로 쓰지 않는다.
 *
 * 기간 토큰(중간|기말 을 담은 칸)을 먼저 찾고, 나머지를 자리로 가른다:
 * 0번은 학교, 한 자리 숫자는 학년, 남은 것이 둘이면 (과목, 교과서),
 * 하나면 **기간 앞이면 과목 · 뒤면 교과서**다. 이 규칙 하나로 실측 2,703편이 전량 읽힌다
 * (과목이 기간 뒤에 온 1편 포함).
 */
export function parseExamFileName(
  sourceFile: string,
): ExamFileNameParse | null {
  const name = basename(sourceFile ?? "");
  if (!name) return null;

  const tokens: string[] = [];
  for (const m of name.matchAll(BRACKET)) {
    tokens.push((m[1] ?? "").replace(/ /g, " ").trim());
  }
  if (tokens.length === 0) return null;

  const periodIndexes = tokens
    .map((t, i) => (t.includes("중간") || t.includes("기말") ? i : -1))
    .filter((i) => i >= 0);
  if (periodIndexes.length !== 1) return null;
  const pi = periodIndexes[0]!;

  const period = PERIOD.exec(tokens[pi]!);
  if (!period) return null;
  const semester = Number(period[2]);
  if (semester !== 1 && semester !== 2) return null;

  const school = tokens[0];
  if (!school) return null;

  const before = tokens.slice(1, pi);
  const after = tokens.slice(pi + 1);
  const gradeToken = before.find((t) => GRADE_TOKEN.test(t));
  if (!gradeToken) return null;

  const restBefore = before.filter((t) => !GRADE_TOKEN.test(t));
  const rest = [...restBefore, ...after];
  let subjectRaw: string | null = null;
  let publisher: string | null = null;
  if (rest.length === 1) {
    // 하나뿐이면 자리가 가른다 — 기간 앞은 과목, 뒤는 교과서.
    if (restBefore.length === 1) subjectRaw = rest[0]!;
    else publisher = rest[0]!;
  } else if (rest.length >= 2) {
    subjectRaw = rest[0]!;
    publisher = rest[1]!;
  }

  return {
    school,
    grade: Number(gradeToken),
    subjectRaw: subjectRaw || null,
    publisher: publisher || null,
    year: toFullYear(period[1]!),
    semester,
    round: period[3] as ExamRoundLabel,
    prepLabelled: Boolean(period[4]),
  };
}

/**
 * 원본 문서 첫 쪽의 앞줄에서 시점을 읽는다.
 *
 * ⚠️ **머리말을 집지 않는다.** 완료본 4줄째는 「{학교} 25년 2학기 중간고사 대비」인데
 * 연도가 시험 연도 **+1** 이라, 그 줄을 시점으로 읽으면 144편이 한 해 미래로 간다.
 * 그래서 제목 모양(`\d{4}년 …고사`, 네 자리 연도)만 받는다 — 머리말은 두 자리라 안 걸린다.
 */
export function parseExamHeader(
  lines: string[],
): ExamHeaderParse | ExamHeaderDegraded | null {
  const scan = (lines ?? []).slice(0, HEADER_SCAN_LINES);
  let degraded: ExamHeaderDegraded | null = null;
  for (let i = 0; i < scan.length; i += 1) {
    const line = (scan[i] ?? "").trim();
    const m = HEADER_TITLE.exec(line);
    if (!m) {
      // 훼손 제목은 **기억만** 해 두고 계속 본다 — 온전한 제목이 뒤에 있을 수 있다.
      if (!degraded) {
        const d = HEADER_TITLE_DEGRADED.exec(line);
        if (d) degraded = { degraded: true, year: Number(d[1]), line };
      }
      continue;
    }
    const semester = Number(m[2]);
    if (semester !== 1 && semester !== 2) continue;

    const who = HEADER_WHO.exec((scan[i + 1] ?? "").trim());
    return {
      year: Number(m[1]),
      semester,
      round: m[3] as ExamRoundLabel,
      prep: Boolean(m[4]),
      school: who?.[1] ?? null,
      grade: who?.[2] ? Number(who[2]) : null,
      subjectRaw: who?.[3]?.trim() || null,
    };
  }
  return degraded;
}

export function isDegradedHeader(
  header: ExamHeaderParse | ExamHeaderDegraded | null,
): header is ExamHeaderDegraded {
  return Boolean(header && "degraded" in header);
}

export interface FolderPeriod {
  year: number | null;
  semester: 1 | 2 | null;
  round: ExamRoundLabel | null;
}

/** 폴더 이름의 연도 — `2023 기출모음` · `2023년 …` · `24 기출`. */
const FOLDER_YEAR_LONG = /(20\d{2})\s*(?:기출모음|년)/;
const FOLDER_YEAR_SHORT = /^(\d{2})\s*기출$/;
const FOLDER_SEMESTER = /([12])\s*학기/;

/**
 * 원본이 **놓인 폴더**에서 시점을 읽는다 — 파일명·문서 제목과 **독립인 제3의 근거**다.
 *
 * 왜 필요한가: 실측에서 파일명도 문서 제목도 **각각 틀렸다**. 파일명이 머리말 연도를 집어 간
 * 편이 35개, 반대로 **문서 제목이 다른 시험지 것을 그대로 붙여 놓은** 편이 21개다
 * (2026-08-18, 2,701편). 어느 한쪽을 늘 이기게 두면 그 21편(또는 35편)이 조용히 틀린다.
 * 셋째 표가 있어야 갈린다.
 *
 * ⚠️ **깊은 폴더가 이긴다.** `2025년 1학기 기말고사 모음/워드/확통/2학기 기말고사/` 처럼
 * 바깥은 1학기인데 안쪽이 2학기인 배치가 실재한다(실측 57편). 바깥을 집으면 거꾸로 읽는다.
 */
export function parseFolderPeriod(sourceFile: string | null): FolderPeriod {
  const parts = (sourceFile ?? "").replace(/\\/g, "/").split("/");
  parts.pop(); // 파일명은 뺀다 — 그건 다른 근거다
  const out: FolderPeriod = { year: null, semester: null, round: null };
  for (const raw of parts) {
    const seg = raw.trim();
    const long = FOLDER_YEAR_LONG.exec(seg);
    if (long) out.year = Number(long[1]);
    const short = FOLDER_YEAR_SHORT.exec(seg);
    if (short) out.year = 2000 + Number(short[1]);
    const sem = FOLDER_SEMESTER.exec(seg);
    if (sem) out.semester = Number(sem[1]) as 1 | 2;
    if (seg.includes("중간")) out.round = "중간";
    else if (seg.includes("기말")) out.round = "기말";
  }
  return out;
}

interface PeriodTriple {
  year: number;
  semester: 1 | 2;
  round: ExamRoundLabel;
}

const PERIOD_FIELDS = ["year", "semester", "round"] as const;

/**
 * 폴더가 두 후보 중 어느 쪽을 지지하는가.
 *
 * ⚠️ **폴더가 말하는 항목 전부**를 본다 — 「둘이 다른 항목만」 보면 안 된다.
 * 실측 2편에서 폴더가 **둘이 합의한 항목**을 반박했다
 * (`[소선여중][2][25-2-기말]` 이 `2025년 1학기 기말고사 모음/` 아래 있다).
 * 그 폴더 이름은 그 시험지의 시점이 아니라 **묶음의 이름**이라, 학기를 틀리게 말하는
 * 폴더의 회차만 골라 믿을 근거가 없다. 그런 폴더는 심판에서 뺀다 → `null`(고르지 않는다).
 *
 * 폴더가 아무 말도 안 하면 역시 `null` 이다.
 */
function folderVote(
  a: PeriodTriple,
  b: PeriodTriple,
  folder: FolderPeriod,
): "a" | "b" | null {
  const spoken = PERIOD_FIELDS.filter((f) => folder[f] !== null);
  if (spoken.length === 0) return null;
  // 다투는 항목에 대해 아무 말도 안 하는 폴더는 갈라 줄 수 없다.
  if (!PERIOD_FIELDS.some((f) => a[f] !== b[f] && folder[f] !== null))
    return null;
  const supportsA = spoken.every((f) => folder[f] === a[f]);
  const supportsB = spoken.every((f) => folder[f] === b[f]);
  if (supportsA && !supportsB) return "a";
  if (supportsB && !supportsA) return "b";
  return null;
}

/**
 * 과목은 **문항이 붙은 단원**에서 나온다. 파일명 표기가 아니다.
 * 라벨이 섞인 편이 있어(실측 1편: 공통수학1 16 · 공통수학2 2) 최빈값을 쓰고
 * **그 비율을 같이 낸다** — 낮으면 단원 배정이 섞였다는 신호이므로 호출자가 판단한다.
 */
export function resolveCurriculumSubject(
  unitGrades: Record<string, number>,
): SubjectResolution | null {
  const entries = Object.entries(unitGrades ?? {}).filter(([, n]) => n > 0);
  if (entries.length === 0) return null;
  entries.sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const [subject, top] = entries[0]!;
  const total = entries.reduce((s, [, n]) => s + n, 0);
  return {
    subject,
    level: /^중[1-3]$/.test(subject) ? "중" : "고",
    ratio: top / total,
  };
}

export interface ExamKeyInput {
  school: string;
  level: ExamLevelLabel;
  grade: number;
  subject: string;
  year: number;
  semester: number;
  round: ExamRoundLabel;
}

/**
 * `Exam.externalExamId` — **색인 재구축을 견디는 자연키**.
 *
 * 지금 `Problem.examId` 는 testchanger 색인의 rowid 라 색인을 다시 만들면 번호가 밀린다
 * (`docs/planning/tracks/brief-index-rebuild.md`). 그 값을 멱등 키로 쓰면 재구축 뒤에
 * **오류 없이** 중복 삽입되거나 새 편이 조용히 버려진다. 자연키는 그 사건을 안 겪는다.
 *
 * ⚠️ **학년이 반드시 들어간다.** id-scheme 검토가 센 「자연키 중복 861건」은
 * `(학교, 연, 학기, 회차, 과목)` — **학년이 빠진 키**의 수다. 861 조합 중 **859가 학년이
 * 다른 편들**이었다(재현 실측 2026-08-18). 학년을 넣으면 색인 5,925편에서 충돌 3조합,
 * 우리 2,701편에서는 **0조합**이다.
 *
 * 길이는 `@db.VarChar(120)` 안에 **저절로** 든다 — 스키마 상한(학교 50 · 과목 50)에서
 * 재 보면 114자다. 한때 40자로 잘라 두었는데 **변이 시험에서 살아남았다**(자를 일이 없다).
 * 게다가 자르면 앞 40자가 같은 둘이 **한 키가 되어 조용히 덮인다** — 이득 없이 위험만
 * 있는 장치라 지웠다. 상한은 테스트가 지킨다.
 */
export function buildExamKey(input: ExamKeyInput): string {
  return [
    input.school,
    `${input.level}${input.grade}`,
    input.subject,
    `${input.year}-${input.semester}-${input.round}`,
  ].join("|");
}

export interface ExamGroupInput {
  examId: string;
  sourceFile: string | null;
  unitGrades: Record<string, number>;
}

export interface ResolvedExam {
  externalExamId: string;
  school: string;
  level: ExamLevelLabel;
  grade: number;
  subject: string;
  subjectRaw: string | null;
  year: number;
  semester: 1 | 2;
  round: ExamRoundLabel;
  sourceFile: string;
}

export type ExamIdentityDecision =
  | {
      status: "확정";
      exam: ResolvedExam;
      /** 시점을 무엇에서 읽었나 — 다수결에서 이긴 쪽이다. */
      periodSource: "문서제목" | "파일명";
      /** 문서 제목이 이겨서 파일명을 버린 편. 세어서 보고한다. */
      filenameDisagreed: boolean;
      /** 파일명이 이겨서 문서 제목을 버린 편. 제목도 틀린다 — 실측 21편. */
      headerDisagreed: boolean;
      /** 최빈 단원 라벨의 비율 — 낮으면 단원 배정이 섞였다. */
      subjectRatio: number;
    }
  | { status: "제외"; reason: "대비 시험지"; detail: string }
  | { status: "미분류"; reason: string };

/**
 * 셋(문서 제목 · 파일명 · 단원 라벨)을 맞대어 한 편의 정체를 정한다.
 *
 * 규칙 — **모르면 미분류**다. 미분류는 버리는 것이 아니라 **세어서 보고하는** 자리다
 * (목록에 없는 부류는 구조적으로 0이 된다, CLAUDE.md 2026-08-18).
 */
export function decideExamIdentity(input: {
  group: ExamGroupInput;
  header: ExamHeaderParse | ExamHeaderDegraded | null;
}): ExamIdentityDecision {
  const { group } = input;
  const degradedHeader = isDegradedHeader(input.header) ? input.header : null;
  const header = isDegradedHeader(input.header) ? null : input.header;

  if (!group.sourceFile) {
    return { status: "미분류", reason: "원본 파일 경로(sourceFile)가 없다" };
  }
  const file = parseExamFileName(group.sourceFile);
  if (!file) {
    return {
      status: "미분류",
      reason: "파일명에서 학교·학년·시점을 못 읽었다",
    };
  }

  const subject = resolveCurriculumSubject(group.unitGrades);
  if (!subject) {
    return {
      status: "미분류",
      reason: "문항에 붙은 단원이 없어 과목을 정할 수 없다",
    };
  }

  // 학교급은 학교명 접미사와 단원 라벨 **둘 다**에서 나와야 한다. 어긋나면 판단하지 않는다.
  const suffixLevel: ExamLevelLabel | null = file.school.endsWith("중")
    ? "중"
    : file.school.endsWith("고")
      ? "고"
      : null;
  if (!suffixLevel) {
    return {
      status: "미분류",
      reason: `학교명 「${file.school}」에서 학교급(중/고)을 못 읽었다`,
    };
  }
  if (suffixLevel !== subject.level) {
    return {
      status: "미분류",
      reason: `학교급이 어긋난다 — 학교명 ${suffixLevel} · 단원 ${subject.level}(${subject.subject})`,
    };
  }

  const folder = parseFolderPeriod(group.sourceFile);

  // ── 시점을 **다수결**로 정한다 ───────────────────────────────────────────────
  // 어느 한쪽을 늘 이기게 두면 안 된다: 실측에서 파일명이 틀린 편이 35, **문서 제목이
  // 틀린 편이 21** 이었다(제목줄에 다른 시험지 것이 그대로 붙어 있다). 그래서 셋째 표
  // (원본이 놓인 폴더)를 두고, 갈라 주지 못하면 **고르지 않는다**.
  let period: PeriodTriple;
  let periodSource: "문서제목" | "파일명";
  let filenameDisagreed = false;
  let headerDisagreed = false;
  let prep = false;

  if (header) {
    const fromHeader: PeriodTriple = {
      year: header.year,
      semester: header.semester,
      round: header.round,
    };
    const fromFile: PeriodTriple = {
      year: file.year,
      semester: file.semester,
      round: file.round,
    };
    const same = PERIOD_FIELDS.every((f) => fromHeader[f] === fromFile[f]);
    if (same) {
      period = fromHeader;
      periodSource = "문서제목";
      prep = header.prep;
    } else {
      const vote = folderVote(fromHeader, fromFile, folder);
      if (vote === null) {
        return {
          status: "미분류",
          reason:
            `문서 제목(${fromHeader.year}-${fromHeader.semester}-${fromHeader.round})과 ` +
            `파일명(${fromFile.year}-${fromFile.semester}-${fromFile.round})의 시점이 다른데 ` +
            `폴더가 갈라 주지 못한다`,
        };
      }
      if (vote === "a") {
        period = fromHeader;
        periodSource = "문서제목";
        filenameDisagreed = true;
        prep = header.prep;
      } else {
        period = fromFile;
        periodSource = "파일명";
        headerDisagreed = true;
        // ⭐ 시점이 다수결에서 **진** 제목의 「대비」 표기는 근거로 못 쓴다.
        //    그 줄 자체가 다른 시험지 것이라는 뜻이기 때문이다(실측 8편).
        if (header.prep) {
          return {
            status: "미분류",
            reason:
              "문서 제목이 「대비」라고 하는데 그 제목의 시점이 폴더·파일명과 어긋난다 — " +
              "대비본인지 그 해 기출인지 가릴 수 없다",
          };
        }
        if (file.prepLabelled) {
          return {
            status: "미분류",
            reason:
              "파일명에 「대비」가 있고 문서 제목의 시점이 폴더와 어긋난다 — 확정할 수 없다",
          };
        }
      }
    }
  } else {
    // 문서를 못 봤다. 파일명에 「대비」가 있으면 판단하지 않는다 — 실측에서 그 표기는
    // **머리말 연도를 집어 온 것**이었다(연도가 한 해 앞섰다).
    if (file.prepLabelled) {
      return {
        status: "미분류",
        reason:
          "파일명에 「대비」가 있는데 원본 문서 제목을 못 읽었다 — 시점을 확정할 수 없다",
      };
    }
    // 제목이 훼손된 편(실측 10편)은 연도만 읽힌다.
    // ⚠️ 머리말(4줄)로 메우지 않는다 — 머리말은 연도가 +1 이거나 회차 자체가 틀린 편이 있다
    //    (3355: 머리말 「중간」, 파일명 「기말」).
    if (
      degradedHeader &&
      degradedHeader.year !== null &&
      degradedHeader.year !== file.year
    ) {
      return {
        status: "미분류",
        reason: `문서 제목이 훼손됐고(「${degradedHeader.line}」) 읽히는 연도가 파일명(${file.year})과 다르다`,
      };
    }
    // 폴더가 말을 하는데 파일명과 다르면 대조할 제3자가 없다 — 고르지 않는다(실측 20편).
    const spoken = PERIOD_FIELDS.filter((f) => folder[f] !== null);
    const clash = spoken.filter((f) => folder[f] !== file[f]);
    if (clash.length > 0) {
      return {
        status: "미분류",
        reason:
          `원본 문서 제목을 못 읽었고 폴더(${folder.year}-${folder.semester}-${folder.round})가 ` +
          `파일명(${file.year}-${file.semester}-${file.round})과 다르다 — 갈라 줄 근거가 없다`,
      };
    }
    period = { year: file.year, semester: file.semester, round: file.round };
    periodSource = "파일명";
  }

  if (prep) {
    return {
      status: "제외",
      reason: "대비 시험지",
      detail: `문서 제목이 「${period.year}년 ${period.semester}학기 ${period.round}고사 대비」 — 학교의 실제 시험이 아니다`,
    };
  }

  const exam: ResolvedExam = {
    externalExamId: buildExamKey({
      school: file.school,
      level: suffixLevel,
      grade: file.grade,
      subject: subject.subject,
      year: period.year,
      semester: period.semester,
      round: period.round,
    }),
    school: file.school,
    level: suffixLevel,
    grade: file.grade,
    subject: subject.subject,
    subjectRaw: file.subjectRaw ?? header?.subjectRaw ?? null,
    year: period.year,
    semester: period.semester,
    round: period.round,
    sourceFile: group.sourceFile,
  };

  return {
    status: "확정",
    exam,
    periodSource,
    filenameDisagreed,
    headerDisagreed,
    subjectRatio: subject.ratio,
  };
}
