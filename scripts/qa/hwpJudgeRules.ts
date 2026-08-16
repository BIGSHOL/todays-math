/**
 * 트랙 D-2 — **어느 문항이 PDF 경로 때문에 망가졌는지** 가르는 규칙.
 *
 * 전부 갈아엎지 않는다. HWP 가 **확실히 나은 것만** 교체한다. 그래서 신호를 둘로 나눈다.
 *
 *   S* : DB 본문이 망가졌다는 신호 (교체 사유)
 *   H* : HWP 쪽이 더 나쁘다는 신호 (교체 금지 사유 — 개악 방지)
 *
 * 판정 = (S 하나 이상) AND (H 없음). 하나라도 H 가 붙으면 **보류**로 내리고 사람이 본다.
 * "몰림은 조사 단서일 뿐 배제 근거가 아니다"(tracks/README) — 편 단위로 뭉뚱그려 버리거나
 * 살리지 않고 **행 단위로** 판정하되, 번호 정렬이 깨진 편만 통째로 보류한다.
 *
 * 실측으로 잡은 함정 둘 (2026-08-16, 원장님이 짚은 세 건으로 검증):
 *  1. **해설은 문제보다 길다.** 강북고 2928-19 는 DB 723자 · HWP 321자인데 긴 쪽이
 *     해설이었다. 길이만 보고 "HWP 가 짧으니 열위" 로 막으면 진짜 결함을 놓친다.
 *     그래서 해설냄새/문제냄새를 **양쪽에서 비교**하고, 그게 잡히면 길이 가드를 끈다.
 *  2. **워터마크는 한 종류뿐이라 지우면 된다.** HWP 문항 7,793건 중 183건에
 *     `대구광역시 내신 수학 연구회` 가 지면 한가운데 끼어 있었다(다른 문구는 0건).
 *     이걸 교체 금지 사유로 두면 멀쩡한 교체가 막힌다 — **제거하고 교체**한다.
 */

/**
 * HWP 지면에서 본문 흐름에 끼어드는 머리말·꼬리말. 줄 단위로 지운다.
 *
 * 둘 다 실측으로 찾았다 — 문서에 적힌 건 워터마크 하나뿐이었다.
 *  - `대구광역시 내신 수학 연구회` : HWP 문항 7,793건 중 183건(2.3%)
 *  - **작업자 서명** `워드:최성욱t` `오검:조혜미t` `완료:백용선t` : 21,168건 중 988건(4.67%).
 *    완료본 검수 이력이라 지면에는 없는 글자다. 안 지우면 학생 시험지에 사람 이름이 찍힌다.
 */
const WATERMARK_LINES = [
  /^\s*대구광역시\s*내신\s*수학\s*연구회\s*$/,
  /^\s*(?:워드|오검|완료|검수|교정|작업)\s*[:：]\s*\S{0,20}\s*$/,
];
// ⚠️ 지면 머리말(`2024년 1학기 중간고사` / `학원로고` / `강민구` …)은 **여기 넣지 않는다.**
// 한 번 넣어 봤는데 `학원로고` 줄만 지워지고 `달서고 2학년 수학1`·사람 이름 줄은 남아,
// **차단 근거만 없애고 오염은 그대로 들여보내는** 결과가 됐다. 다섯 줄 덩어리의 경계를
// 확실히 못 자르므로 지우지 말고 `H12_HWP지면머리말` 로 **막는다**(0.26%).
/** 작업자 서명 바로 앞에 오는 홀로 선 `정답` 줄. 서명이 있을 때만 지운다 —
 *  `정답` 이 진짜 본문일 수도 있어 단독으로는 근거가 못 된다. */
const ANSWER_TAG_LINE = /^\s*정답\s*$/;
const WORKER_SIGN = /^\s*(?:워드|오검|완료|검수|교정|작업)\s*[:：]/;
/** 지웠는데도 남는 미지의 워터마크·출처 표기 — 이건 사람이 봐야 한다. */
const RESIDUAL_WATERMARK = [
  "무단전재", "저작권", "복제를 금", "출제자 :", "www.", "http",
];

