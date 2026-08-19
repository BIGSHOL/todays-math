/**
 * 트랙 «HWP 회수» — **「HWP 원본으로 되찾으면 몇 건이 사는가」를 가르는 규칙 한 곳.**
 *
 * 세는 쪽(`measure-hwp-rescue.ts`)·테스트가 이 파일 하나를 본다.
 *
 * ## 「참」이 어디서 오는가 — 내가 만든 자로 재지 않는다
 *
 * 회복 판정은 **`answerChoiceRules.judgeAnswerChoice` 를 그대로 부른다.** 297건을
 * 세는 데 쓴 바로 그 자다. 전(前)과 후(後)에 **같은 자**를 대므로 전후 비교가 성립한다.
 * 새 규칙을 여기서 만들면 「고친 뒤가 좋아 보이는 자」를 만드는 셈이 된다
 * (CLAUDE.md 2026-08-18 «지표의 참이 제품 상수에서 나오면 성적이 오른다»).
 *
 * 본문은 `hwpJudgeRules.buildHwpContent` 로 짓는다 — 이관 파이프라인
 * (`convertPastExam`)이 실제로 만드는 모양과 같다. 여기서 다른 모양을 지으면
 * 「재추출하면 이렇게 된다」가 아니라 「내가 이렇게 지으면 좋아진다」를 재게 된다.
 * R2 도 마찬가지로 앞 트랙의 `simulate-choice-repairs.splitInlineChoiceMarkers` 를
 * 그대로 부른다 — 옮겨 적으면 두 트랙의 숫자가 말없이 갈라진다.
 *
 * ## 왜 팔이 넷인가 — **HWP 도 같은 자리에서 깨진다**
 *
 * 실측으로 드러났다: 「보기 다섯이 한 줄에 붙은」 부류는 **HWP 원본도 똑같이 붙어
 * 있다.** 게다가 `hwp_extract._split_choices` 는 본문의 빈칸 `①~⑤`(증명 채우기·
 * 순환소수 과정)를 보기로 잘못 잘라, 진짜 보기 다섯은 마지막 칸 안에 통째로 들어간다.
 * 그러니 「HWP 를 넣으면 산다/안 산다」 한 축으로 재면 **파서 결함이 원본 결함으로
 * 둔갑한다.** 그래서 팔을 넷으로 갈라 잰다:
 *
 *   DB      지금 그대로            (전부 치명 — 분모)
 *   DB+R2   파서만 고친다          (원본을 안 봐도 사는 것)
 *   HWP     재추출만 한다          (지금 파서 그대로)
 *   HWP+R2  재추출 + 파서          (둘 다 했을 때)
 *
 * ## 왜 «치명이 아니다» 를 회복으로 세지 않는가
 *
 * `judgeAnswerChoice` 는 보기가 0칸이고 정답이 번호로 안 읽히면 `비객관식` 을 낸다 —
 * 치명이 **아니다.** 그래서 「치명 아님」을 회복으로 세면, HWP 가 보기를 통째로
 * 잃어 서술형처럼 보이게 된 문항이 **회복으로 계산된다.** 회복은 반드시
 * **긍정형**으로 정의한다: `정상` 이어야 회복이다.
 *
 * ## 본문 밖 근거
 *
 * 「보기 다섯이 섰다」는 HWP **본문**만 보고 내리는 판단이다. `_split_choices` 가
 * 상자 안 목록을 보기로 잘못 잡으면 그것도 다섯 칸이다. 그래서 본문과 **독립인**
 * 근거를 따로 센다 — HWP **미주**의 정답과 **배점**이다. 둘 다 본문이 아니라
 * 파일의 다른 자리에서 온다. 근거 없는 회복은 보고서가 따로 세어 사람이 본다.
 */
import { parseProblemContent } from "../../src/lib/problem/parseProblemContent";

import {
  isFatal,
  judgeAnswerChoice,
  readAnswerRef,
  type Judgement,
} from "./answerChoiceRules";
import {
  buildHwpContent,
  containment,
  dice,
  normAnswer,
  sigKo,
  type HwpQ,
} from "./hwpJudgeRules";
import { splitInlineChoiceMarkers } from "./choiceRepairRules";

/** 재 보는 네 갈래. 이름이 곧 「무엇을 했을 때인가」다. */
export const ARMS = ["DB", "DB+R2", "HWP", "HWP+R2"] as const;
export type Arm = (typeof ARMS)[number];

/** 브리프 §2 ㉡ 가 요구하는 갈래. **HWP 팔(HWP·HWP+R2)의 가장 나은 결과**로 정한다. */
export type Rescue =
  /** 보기 1..5 가 다 서고 **기록된 정답 번호가 그 자리**다 — 판정이 `정상`. */
  | "완전회복"
  /** 치명은 벗어났으나 `정상` 이 아니다 (보기 수가 5가 아니다·정답이 번호가 아니다 …). */
  | "치명탈출"
  /** 여전히 치명이나 **HWP 파일 안에 ①~⑤ 목록이 있다** — 사람이 마저 보면 산다. */
  | "부분"
  /** HWP 파일에도 ①~⑤ 목록이 없다 — 보기가 그림이거나 상자·표다. */
  | "HWP도못살림"
  /** 🚩 맞댄 HWP 문항이 **다른 문제**다 — 회복이 아니라 오적용이다. */
  | "문항불일치"
  /** 🚩 보기 칸은 섰는데 **보기가 아니다** (발문 토막이 칸에 들어앉았다). */
  | "보기가짜"
  /** 편·문항을 못 맞댔다 (원본 없음·추출 실패·정렬 근거 없음·판정 불가). */
  | "대응실패";

/** 본문과 **독립인** 근거. HWP 미주·배점은 본문이 아니라 파일의 다른 자리에서 온다. */
export interface OuterEvidence {
  /** HWP 미주 정답이 DB 정답과 **같은 번호**를 가리킨다. */
  정답일치: boolean;
  /** HWP 미주 정답이 DB 와 **다른** 번호를 가리킨다 — 회복해도 답이 갈린다. */
  정답불일치: boolean;
  /** 한쪽이라도 번호로 안 읽혀 견줄 수 없다. */
  정답못견줌: boolean;
  /** DB 배점과 HWP 배점이 같다. */
  배점일치: boolean;
}

export interface RescueInput {
  content: string;
  /** 지금 DB 정답 — 이 트랙은 정답 컬럼을 **읽기만** 한다. */
  answer: string;
  figureUrls: readonly string[];
  score: number | null;
  /** 맞댄 HWP 문항. 못 맞댔으면 `null`. */
  hwp: HwpQ | null;
  /** 편 정렬의 근거 등급 (`hwpJudgeRules.alignExam`). */
  alignGrade: "확정" | "정황" | "근거없음" | "편없음";
}

export interface RescueResult {
  rescue: Rescue;
  /** 팔마다의 판정. `HWP`·`HWP+R2` 는 못 맞댔으면 `null`. */
  arms: Record<Arm, Judgement | null>;
  /** 팔마다의 보기 칸 수(지면에 실제로 찍히는 수). */
  slots: Record<Arm, number>;
  /** `hwp_extract._split_choices` 가 낸 칸 수 — 제품 파서가 본 수와 **다를 수 있다.** */
  hwpChoices: number;
  hwpLen: number;
  evidence: OuterEvidence;
  /** 행 단위 짝 확인 — 편 정렬이 «확정» 이어도 그 행이 같은 문항이라는 뜻은 아니다. */
  pair: PairCheck | null;
  /** 보기 칸이 섰는데 **보기가 아닌** 팔. 보고서가 따로 센다(DB+R2 도 걸린다). */
  fake: Record<Arm, boolean>;
}

const NO_EVIDENCE: OuterEvidence = {
  정답일치: false,
  정답불일치: false,
  정답못견줌: true,
  배점일치: false,
};

/**
 * DB 정답·HWP 미주 정답이 가리키는 보기 번호를 견준다.
 *
 * ⚠️ **표기 정규화만으로 견주면 안 된다.** DB 정답은 `③` 인데 HWP 미주는 `정답 ③`
 * 이거나 값(`22\sqrt5`)일 수 있다. 그래서 **번호로 읽어** 견준다 —
 * `readAnswerRef` 는 297건을 세는 데 쓴 바로 그 자다.
 */