export function stripWatermark(text: string): string {
  if (!text) return text;
  const lines = text.split("\n");
  const hasSign = lines.some((line) => WORKER_SIGN.test(line));
  return lines
    .filter((line) => !WATERMARK_LINES.some((re) => re.test(line)))
    .filter((line) => !(hasSign && ANSWER_TAG_LINE.test(line)))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** 수식(`$...$`)을 걷어낸 한글만 남긴 서명. 지문 대조는 여기서 한다 —
 *  DB 는 LaTeX, HWP 는 한글 수식 스크립트라 수식을 넣고 비교하면 늘 다르다. */
export function sigKo(text: string | null | undefined): string {
  if (!text) return "";
  return (text.replace(/\$[^$]*\$/g, " ").match(/[가-힣]/g) ?? []).join("");
}

export function dice(a: string, b: string): number {
  if (!a || !b) return 0;
  if (a.length < 2 || b.length < 2) return a === b ? 1 : 0;
  const count = (s: string) => {
    const m = new Map<string, number>();
    for (let i = 0; i < s.length - 1; i += 1) {
      const g = s.slice(i, i + 2);
      m.set(g, (m.get(g) ?? 0) + 1);
    }
    return m;
  };
  const A = count(a);
  let total = 0;
  let inter = 0;
  for (const v of A.values()) total += v;
  for (const [g, v] of count(b)) {
    total += v;
    inter += Math.min(v, A.get(g) ?? 0);
  }
  return (2 * inter) / total;
}

/** 해설 지면 냄새. PDF 추출기가 뒤쪽 해설면의 `1.` `2.` 줄머리를 앞 문제 위에 덮어썼다. */
const SOLUTION_MARKS = [
  "따라서", "이므로", "대입하면", "위의 식", "그러므로", "∴",
  "구하는 값은", "주어진 식", "양변을", "정리하면", "이때",
];
/** 문제 냄새 — 발문은 물음으로 끝난다. */
const QUESTION_MARKS = [
  "구하시오", "구하여라", "고르시오", "고르면", "옳은", "옳지", "무엇",
  "?", "하시오", "하여라", "쓰시오", "나타내시오", "보이시오", "구하라",
];

export const countMarks = (text: string, marks: string[]): number =>
  marks.filter((m) => text.includes(m)).length;

/** PUA 잔재·뭉개진 수식. PDF 텍스트 레이어가 HWP 수식폰트를 잘못 되돌린 흔적이다. */
const PUA = /[\uE000-\uF8FF\uFFFD]/;
const MANGLED_OPS = /[∈∉⊂⊃∩∪]{2,}/;
const MANGLED_BRACE = /[\^_]\{[∩∪]\}/;

/**
 * ⚠️ 위 셋만으로는 **큰 무리를 놓친다.** 표본 눈검증(2026-08-16)에서 「유지」로 빠져나간
 * 문항들의 DB 본문이 이랬다:
 *
 *   `<상자> ⁄ • $26+26$ • $42+42+42+42$ …`   ← 원본은 (4²+4²+4²+4²)/(2⁶+2⁶)
 *   `<상자> ∈ • ∉ • ⊂ • ∩ • ∩ • 0.$2x-0$.$3y=2$ • ⁄3 • x-⁄ • 6`
 *
 * 연산자 사이에 ` • ` 가 끼어 `[∈∉⊂]{2,}` 가 안 걸렸고, 지수는 아예 사라져 `2^6` 이
 * `26` 이 됐다. 한글 지문은 멀쩡해 유사도가 0.56 으로 높았다 — **지문 유사도로는
 * 수식 훼손을 못 잡는다.** 그래서 훼손 문자 자체를 본다.
 *
 * 실측 모집단(past_exam 29,682행): `⁄` 866 · 수식 안 `•` 1,979 · 순환소수 `.'` 274 ·
 * 지면 머리말 432. `<상자>` 2,675 는 **훼손이 아니다** — 원본에 실제로 있는 상자다.
 */
/** 분수가 무너져 남은 분수 슬래시(U+2044). */
const FRACTION_SLASH = /⁄/;
/** 수식 안에 줄바꿈이 `•` 로 눌러앉은 것. */
const BULLET_IN_MATH = /\$[^$]*•[^$]*\$/;
/** 순환소수 점이 아포스트로피로 무너진 것 (`1.'9` ← `1.\dot 9`). */
const MANGLED_REPEAT = /\.'/;
/** 지면 머리말·학원 로고가 본문에 딸려 들어온 것. */
const PAGE_FURNITURE = /학원\s*로고/;
/** 해설지가 문항 자리에 들어온 전형적 머리표 — 발문이 `정답` 으로 시작한다. */
const ANSWER_SHEET_HEAD =
  /^\s*(?:\[(?:서술형|서답형|단답형)\s*\$?\d*\$?\]\s*)?정답/;
/** ⑴⑵ 소문항 — 빠지면 `물음에 답하시오.` 만 남아 문제가 성립하지 않는다
 *  (convertPastExam.subQuestionParts 주석: 실측 753건 유실 사고). */
const SUB_MARKS = /[⑴⑵⑶⑷⑸⑹⑺⑻⑼⑽]/;
/** HWP 는 같은 소문항을 `(1)` · `$\left( 1\right)$` 로도 쓴다. `f(1)` 같은 함숫값과
 *  가르려고 **앞에 글자가 없을 때만** 소문항으로 본다. */
const ASCII_SUB_MARKS = /(?:^|[\n\s$])(?:\\left)?\(\s*[1-9]\s*(?:\\right)?\)/;

const hasSubQuestions = (text: string): boolean =>
  SUB_MARKS.test(text) || ASCII_SUB_MARKS.test(text);

export interface DbRow {
  id: string;
  externalId: string | null;
  examId: string;
  n: number;
  problemType: string;
  score: number | null;
  content: string;
  answer: string;
  figs: number;
}

export interface HwpQ {
  number: number;
  stem: string;
  choices: string[];
  answer: string | null;
  solution: string | null;
  topic: string | null;
  score: number | null;
  type: string | null;
  /** 시험지 자신이 찍은 머리표 — `[서술형 3]` · `[단답형 1]` · `[서답형 2]`.
   *  `type` 이 이걸 근거로 정해지므로 판단할 때 원문을 같이 봐야 한다. */
  label: string | null;
}

/** convertPastExam 과 **같은 모양**으로 본문을 짓는다 — 보기는 `1. …` 줄머리.
 *  parseProblemContent 가 다시 갈라 읽는 형식이라 렌더 경로가 어긋나지 않는다. */
export function buildHwpContent(q: HwpQ): string {
  const stem = stripWatermark((q.stem ?? "").trim());
  const choices = (q.choices ?? [])
    .map((c, i) => `${i + 1}. ${stripWatermark(c.trim())}`)
    .join("\n");
  return [stem, choices].filter(Boolean).join("\n\n");
}

export interface Signals {
  S: string[];
  H: string[];
  sim: number;
}

export interface JudgeInput {
  row: DbRow;
  hwp: HwpQ;
  /** parseProblemContent 로 가른 DB 지문/보기 */
  dbQuestion: string;
  dbChoices: string[];
  /** KaTeX 실패(math-raw 폴백) 개수 */
  dbMathFail: number;
  hwpMathFail: number;
  dbMathTotal: number;
  hwpMathTotal: number;
}

export function judgeSignals(input: JudgeInput): Signals {
  const { row, hwp, dbQuestion, dbChoices } = input;
  const S: string[] = [];
  const H: string[] = [];

  const dbSig = sigKo(row.content);
  const hwpContent = buildHwpContent(hwp);
  const hwpSig = sigKo(hwpContent);
  const sim = dice(sigKo(hwp.stem), sigKo(dbQuestion));

  const dbSol = countMarks(dbQuestion, SOLUTION_MARKS);
  const dbQ = countMarks(dbQuestion, QUESTION_MARKS);
  const hwpQ = countMarks(hwp.stem ?? "", QUESTION_MARKS);

  // ── S: DB 가 망가졌다 ──────────────────────────────────────────────
  // 강북고 2928 1~12번은 본문이 통째로 "정답" 두 글자였다(실측 DB 2자).
  const S1 = row.content.trim().length < 30 && hwpContent.trim().length >= 60;
  if (S1) S.push("S1_초단문");

  // 해설이 문제 자리를 덮었다. **양쪽을 비교**해야 한다 — DB 만 보면
  // 긴 해설이 "충실한 본문" 으로 보인다(국제고 2697-2: DB 3336자가 통째로 해설면).
  const S2 = dbSol >= 2 && dbQ === 0 && hwpQ >= 1 && hwpSig.length >= 10;
  if (S2) S.push("S2_해설냄새");

  if (PUA.test(row.content) || MANGLED_OPS.test(row.content) || MANGLED_BRACE.test(row.content)) {
    S.push("S3_PUA잔재");
  }
  // 지문이 아예 다른 문항이다 — 해설이 앞 문제를 덮은 전형적 결과.
  if (dbSig.length >= 8 && hwpSig.length >= 8 && sim < 0.35) S.push("S4_유사도바닥");

  if ((hwp.choices?.length ?? 0) >= 4 && dbChoices.length === 0) S.push("S5_보기결손");

  // 수식이 DB 에서만 깨진다 — PDF 텍스트 레이어가 만든 훼손.
  if (input.dbMathFail > input.hwpMathFail) S.push("S6_수식렌더실패");

  // 물음이 통째로 사라졌다. HWP 는 묻는데 DB 는 안 묻는다.
  if (hwpQ >= 1 && dbQ === 0 && sim < 0.5 && dbSig.length >= 8) S.push("S7_발문소실");

  // ── 표본 눈검증으로 뒤늦게 추가한 신호들 (거짓 음성 사냥) ────────────
  if (FRACTION_SLASH.test(row.content) || BULLET_IN_MATH.test(row.content)) {
    S.push("S8_수식뭉갬");
  }
  if (MANGLED_REPEAT.test(row.content) && !MANGLED_REPEAT.test(hwpContent)) {
    S.push("S9_순환소수뭉갬");
  }
  // 발문이 `정답` 으로 시작한다 = 해설지 지면이 문항 자리에 들어왔다.
  // S2 는 `따라서`·`이므로` 를 세는데, 수식 위주 해설에는 그런 접속어가 없어 새어 나갔다
  // (실측 5836-16: DB 한글이 "정답풀이" 넉 자뿐이라 길이 가드에도 걸렸다).
  const S10 = ANSWER_SHEET_HEAD.test(dbQuestion) && hwpQ >= 1;
  if (S10) S.push("S10_해설지머리표");

  // 한글 지문이 통째로 날아갔다. 길이 비교라 수식 위주 문항에서도 잡힌다.
  if (hwpSig.length >= 15 && dbSig.length < hwpSig.length * 0.3) S.push("S11_지문소실");

  // 시험지 머리말·학원 로고가 본문에 딸려 들어왔다.
  const S12 = PAGE_FURNITURE.test(row.content) && !PAGE_FURNITURE.test(hwpContent);
  if (S12) S.push("S12_지면머리말혼입");

  // ── H: HWP 가 더 나쁘다 (교체가 개악이 되는 경우) ──────────────────
  // ⚠️ 원래 `hwpSig.length < 6` (한글이 여섯 자 미만) 도 빈약으로 봤는데 **거꾸로였다.**
  // 「$\sum_{k=1}^{9} a_k = 12$ 일 때 … 의 값은?」 같은 수식 위주 문항은 한글이 원래
  // 몇 자뿐이다. 실측에서 DB 가 Σ 를 통째로 잃은 문항(`$_{k=1}^{9}a_{k}$`)이 이 조건에
  // 걸려 보류로 내려갔다 — 고쳐야 할 것을 못 고치게 막고 있었다.
  //
  // 그 다음엔 "DB 한글이 넉넉한데 HWP 만 없으면" 으로 좁혀 봤지만 그것도 새어 나갔다:
  // DB 의 한글이 넉넉한 이유가 **옆 문항 해설·머리말이 딸려 들어와서**인 경우가 있다
  // (3947-19: DB 보기 10개 중 5개가 다음 문제 풀이 상자). 오염된 길이를 근거로 삼으면
  // 오염이 심할수록 교체가 막힌다. 그래서 **HWP 자체가 비었는지만** 본다.
  if (hwpContent.trim().length < 20) H.push("H1_HWP빈약");

  // 지워도 남은 미지의 워터마크·출처 표기.
  if (RESIDUAL_WATERMARK.some((w) => hwpContent.includes(w))) H.push("H2_잔여워터마크");

  // HWP 가 지문을 잃었다. ⚠️ S1·S2 가 잡혔으면 **끄다** — 해설은 원래 문제보다 길다.
  // S12 가 잡혔으면 끈다 — DB 의 한글이 긴 이유가 **머리말 오염 그 자체**라
  // ("…학원로고2024년 2학기 기말고사장산중 2학년 수학…") 오염이 심할수록 H3 가 세게
  // 걸려 교체를 막는 거꾸로 된 가드가 된다.
  // ⚠️ 전체 본문이 아니라 **발문끼리** 견준다. 오염(옆 문항 해설·머리말·중복 보기)은
  // 거의 보기 쪽에 쌓이므로 전체 길이로 재면 오염이 DB 를 "충실한 본문" 으로 보이게 한다.
  const dbQSig = sigKo(dbQuestion);
  const hwpQSig = sigKo(hwp.stem ?? "");
  if (
    !S1 && !S2 && !S10 && !S12 &&
    dbQSig.length >= 20 && hwpQSig.length < dbQSig.length * 0.6
  ) {
    H.push("H3_HWP더짧음");
  }
  // 표는 HWP XML 을 훑으면 칸 구분이 사라져 한 줄로 뭉갠다. DB 는 `[표]` 로 보존돼 있다.
  if (row.content.includes("[표]") && !hwpContent.includes("[표]")) H.push("H4_표구조손실");

  if (input.hwpMathFail > input.dbMathFail) H.push("H5_렌더열위");

  // HWP 쪽에도 PUA 가 남은 편이 있다(실측 문항의 0.18%). DB 에 없는 PUA 를 새로
  // 집어넣는 건 개악이다 — S3 로 잡은 훼손을 다른 훼손으로 바꾸는 꼴이 된다.
  if (PUA.test(hwpContent) && !PUA.test(row.content)) H.push("H11_HWP에PUA");

  // **HWP 에도 지면 머리말이 딸려 들어온 편이 있다**(실측 문항의 0.26%).
  //   `2024년 1학기 중간고사 / 지수 ~ 삼각함수 / 강동고 2학년 수학1 / 학원로고 / 강민구`
  // 다섯 줄 덩어리인데, 위 두 줄(고사명·학원로고)만 줄 단위로 확실히 지울 수 있고
  // 학교·과목·사람 이름 줄은 경계를 못 믿는다. 그래서 **지운 뒤에도 흔적이 남으면**
  // 교체하지 않고 사람에게 넘긴다 — 학생 시험지에 남의 학원 이름이 찍히면 안 된다.
  if (PAGE_FURNITURE.test(hwpContent) && !PAGE_FURNITURE.test(row.content)) {
    H.push("H12_HWP지면머리말");
  }
  if (dbChoices.length >= 4 && (hwp.choices?.length ?? 0) < 4) H.push("H6_보기손실");

  // 그림 파일이 안 붙은 문항의 `[그림] 말풀이` 는 **유일한 단서**다(10-handoff §8.5).
  // 그림이 붙어 있으면(figs>0) 이미지가 남으므로 막지 않는다.
  if (row.figs === 0 && row.content.includes("[그림]") && !hwpContent.includes("[그림]")) {
    H.push("H7_그림단서손실");
  }
  // ⑴⑵ 소문항이 DB 에만 있다 — 빼면 `물음에 답하시오.` 만 남는다.
  // 단 HWP 는 같은 소문항을 `(1)` `$\left( 1\right)$` 로 쓰기도 한다. 그래서
  // **HWP 가 DB 보다 길면 잃은 게 아니다** — 표기만 다르다(실측 2952-16: DB 88자에
  // ⑴⑵, HWP 202자에 `(1)(2)` 와 사라진 ∫ 까지 온전).
  if (
    SUB_MARKS.test(row.content) &&
    !hasSubQuestions(hwpContent) &&
    hwpContent.length <= row.content.length
  ) {
    H.push("H8_소문항손실");
  }

  // 보기가 **그림**인 문항은 HWP 텍스트에 빈 보기만 남는다(실측 3845-2: 사각형 4개가
  // 전부 그림). 그대로 넣으면 `1.` `2.` `3.` `4.` 만 찍힌 보기가 된다 — 개악이다.
  const hwpChoices = hwp.choices ?? [];
  const emptyChoices = hwpChoices.filter((c) => !c || !c.trim()).length;
  if (hwpChoices.length > 0 && emptyChoices * 2 >= hwpChoices.length) {
    H.push("H10_HWP빈보기");
  }

  return { S, H, sim };
}

export type Verdict = "교체" | "보류" | "유지";

export function verdictOf(s: Signals): Verdict {
  if (s.S.length === 0) return "유지";
  return s.H.length === 0 ? "교체" : "보류";
}