function outerEvidence(
  dbAnswer: string,
  score: number | null,
  hwp: HwpQ,
  bodies: readonly string[],
  labels: readonly number[],
): OuterEvidence {
  const dbRef = readAnswerRef(dbAnswer ?? "", bodies, labels);
  const hwpRaw = (hwp.answer ?? "").replace(/^\s*정답\s*[:：]?\s*/, "");
  const hwpRef = readAnswerRef(hwpRaw, bodies, labels);
  const both = dbRef.nums.length > 0 && hwpRef.nums.length > 0;
  const same =
    both &&
    normAnswer(dbRef.nums.join(",")) === normAnswer(hwpRef.nums.join(","));
  return {
    정답일치: same,
    정답불일치: both && !same,
    정답못견줌: !both,
    배점일치:
      score != null && hwp.score != null && Math.abs(score - hwp.score) < 0.01,
  };
}

/** 「글자는 있는가」의 경계. 보기가 있는 문항의 99% 가 정확히 5칸이라(앞 트랙 실측)
 *  4칸을 «보기 한 벌» 의 하한으로 본다. 문턱이 아니라 **분포**에서 온 값이다. */
const CHOICE_BLOCK_MIN = 4;

/* ────────────────────────────────────────────────────────────────────────────
 * 짝이 맞는가 — **편 정렬이 «확정»이어도 그 행이 같은 문항이라는 뜻은 아니다.**
 *
 * 실측으로 걸렸다: 화원고(편 4542)는 HWP 25문항 · DB 21행인데 **절반만 같은 문항**이고
 * 나머지는 아예 다른 문제다(같은 학교의 «대비» 시험지가 섞인 부류). 편 정렬은
 * 「강한 일치 11건」으로 «확정»을 냈고, 그래서 19번은 **연립방정식 서술형 ↔ 행렬 문제**를
 * 맞대고도 «완전회복»이 됐다. 정답이 둘 다 ⑤ 라 정답 근거도 통과했다 —
 * **«수가 맞는다»는 «짝이 맞는다»가 아니다**(2026-08-18).
 *
 * 그래서 행마다 다시 묻되 **양쪽 비교**로 묻는다. 한쪽 값의 절대 크기로 가르면
 * 손상이 심한 행이 먼저 버려진다(2026-08-16 트랙 D 가 그렇게 거꾸로 걸었다) —
 * DB 가 손상돼 한글이 없는 것은 «짝이 아니다»의 증거가 못 된다. 그래서
 * **양쪽 다 넉넉할 때만** 견주고, 아니면 판단하지 않는다.
 *
 * **무엇을 어떻게 견주는가를 네 번 고쳤다.** 전부 성한 문항에 대 보고 골랐다:
 *
 *   ㉠ DB 발문 ↔ HWP 발문 (Dice)       0.3 미만 5건 / 2,732
 *   ㉡ DB 발문 ↔ HWP 발문+보기 (Dice)  0.3 미만 **26건** ← 한쪽만 늘려 분모가 망가진다
 *   ㉢ DB 전문 ↔ HWP 전문 (Dice)       0.3 미만 6건 / 2,816
 *   ㉣ **DB 전문 ⊇ HWP 전문 (포함도)**  0.3 미만 **4건 / 2,816 (0.142%)** ← 쓴다
 *
 * ㉠~㉢ 은 전부 **Dice** 라 대칭이고, 대칭은 **크기가 다르면 벌한다.** 그런데 이
 * 트랙에서 크기가 다른 것은 정상이다 — DB 한 행에 문항이 뭉쳐 있거나(덕원중 13:
 * 한글 287자), `_split_choices` 가 HWP 발문을 일찍 자르거나(강북중 6: 16자).
 * ㉢ 으로도 그 셋은 Dice 0.11~0.28 로 **«다른 문제»로 몰렸다.** 포함도로 물으니
 * 셋 다 **1.000** 이고, 진짜 다른 문제(화원고 18·19 · 영송여고 16)만 0.03~0.24 로 남았다.
 * **문턱을 옮길 게 아니라 축이 틀렸다**(CLAUDE.md 2026-08-18).
 *
 * 문턱 0.3 도 고른 게 아니라 **분포에서 나왔다** — 제대로 짝지어진 행의 **99.86%**
 * 가 그 위에 있다(p0.5% = 0.556).
 * ──────────────────────────────────────────────────────────────────────────── */
/** 이 아래로는 한글이 손상으로 사라진 것인지 원래 없는 것인지 못 가른다 — 판단하지 않는다. */
const PAIR_MIN_KO = 15;
/** 제대로 짝지어진 행의 99.86% 가 이 위에 있다(실측 2,816건). */
const PAIR_MIN_CONTAIN = 0.3;

export interface PairCheck {
  dbKo: number;
  hwpKo: number;
  /** **판정에 쓰는 축** — HWP 전문이 DB 전문 안에 얼마나 들어 있나 (비대칭). */
  contain: number;
  /** 참고용 Dice(대칭). 판정에 안 쓴다 — 크기가 다르면 벌하기 때문이다. */
  sim: number;
  /** 양쪽이 다 넉넉한데 안 닮았다 = **다른 문항이다.** */
  mismatched: boolean;
  /** 한쪽이 짧아 **견줄 수 없었다** — 「닮았다」도 「안 닮았다」도 아니다. */
  undecidable: boolean;
}

/** `dbContent` 는 DB 본문 **전문**, `hwpAll` 은 HWP 발문+보기 **전문**. 양쪽 다 전문이어야 한다. */
export function pairCheck(dbContent: string, hwpAll: string): PairCheck {
  const a = sigKo(dbContent);
  const b = sigKo(hwpAll);
  const contain = containment(a, b);
  const comparable = a.length >= PAIR_MIN_KO && b.length >= PAIR_MIN_KO;
  return {
    dbKo: a.length,
    hwpKo: b.length,
    contain,
    // Dice 는 **판정에 안 쓴다** — 보고서가 둘을 같이 찍어 다음 사람이 축을 볼 수 있게만 한다.
    sim: dice(a, b),
    mismatched: comparable && contain < PAIR_MIN_CONTAIN,
    undecidable: !comparable,
  };
}

/**
 * **보기 칸이 섰는데 보기가 아닌** 경우를 가른다.
 *
 * R2 로 다시 자르면 «발문 토막 다섯»이 보기 칸에 들어앉아 판정이 `정상` 이 되는
 * 문항이 있다(실측 경산중 10번: 설명문 전체가 1번 칸에 들어가고 진짜 보기
 * `①소거②$y=3-x$③$5$④$2$⑤$1$` 는 5번 칸 끝에 통째로 붙어 있다).
 * 판정기는 **자리**만 보므로 이걸 구조적으로 못 본다.
 *
 * ⚠️ **지금 이 가드는 0건을 잡는다.** 잡히라고 만든 게 아니라, 잡히면 회복으로
 * 세지 않으려고 둔 것이다. 만든 계기였던 경산중 10번은 **제대로 보니 진짜 회복**이었다 —
 * `_split_choices` 가 낸 보기(발문 토막 다섯)를 R2 가 다시 잘라 `소거`·`$y=3-x$`·`$5$`·
 * `$2$`·`$1$` 로 바로잡는다. 추출기의 산출물과 **파서가 실제로 본 것**을 혼동해서
 * 결함으로 읽었던 것이다. 그래도 가드는 남긴다 — 아래 이유로 열쇠가 한 번 틀렸었고,
 * 이 부류가 나면 조용히 회복으로 세어질 자리이기 때문이다.
 *
 * ⚠️ **처음 쓴 열쇠는 틀렸다.** 「보기 몸통에 원문자가 하나라도 있으면 가짜」로 했다 —
 * DB 본문 33,968건에서 0건이라 좋아 보였다. 그런데 그 0은 **컬럼이 달라서** 나온 값이다:
 * DB 본문은 PDF 추출본이라 `①과 ②의…` 같은 참조가 줄머리로 떨어져 **파서가 이미
 * 잘라 간다.** HWP 로 지은 본문은 보기를 한 줄에 앉히므로 참조가 몸통에 남는다.
 * 실제로 압량중 10번의 ③번 보기가 「①과 ②의 닮음조건은 SAS 닮음이다」인데
 * 그 열쇠는 이 **멀쩡한 회복**을 가짜로 몰았다
 * (CLAUDE.md 2026-08-18 «컬럼이 다르면 데이터가 다르다 — content 로 검증하고
 * solution 에 적용하지 마라»).
 *
 * 그래서 **적용할 컬럼(HWP 로 지은 본문)에서 다시 쟀고**, 열쇠를 «참조»가 아니라
 * «목록»으로 바꿨다 — 몸통 안에 **연속한 원문자가 셋 이상** 늘어서면 그 칸은
 * 보기 목록을 통째로 삼킨 것이다. 참조는 길어야 둘(`①과 ②의`)이다.
 * 성한 문항 3,372건의 HWP·HWP+R2 본문에서 **0건**이다(원문자 하나 기준으로도 0이지만
 * 그건 위 이유로 못 믿는다 — 문턱이 아니라 **컬럼**이 문제였다).
 */
const CIRCLED = "①②③④⑤⑥⑦⑧⑨⑩⑪⑫⑬⑭⑮";
/** 참조(`①과 ②의`)는 길어야 둘이다. 셋부터는 목록이다. */
const CIRCLED_RUN_MIN = 3;

/** 몸통 안 «연속 원문자 런» 의 최대 길이. */
export function maxCircledRun(body: string): number {
  let best = 0;
  let run = 0;
  let prev = -99;
  for (const ch of body) {
    const i = CIRCLED.indexOf(ch);
    if (i < 0) continue;
    run = i === prev + 1 ? run + 1 : 1;
    if (run > best) best = run;
    prev = i;
  }
  return best;
}

export function choicesLookFake(content: string): boolean {
  return parseProblemContent(content).choices.some(
    (c) => maxCircledRun(c) >= CIRCLED_RUN_MIN,
  );
}

export function judgeRescue(input: RescueInput): RescueResult {
  const judge = (content: string): Judgement =>
    judgeAnswerChoice({
      content,
      answer: input.answer,
      // 그림은 이 트랙이 안 건드린다 — 지금 붙어 있는 그대로 본다.
      figureUrls: input.figureUrls,
    });

  const db = judge(input.content);
  const dbR2 = judge(splitInlineChoiceMarkers(input.content));

  const matched =
    input.hwp !== null &&
    input.alignGrade !== "근거없음" &&
    input.alignGrade !== "편없음";

  const dbFake = choicesLookFake(input.content);
  const dbR2Fake = choicesLookFake(splitInlineChoiceMarkers(input.content));

  if (!matched) {
    return {
      rescue: "대응실패",
      arms: { DB: db, "DB+R2": dbR2, HWP: null, "HWP+R2": null },
      slots: {
        DB: db.labels.length,
        "DB+R2": dbR2.labels.length,
        HWP: 0,
        "HWP+R2": 0,
      },
      hwpChoices: 0,
      hwpLen: 0,
      evidence: NO_EVIDENCE,
      pair: null,
      fake: { DB: dbFake, "DB+R2": dbR2Fake, HWP: false, "HWP+R2": false },
    };
  }

  const hwp = input.hwp!;
  const hwpContent = buildHwpContent(hwp);
  const h = judge(hwpContent);
  const hR2 = judge(splitInlineChoiceMarkers(hwpContent));

  const arms: Record<Arm, Judgement | null> = {
    DB: db,
    "DB+R2": dbR2,
    HWP: h,
    "HWP+R2": hR2,
  };
  const slots: Record<Arm, number> = {
    DB: db.labels.length,
    "DB+R2": dbR2.labels.length,
    HWP: h.labels.length,
    "HWP+R2": hR2.labels.length,
  };

  // 근거 대조에 쓸 보기 본문은 **가장 나은 HWP 팔** 의 것이어야 값 비교가 성립한다.
  const bestHwp = h.verdict === "정상" ? h : hR2;
  const bestContent =
    h.verdict === "정상" ? hwpContent : splitInlineChoiceMarkers(hwpContent);
  const evidence = outerEvidence(
    input.answer,
    input.score,
    hwp,
    bodiesOf(bestContent, bestHwp.labels.length),
    bestHwp.labels,
  );

  const best = pickBest(h, hR2);
  // 「HWP 파일에 보기 글자가 있는가」 — **두 조각을 다 요구한다.**
  //  ㉠ `_split_choices` 가 ①부터 연속하는 런을 찾았다 (마커가 있다)
  //  ㉡ 그 칸들 안에 **글자가 있다** (비어 있지 않다)
  // 하나만 보면 양쪽으로 틀린다:
  //  · 제품 파서의 칸 수만 보면 → 동부고 13번처럼 보기가 **표 안에** 있어 HWP 텍스트에는
  //    없는데 발문 속 `(ⅰ)(ⅱ)` 조각이 줄머리 마커로 잡혀 «4칸»이 된다.
  //  · 마커 수만 보면 → 보기가 **그림**인 문항(figref 26건)이 `①②③④⑤` 마커만 남기고
  //    본문이 비는데 «보기 다섯»으로 세어진다. 브리프가 「보기가 그림이라 HWP 에도
  //    글자가 없다」고 짚은 바로 그 부류가 «부분» 으로 올라간다.
  const hwpFilled = (hwp.choices ?? []).filter(
    (c) => (c ?? "").trim().length > 0,
  ).length;
  const hwpR2Content = splitInlineChoiceMarkers(hwpContent);
  const fake: Record<Arm, boolean> = {
    DB: dbFake,
    "DB+R2": dbR2Fake,
    HWP: choicesLookFake(hwpContent),
    "HWP+R2": choicesLookFake(hwpR2Content),
  };
  const pair = pairCheck(
    input.content,
    [hwp.stem ?? "", ...(hwp.choices ?? [])].join(" "),
  );
  const bestIsR2 = best === hR2 && h.verdict !== hR2.verdict;

  let rescue: Rescue;
  // 순서가 중요하다: **짝이 아니면 회복을 논할 수 없다.** 이 검사를 뒤에 두면
  // 「정상」이 먼저 잡혀 다른 문제의 본문이 회복으로 세어진다(실측 화원고 18·19).
  if (pair.mismatched) rescue = "문항불일치";
  else if (best.verdict === "정상" && (bestIsR2 ? fake["HWP+R2"] : fake.HWP))
    rescue = "보기가짜";
  else if (best.verdict === "정상") rescue = "완전회복";
  else if (best.verdict === "미분류") rescue = "대응실패";
  else if (!isFatal(best.verdict)) rescue = "치명탈출";
  else if (hwpFilled >= CHOICE_BLOCK_MIN) rescue = "부분";
  else rescue = "HWP도못살림";

  return {
    rescue,
    arms,
    slots,
    hwpChoices: hwp.choices?.length ?? 0,
    hwpLen: hwpContent.length,
    evidence,
    pair,
    fake,
  };
}

/** 두 HWP 팔 중 «나은 쪽». 정상 > 치명아님 > 치명. 같으면 칸이 많은 쪽. */
function pickBest(a: Judgement, b: Judgement): Judgement {
  const rank = (j: Judgement): number =>
    j.verdict === "정상"
      ? 3
      : j.verdict === "미분류"
        ? 0
        : isFatal(j.verdict)
          ? 1
          : 2;
  const ra = rank(a);
  const rb = rank(b);
  if (ra !== rb) return ra > rb ? a : b;
  return a.labels.length >= b.labels.length ? a : b;
}

/** 판정기가 실제로 본 보기 본문 — 값 비교(값일치·번호.값)에 쓴다. */
function bodiesOf(content: string, n: number): string[] {
  if (n === 0) return [];
  // `judgeAnswerChoice` 안의 `choiceLabels` 가 이미 갈랐지만 본문을 안 돌려준다.
  // 같은 규칙을 옮겨 적지 않으려고 제품 파서를 그대로 부른다.
  // (`choiceLabels` 가 «제품 파서의 choices 와 글자 그대로 같을 때만» 라벨을 내므로
  //  이 둘은 정의상 같은 배열이다.)
  return parseChoices(content);
}

function parseChoices(content: string): string[] {
  return parseProblemContent(content).choices;
}

/** §1 의 부류 — 브리프가 「이 트랙이 닿는가」를 가른 축. 원인은 상호배타다. */
export type Family = "본문" | "그림" | "정답데이터" | "지면" | "기타";

export function familyOf(cause: string): Family {
  switch (cause) {
    case "마커가 본문에 아예 없다":
    case "마커가 줄 중간에 붙었다":
    case "여러 문항이 한 행에 뭉쳤다":
      return "본문";
    case "보기 그림 (figref 부류)":
    case "마커는 있으나 본문이 비었다":
      return "그림";
    case "정답 표기가 갈린다":
      return "정답데이터";
    case "번호 순서가 뒤집혔다":
      return "지면";
    default:
      return "기타";
  }
}
