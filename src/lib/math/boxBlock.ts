/**
 * `<보기>` · `<조건>` 상자 파싱 — mathgen `wrapBareConditionBoxes`(Stage 1.9) 이식.
 *
 * ── 왜 그대로 복사하지 않았는가 ─────────────────────────────────────────────
 * 정본: `F:\mathgen\src\components\math\MarkdownRenderer.tsx` 717행(Stage 1.9) +
 *      `F:\mathgen\src\lib\textPreprocess.ts` 744행 `wrapBareConditionBoxes`.
 * mathgen 은 **모델 생성물**을 받는다 — 헤더가 제 줄에 있고 항목이 제 줄에 있다.
 * 그래서 정본은 «헤더 줄 다음의 연속 항목 줄» 을 `> ` 로 감싸는 **줄 단위** 규칙이다.
 *
 * 우리 입력은 **PDF 텍스트 레이어 추출본**이라 줄이 없다. DB 전수(47,152건) 실측:
 *   - 상자 마커가 있는 문항 2,987건(6.33%)
 *   - 마커 모양이 27가지 (`<보기>` `< 보 기 >` `[보기>` `〈보기〉` …)
 *   - 헤더가 항목과 붙어 흐르거나(`<보기>ㄱ. …ㄴ. …`), 라벨이 **항목 뒤로** 밀려 있다(93건)
 *   - 마커가 발문 안 참조로만 있고 항목이 뒤따르는 문항도 있다(96건)
 * 줄 단위 규칙을 그대로 옮기면 이 중 대부분을 놓친다. 그래서 규칙을 뒤집었다 —
 * **마커는 「상자가 있다」만 알려 주고, 상자의 경계는 «항목» 이 정한다.**
 * (CLAUDE.md 2026-08-16~17: 손상이 심할수록 그 손상을 정상으로 읽는 가드가 생긴다.
 *  마커에 기대는 가드는 마커가 깨진 문항 — 즉 가장 고쳐야 할 문항 — 을 먼저 버린다.)
 *
 * ── 안전 원칙 ────────────────────────────────────────────────────────────
 * 1. 마커가 **하나도 없으면 입력 문자열을 그대로 돌려준다.** 상자 없는 44,165건은 불변.
 * 2. 항목을 못 나누면 **억지로 쪼개지 않는다.** 통짜 한 항목으로 상자에만 넣는다
 *    (잘못 쪼개면 「옳은 것의 개수」가 달라 보인다 — 문제가 바뀐다).
 * 3. 항목 계열은 **오름차순**이라야 인정한다. `이다.`·`했다.` 의 `다.` 가 가나다 항목으로
 *    읽히는 오탐이 프로토타입에서 실제로 났다.
 * 4. 수식(`$…$`) 안의 기호는 마커로 읽지 않는다 (`$h=(g∘g)(x)$` 의 `∘`).
 *
 * 규칙별 근거와 실측치는 `docs/planning/tracks/reports/render-b-box.md`.
 */
import { findSubQuestionMarkers } from "@/lib/math/subQuestion";

/** 상자 라벨 — 정본 `blocksToMarkdown.ts` 32행 BOX_MARKERS 와 같은 셋. */
export type BoxLabel = "보기" | "조건" | "상자";

export interface BoxSegment {
  kind: "box";
  label: BoxLabel;
  /**
   * 라벨 머리를 **그리지 않는** 상자.
   *
   * 원장님(2026-08-18): "다음 작은 수를 네모 박스 안에 넣으면 더 깔끔할텐데".
   * 발문 뒤에 마커 없이 늘어선 **나열 대상**이 그렇다 — 그건 «보기»도 «조건»도
   * 아니라서 머리에 라벨을 얹으면 없던 이름이 생긴다. 테두리만 두른다.
   */
  headerless?: boolean;
  /** 헤더와 첫 항목 사이에 낀 줄(대개 OCR 잔재). 없으면 빈 문자열. */
  lead: string;
  /** 항목 본문. 마커(`ㄱ.`, `∘`)를 **포함한** 원문 — 임의로 지우지 않는다. */
  items: string[];
}

export interface TextSegment {
  kind: "text";
  text: string;
}

export type ContentSegment = TextSegment | BoxSegment;

/* ────────────────────────────────────────────────────────────────────────
 * 1. 마커 정규화
 * ──────────────────────────────────────────────────────────────────────── */

/** 실측 27종이 쓰는 여는 괄호. `[보기>` 처럼 짝이 안 맞는 것이 실제로 있다(10건). */
const OPEN_BRACKETS = "<〈［\\[＜《≪〔【";
const CLOSE_BRACKETS = ">〉］\\]＞》≫〕】";
/** 글자 사이 공백은 HWP 자간 벌리기의 흔적이다 — `< 보 기 >` 가 458건. */
const BOX_WORDS = "보\\s*기|조\\s*건|상\\s*자";

const BOX_MARKER_RE = new RegExp(
  `[${OPEN_BRACKETS}]\\s*(${BOX_WORDS})\\s*[${CLOSE_BRACKETS}]`,
  "g",
);

/** 정규형. 마크다운에서 `<보기>` 는 ASCII 태그명이 아니라 HTML 로 파싱되지 않는다 —
 *  그래서 이스케이프 없이 글자 그대로 살아 남는다(react-markdown v10 실측). */
const CANONICAL_MARKER_RE = /<(보기|조건|상자)>/g;

/** 15종 이상으로 흩어진 상자 마커를 하나의 정규형(`<보기>`)으로 모은다. */
export function normalizeBoxMarkers(text: string): string {
  if (!text) return text;
  return text.replace(
    BOX_MARKER_RE,
    (_match, word: string) => `<${word.replace(/\s+/g, "")}>`,
  );
}

/**
 * 정규화가 **못 잡은** 마커 흔적. 정규화만 하고 잔여를 안 세면
 * 「다 모았다」는 착각이 남는다 (10-handoff §8.5 동어반복 측정).
 *
 * 실제로 남는 것: 마커가 수식으로 쪼개진 `$<$ 조건 $>$`, 번호가 붙은 `<조건 1>`.
 */
export function findUnnormalizedBoxMarkers(text: string): string[] {
  if (!text) return [];
  const canonical = normalizeBoxMarkers(text);
  const found: string[] = [];
  const AROUND = /[^\n]{0,4}(?:보\s*기|조\s*건|상\s*자)[^\n]{0,4}/g;
  for (const match of canonical.matchAll(AROUND)) {
    const around = match[0];
    if (/<(?:보기|조건|상자)>/.test(around)) continue; // 이미 정규형
    // 괄호 흔적이 전혀 없으면 일반 명사다("보기 좋은", "조건을 만족").
    if (!new RegExp(`[${OPEN_BRACKETS}${CLOSE_BRACKETS}]`).test(around))
      continue;
    found.push(around);
  }
  return found;
}

/* ────────────────────────────────────────────────────────────────────────
 * 2. 항목 계열
 * ──────────────────────────────────────────────────────────────────────── */

interface Family {
  readonly name: string;
  readonly seq: readonly string[];
  /** 계열 원소 하나를 찾는 정규식 소스. */
  readonly pattern: (ch: string) => string;
  /** true 면 첫 원소(ㄱ·가)가 반드시 있어야 그 계열로 인정한다. */
  readonly requireFirst?: boolean;
}

const JAMO = [..."ㄱㄴㄷㄹㅁㅂㅅㅇㅈㅊㅋㅌㅍㅎ"];
const GANADA = [..."가나다라마바사아자차"];

/**
 * 우선순위 순. 한글 **자모**(ㄱ~ㅎ)는 완성형 한글(가~힣)과 코드 영역이 달라
 * 일반 문장에 나오지 않는다 — 그래서 어디에 있든 항목으로 봐도 안전하다.
 * 반대로 가나다(`가.`/`나.`/`다.`)는 문장 끝(`이다.`)과 겹치므로
 * **줄머리·공백 뒤**로 묶고 첫 원소(`가.`)를 요구한다.
 */
const FAMILIES: readonly Family[] = [
  { name: "jamoParen", seq: JAMO, pattern: (c) => `\\(\\s*${c}\\s*\\)` },
  // `(ㄱ)` 을 먼저 보므로 여기서는 여는 괄호에 붙은 것을 제외한다.
  { name: "jamoDot", seq: JAMO, pattern: (c) => `(?<![(（])${c}\\s*[.)]` },
  { name: "circledJamo", seq: [..."㉠㉡㉢㉣㉤㉥㉦㉧㉨㉩"], pattern: (c) => c },
  { name: "parenJamo", seq: [..."㈀㈁㈂㈃㈄㈅"], pattern: (c) => c },
  { name: "parenGanada", seq: [..."㈎㈏㈐㈑㈒㈓"], pattern: (c) => c },
  { name: "circledGanada", seq: [..."㉮㉯㉰㉱㉲"], pattern: (c) => c },
  { name: "ganadaParen", seq: GANADA, pattern: (c) => `\\(\\s*${c}\\s*\\)` },
  {
    name: "ganadaDot",
    seq: GANADA,
    pattern: (c) => `(?:^|[\\n\\s])${c}\\s*[.)]`,
    requireFirst: true,
  },
  { name: "circledLatin", seq: [..."ⒶⒷⒸⒹⒺ"], pattern: (c) => c },
];

/**
 * 불릿 문자. **같은 글자가 2회 이상**일 때만 항목 구분자로 본다.
 * `·`(가운뎃점)와 `※`는 뺐다 — `3·4` 같은 정상 표기와 겹치고, 실측 빈도도 낮다.
 * `①②③`·`⑴⑵⑶`도 뺐다: 앞은 **선택지 마커**이고 뒤는 **소문항 번호**라
 * 상자 항목으로 읽으면 상자가 선택지·소문항까지 삼킨다(프로토타입에서 실제로 났다).
 */
const BULLET_CHARS = [..."∘•◦○⦁∙⚪⚬◯⸰◎✽Ÿ●॰"];

/**
 * 상자를 끊는 신호 ① 서술형 라벨. 이건 수식에 갇히는 일이 없어 probe 에서 본다.
 *
 * ⚠️ 소문항 번호는 **여기서 빼냈다** (2026-08-18 회귀). 예전 규칙은
 * `[⑴⑵⑶⑷⑸⑹]` 여섯 글자만 알았고 그마저 **수식이 가려진 probe** 에서 찾았다.
 * 실데이터의 소문항은 `$(1)~$` 처럼 수식 span 통째로 실려 있어(가려진다)
 * 반각 괄호이며 ⑺ 이상으로도 이어진다 — 셋 다 못 봤다. 그래서 상자가 하위 문항과
 * 시험지 머리말까지 삼켰다(원장님 스크린샷, id dba88a32).
 * 이제 판정은 `subQuestion.ts` 한 군데가 한다.
 */
const ESSAY_LABEL_RE = /\[\s*서[술답]형/;

/**
 * 상자를 끊는 신호 ② 시험지 머리말. **연도·학기·고사 이름이 함께** 있어야 한다.
 *
 * `\d{4}년` 하나로 판정하면 «(사) **2024년에** 대건고에 입학한 고등학생의 모임»
 * 같은 **멀쩡한 항목**을 자른다(실측 65152d84). `기말고사` 하나로 판정하면
 * 성적표 항목(«• 기말고사 • 수행평가 • 1차», 66b6d751)을 자른다.
 * 셋이 같이 있는 자리는 시험지 머리말뿐이었다.
 */
const EXAM_HEADER_RE = /\d{4}\s*년\s*\d\s*학기\s*(?:중간|기말)\s*고사/;

/** 괄호원문자 `⑴`(U+2474) ~ `⒇`(U+2487) — 소문항 번호로만 쓰이는 전용 글자. */
const PAREN_DIGIT_RE = /[⑴-⒇]/g;

/** 발문 안 참조(`<보기>에서`, `<조건>을`)를 상자 머리와 가른다. */
const PARTICLE_AFTER_MARKER =
  /^\s*(?:에서|에게|에|의|을|를|이며|이고|이다|이|가|은|는|와|과|만|중|처럼|대로|같이|로|으로|보다|부터|까지|랑|도)/;

/** 그림 자리표시자 — 상자 내용으로 치지 않는다(그림은 ProblemContent 가 따로 그린다). */
const FIGURE_PLACEHOLDER_RE = /\[\s*그\s*림\s*\d*\s*\]/g;

interface ItemHit {
  start: number;
}

/** 계열 원소를 **순서대로** 앞에서 뒤로 훑는다 → 오름차순이 구조적으로 보장된다. */
function scanAscending(probe: string, family: Family): ItemHit[] {
  const hits: ItemHit[] = [];
  let cursor = 0;
  for (let i = 0; i < family.seq.length; i += 1) {
    const regex = new RegExp(family.pattern(family.seq[i]!), "g");
    regex.lastIndex = cursor;
    const match = regex.exec(probe);
    if (!match) {
      if (i === 0 && family.requireFirst) return [];
      continue;
    }
    // 선행 공백·줄바꿈은 마커가 아니다 — 항목은 마커 글자에서 시작한다.
    const padding = match[0].length - match[0].trimStart().length;
    hits.push({ start: match.index + padding });
    cursor = match.index + match[0].length;
  }
  return hits;
}

/**
 * 원본 지면이 **2단**이면 추출 순서가 `ㄱ ㄷ ㄴ ㄹ` 이 된다(세로로 읽는 배치).
 * 오름차순만 보면 `ㄷ` 가 `ㄱ` 항목에 붙어 버린다 — 실측 41건(상자의 1.1%).
 *
 * 그래서 «각 원소가 **정확히 한 번**» 나올 때만 순서를 풀고 **나온 자리 순서**로 쓴다.
 * 「정확히 한 번」이 열쇠다. 문장 끝 `다.` 는 여러 번 나오므로 여기 걸리지 않는다.
 * 가나다처럼 평문과 겹치는 계열(`requireFirst`)은 아예 이 완화를 쓰지 않는다.
 */
function scanUnique(probe: string, family: Family): ItemHit[] {
  const hits: ItemHit[] = [];
  for (const element of family.seq) {
    const regex = new RegExp(family.pattern(element), "g");
    const matches = [...probe.matchAll(regex)];
    if (matches.length === 0) continue;
    if (matches.length > 1) return []; // 여러 번 나오면 항목 마커로 못 믿는다
    const match = matches[0]!;
    const padding = match[0].length - match[0].trimStart().length;
    hits.push({ start: match.index + padding });
  }
  return hits.sort((a, b) => a.start - b.start);
}

function findFamilyItems(probe: string, family: Family): ItemHit[] {
  const ascending = scanAscending(probe, family);
  if (family.requireFirst) return ascending;
  const unique = scanUnique(probe, family);
  return unique.length > ascending.length ? unique : ascending;
}

/**
 * 실측 상한. 보기·조건 항목이 10개를 넘는 일은 없다(자모 계열도 ㄱ~ㅎ 14개가 한계).
 * 넘는 것은 전부 **표의 칸 구분자**이거나 **깨진 수식 조각**이었다 —
 * 제곱근표 20칸, 귀납법 증명 56조각(실측). 그것을 목록으로 그리면 지면만 길어진다.
 */
const MAX_BULLET_ITEMS = 10;
/** 토막이 대부분 한두 글자면 목록이 아니라 표·수식 파편이다. */
const MIN_BULLET_BODY = 3;

/** 같은 불릿이 2회 이상 반복되면 항목 구분자다. */
function findBulletItems(probe: string): ItemHit[] {
  let best: ItemHit[] = [];
  for (const bullet of BULLET_CHARS) {
    const hits: ItemHit[] = [];
    for (let i = 0; i < probe.length; i += 1) {
      if (probe[i] !== bullet) continue;
      // `∘∘` 처럼 붙어 있는 것은 한 마커의 중복이다.
      if (hits.length > 0 && i === hits[hits.length - 1]!.start + 1) continue;
      hits.push({ start: i });
    }
    if (hits.length >= 2 && hits.length > best.length) best = hits;
  }
  if (best.length < 2) return [];
  // 마지막 불릿 뒤에 내용이 없으면 목록이 아니다(장식용 기호).
  if (probe.slice(best[best.length - 1]!.start + 1).trim() === "") return [];
  if (best.length > MAX_BULLET_ITEMS) return [];

  let thin = 0;
  for (let i = 0; i < best.length; i += 1) {
    const end = i + 1 < best.length ? best[i + 1]!.start : probe.length;
    if (probe.slice(best[i]!.start + 1, end).trim().length < MIN_BULLET_BODY)
      thin += 1;
  }
  return thin * 2 > best.length ? [] : best;
}

/* ────────────────────────────────────────────────────────────────────────
 * 2-B. 상자를 끊는 자리 — 하위 문항·시험지 머리말 (2026-08-18 회귀)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 상자 내용의 **머리** — 항목 기호(불릿·`$\circ$`·`ㅇ`)를 걷어낸 뒤의 위치.
 *
 * 소문항 번호가 이 자리에서 시작하면 그것은 **상자 자기 항목의 번호**다
 * (실측 2aa85246 `<조건>⑴ 다항식 A는 …⑵ …⑶ …`). 그때는 하나도 끊지 않는다 —
 * 첫 번호만 봐주고 `⑵` 에서 끊으면 조건 셋 중 둘이 상자 밖으로 튀어나간다.
 */
/**
 * 번호 바로 뒤에 붙어 «가리킴»을 만드는 조사. 띄어쓰기 없이 붙는 것만 본다 —
 * `⑴의 풀이` 는 참조, `⑴ 다항식 A는` 은 항목 번호다.
 */
const REFERENCE_PARTICLE_RE = /^(?:의|에|은|는|을|를|과|와|이|가)/;

const CONTENT_HEAD_RE = new RegExp(
  `^(?:\\s|[${BULLET_CHARS.join("")}]|ㅇ|○|\\$\\s*\\\\(?:circ|bullet)\\s*\\$)*`,
);

/**
 * 상자가 끝나야 하는 자리(원문 절대 위치). 없으면 -1.
 *
 * 신호 셋을 모아 **가장 이른 것**을 쓴다:
 *  ① 하위 문항 번호 — `subQuestion.ts` 의 판정(1부터 잇따르는 번호 2개 이상)
 *  ② 괄호원문자 `⑴`~`⒇` — 수식에 쓰이지 않는 전용 글자라 하나만 있어도 믿는다
 *  ③ 시험지 머리말 — 연도·학기·고사 이름이 함께 있을 때만
 *
 * ①②는 **머리에서 시작하면 통째로 무시한다**(상자 자기 번호다).
 */
function findBoxStop(
  text: string,
  contentStart: number,
  contentEnd: number,
  subQuestions: readonly number[],
): number {
  const content = text.slice(contentStart, contentEnd);
  const head = contentStart + (CONTENT_HEAD_RE.exec(content)?.[0].length ?? 0);

  const numbering: number[] = [];
  for (const at of subQuestions)
    if (at >= contentStart && at < contentEnd) numbering.push(at);
  PAREN_DIGIT_RE.lastIndex = 0;
  for (const m of content.matchAll(PAREN_DIGIT_RE))
    numbering.push(contentStart + m.index);
  numbering.sort((a, b) => a - b);

  const cuts: number[] = [];
  /*
   * 머리에서 시작하는 번호 매김은 이 상자의 항목 번호다 — 하나도 끊지 않는다.
   *
   * 🔴 다만 머리의 번호가 **가리키기만** 할 때는 면제하면 안 된다(적대적 리뷰 ① §3).
   *    `<조건>∘⑴의 풀이 과정에 …` 은 조건이 하위 문항 ⑴ 을 **참조**하는 것이지
   *    상자 자기 항목 번호가 아니다. 그런데 면제가 켜지면 뒤에 오는 **진짜 ⑴⑵ 발문**
   *    까지 통째로 삼킨다(실측 2fd487f4 · 0cedea03).
   *
   *    가르는 신호: 항목 번호는 뒤에 **띄어쓰기나 내용**이 오고(`⑴ 다항식 A는 …`,
   *    실측 2aa85246), 참조는 조사가 **바로 붙는다**(`⑴의`, `⑵에서`).
   *    「전부 아니면 전무」를 쓰면 손상된 쪽에 유리하게 기운다.
   */
  const headIsReference =
    numbering.length > 0 &&
    numbering[0]! <= head &&
    REFERENCE_PARTICLE_RE.test(
      text.slice(numbering[0]! + 1, numbering[0]! + 3),
    );
  if (numbering.length > 0 && (numbering[0]! > head || headIsReference))
    cuts.push(
      headIsReference ? (numbering[1] ?? numbering[0]!) : numbering[0]!,
    );

  const header = EXAM_HEADER_RE.exec(content);
  if (header) cuts.push(contentStart + header.index);

  return cuts.length > 0 ? Math.min(...cuts) : -1;
}

/** 가장 많은 항목을 내는 계열을 고른다. 동수면 위 우선순위. */
function findItemRun(probe: string): ItemHit[] {
  let best: ItemHit[] = [];
  for (const family of FAMILIES) {
    const hits = findFamilyItems(probe, family);
    if (hits.length >= 2 && hits.length > best.length) best = hits;
  }
  const bullets = findBulletItems(probe);
  if (bullets.length > best.length) best = bullets;
  return best;
}

/* ────────────────────────────────────────────────────────────────────────
 * 3. 수식 가리개 — 인덱스를 보존하는 마스크
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * `$…$` 내부를 **같은 길이의** NUL 로 덮는다. 길이가 같으므로 probe 의 인덱스를
 * 원문에 그대로 쓸 수 있다 — 자리표시자 치환(길이가 변한다)을 쓰지 않는 이유다.
 */
const MATH_SPAN_RE = /\$\$[\s\S]*?\$\$|\$[^$\n]*\$/g;

const PUNCTUATION_ONLY_MATH = /^[\s.,;:]+$/;
/**
 * `$ㄱ.$` · `$ㄱ.~$` — OCR 이 **항목 마커 자체**를 수식으로 감싼 흔적.
 * 자모 하나에 마침표뿐인 수식은 실제 수식일 수 없으므로 드러내도 안전하다.
 */
const JAMO_MARKER_MATH = /^\s*[ㄱ-ㅎ]\s*[.)]\s*[~\s]*$/;

function maskMathInPlace(text: string): string {
  return text.replace(MATH_SPAN_RE, (span) => {
    const inner = span.replace(/^\$\$?/, "").replace(/\$\$?$/, "");
    // 구두점만 든 수식(`$.$`, `$,$`)은 가리지 않는다 — OCR 이 항목 마침표를
    // 통째로 수식으로 감싼 흔적이라, 가리면 `ㄱ $.$ …ㄴ $.$ …` 이 한 덩어리로 남는다(실측).
    // 달러 기호만 공백으로 바꾸므로 **길이는 그대로**이고, 바뀌는 것은 탐지용 사본뿐이다.
    if (
      inner.length > 0 &&
      (PUNCTUATION_ONLY_MATH.test(inner) || JAMO_MARKER_MATH.test(inner))
    ) {
      // 내용을 **여는 `$` 자리로 당겨** 놓는다. 그래야 항목 경계가 `$` 앞에서 잘려
      // `$` 짝이 맞은 채로 남는다 (뒤에서 자르면 `ㄱ.$ $y=1$` 처럼 짝이 깨진다).
      const marker = inner.trim();
      return marker + " ".repeat(span.length - marker.length);
    }
    return "\u0000".repeat(span.length);
  });
}

/* ────────────────────────────────────────────────────────────────────────
 * 4. 상자 찾기
 * ──────────────────────────────────────────────────────────────────────── */

interface MarkerHit {
  index: number;
  length: number;
  label: BoxLabel;
  /** 뒤에 조사가 오지 않는 마커 — 발문 참조가 아니라 상자 머리(또는 뒤로 밀린 라벨). */
  standalone: boolean;
}

function findMarkers(text: string): MarkerHit[] {
  const hits: MarkerHit[] = [];
  for (const match of text.matchAll(CANONICAL_MARKER_RE)) {
    const index = match.index;
    const after = text.slice(index + match[0].length);
    hits.push({
      index,
      length: match[0].length,
      label: match[1] as BoxLabel,
      standalone: !PARTICLE_AFTER_MARKER.test(after),
    });
  }
  return hits;
}

/** 내용이 그림 자리표시자·불릿뿐이면 상자가 아니다. */
function hasMeaningfulContent(content: string): boolean {
  const stripped = content
    .replace(FIGURE_PLACEHOLDER_RE, "")
    .replace(new RegExp(`[${BULLET_CHARS.join("")}\\s\u0000]`, "g"), "");
  return stripped.length >= 4;
}

/**
 * 상자 뒤에 붙어 온 **발문 꼬리**의 시작 위치. 없으면 -1.
 *
 * 실측 38건 — `(나) … 이다.이 때 $p_1+p_2$ 의 값은?` 처럼 조건 상자 끝에 발문이 붙는다.
 * 신호는 **물음표로 끝난다** 하나만 쓴다. 조건 항목이 물음표로 끝나는 일은 없고,
 * `~시오`·`~하여라` 까지 신호로 넣으면 「풀이 과정을 서술하시오」 같은 **진짜 조건**을
 * 상자 밖으로 밀어낸다.
 */
/**
 * 발문 뒤에 붙는 **꼬리말** — 물음표 다음에 오는 단서·배점.
 * `…의 값은? (단, $a>0$이다.)` · `…의 값은? [ $4$ 점]` · `…길이는? $($ 단, … $)$`
 *
 * 이걸 안 걷어내면 `endsWithQuestion` 이 거짓이 되어 **발문을 상자가 삼킨 채로 남는다**
 * — 전수 감사에서 물음표를 품은 상자 52개가 전부 이 모양이었다(2026-08-18).
 */
/**
 * ⚠️ 꼬리말을 «`단,` 부터 끝까지 지운다»로 짜면 안 된다. 실제로 그렇게 했다가
 * 멀쩡한 상자 19개를 잃었다 — `…고른 것은? (단, $a$는 $0$이 아닌 수) ㄱ. …ㄴ. …`
 * 처럼 단서가 **발문과 항목 사이**에 오는 문항이 흔해서, 탐욕적으로 지우면
 * **항목까지 통째로** 사라지고 「발문만 남았으니 상자가 아니다」가 된다(3648061c).
 * 그래서 지우지 않고, 물음표 **뒤에 남은 것이 꼬리말뿐인지**를 본다.
 */
/**
 * 꼬리말 뒤에 **항목이 더 있는가**.
 *
 * ⚠️ 가나다 항목은 반드시 **줄머리**로 묶는다. `[가-차]\s*[.)]` 로 느슨하게 쓰면
 * 꼬리말 자신의 `…정수이다.` 가 「다.」 항목으로 읽혀 꼬리말이 영영 안 잘린다
 * (이 파일 머리주석 안전원칙 3 과 같은 함정 — 실제로 한 번 밟았다).
 * 자모 `ㄱ.`·괄호원문자·상자 마커는 평문에 안 나오므로 자리를 묻지 않는다.
 */
const ITEM_AHEAD_RE =
  /[ㄱ-ㅎ]\s*[.)]|[⑴-⒇]|[㉠-㉩㈎-㈓]|(?:^|\n)\s*[가-차]\s*[.)]|<(?:보기|조건|상자)>/;
const NOTE_OPENERS = /^[[(（$\\]/;
const NOTE_BODY = /단\s*[,，\s]|\d\s*\$?\s*점/;
/** 실측 꼬리말 최장 110자(014df295). 넉넉히 잡되 문단 하나를 넘지 않게 묶는다. */
const NOTE_MAX = 160;

/** 물음표 뒤에 남은 토막이 «단서·배점» 꼬리말뿐인가. */
function isQuestionNote(tail: string): boolean {
  const body = tail.trim();
  if (body.length === 0) return true;
  if (body.length > NOTE_MAX) return false;
  /*
   * ⚠️ 「빈 줄이 있으면 문단이 더 있는 것이다」는 여기서 **쓸 수 없다.**
   * 이 말뭉치는 PDF 텍스트 레이어 추출본이라 수식마다 `\n\n` 이 들어가 빈 줄이
   * 사방에 있다. 그 가드를 걸었더니 `…값은?` ⏎⏎ `(단, …)` 형태의 꼬리말을
   * 전부 놓쳐 발문을 삼킨 상자 10개가 그대로 남았다(2006a011 등).
   * 경계는 빈 줄이 아니라 **항목이 이어지는가**로 가른다.
   */
  if (ITEM_AHEAD_RE.test(tail)) return false;
  return NOTE_OPENERS.test(body) && NOTE_BODY.test(body);
}

/**
 * 발문은 물음표로 끝난다. 보기·조건 항목은 끝나지 않는다 — 실측 38건 전부 그랬다.
 * 단서·배점 꼬리말(`(단, …)` · `[ $4$ 점]`)은 물음표 **뒤**에 오므로 함께 본다 —
 * 이걸 안 보면 발문을 삼킨 상자 52개가 그대로 남는다(2026-08-18 전수 감사).
 */
function endsWithQuestion(text: string): boolean {
  const trimmed = text.trimEnd();
  if (/[?？]\s*$/.test(trimmed)) return true;
  const last = Math.max(trimmed.lastIndexOf("?"), trimmed.lastIndexOf("？"));
  if (last < 0) return false;
  return isQuestionNote(trimmed.slice(last + 1));
}

function findQuestionTail(
  content: string,
  probe: string,
  minCut: number,
): number {
  if (!endsWithQuestion(content)) return -1;

  /*
   * 경계는 두 종류다.
   *  A. 문장 종결(`…다.`) — 이 말뭉치에서 가장 믿을 만한 신호.
   *  B. 줄바꿈 — 종결 어미 없이 수식으로 끝나는 조건(`(다) ∫…=9` 다음 줄에 발문)에만 쓴다.
   * B 를 먼저 쓰면 안 된다. PDF 텍스트 레이어 추출본은 수식마다 `\n\n` 을 넣어서
   * 줄바꿈이 사방에 있고, 그중 마지막을 집으면 발문이 「의 값은?」처럼 토막 난다(실측).
   * 또 경계는 **마지막 항목이 시작한 뒤**여야 한다 — 앞이면 멀쩡한 항목을 상자 밖으로 밀어낸다.
   */
  /*
   * 경계 뒤에는 **물음표가 있어야** 한다. 없으면 그 경계는 발문의 시작이 아니라
   * 발문 **뒤**다 — 자르면 발문이 상자에 남고 단서만 밖으로 나간다.
   * 단서가 제 줄에 오는 문항(`…최솟값은?` ⏎ `(단, $p,~q$는 상수이다.)`, 8c0f354d)에서
   * 마지막 줄바꿈을 집어 상자를 통째로 잃었다. 실측으로 드러난 조건이다.
   */
  const hasQuestionAfter = (at: number) => /[?？]/.test(content.slice(at));

  let sentenceCut = -1;
  for (const match of probe.matchAll(/다\s*\./g)) {
    const at = match.index + match[0].length;
    if (
      at > minCut &&
      content.slice(at).trim().length >= 4 &&
      hasQuestionAfter(at)
    )
      sentenceCut = at;
  }
  if (sentenceCut >= 0) return sentenceCut;

  let lineCut = -1;
  for (const match of probe.matchAll(/\n/g)) {
    const at = match.index + 1;
    if (
      at > minCut &&
      content.slice(at).trim().length >= 8 &&
      hasQuestionAfter(at)
    )
      lineCut = at;
  }
  return lineCut;
}

interface FoundBox {
  start: number;
  end: number;
  segment: BoxSegment;
}

/** 한 구역을 본 결과. 상자를 못 찾아도 **다음 구역으로 넘어갈 자리**를 돌려준다. */
interface ScanResult {
  box: FoundBox | null;
  next: number;
}

/**
 * `from` 이후에서 상자를 하나 찾는다.
 *
 * 구역 잡기:
 *  - `from` 자리가 홀로 선 마커면 그 마커가 **헤더**이고, 구역은 다음 홀로 선 마커까지.
 *  - 아니면 구역은 다음 홀로 선 마커 **앞까지** (발문 + 항목이 이 구간에 있다).
 */
function findBoxFrom(
  text: string,
  probe: string,
  markers: MarkerHit[],
  from: number,
  subQuestions: readonly number[],
): ScanResult {
  const ahead = markers.filter((m) => m.index >= from);
  if (ahead.length === 0) return { box: null, next: text.length };

  const standaloneAhead = ahead.filter((m) => m.standalone);
  let header: MarkerHit | null = null;
  let regionEnd = text.length;

  if (standaloneAhead.length > 0) {
    const first = standaloneAhead[0]!;
    if (text.slice(from, first.index).trim() === "") {
      header = first;
      regionEnd = standaloneAhead[1]?.index ?? text.length;
    } else {
      regionEnd = first.index;
    }
  }

  const contentStart = header ? header.index + header.length : from;
  if (contentStart >= regionEnd && !header)
    return { box: null, next: regionEnd };

  let contentEnd = regionEnd;
  /**
   * 뒤로 밀린 라벨(실측 93건) — 구역 끝에 붙은 마커가 **자기 뒤에 아무 내용도 없을 때만**
   * 이 상자의 라벨이다. 이 단서를 빼면 다음 상자의 헤더를 앞 구역이 삼킨다
   * (`… <조건>(가) …(나) …` 에서 발문만 상자가 되는 오작동이 실제로 났다).
   */
  const atEnd = standaloneAhead.find((m) => m.index === regionEnd);
  const afterAtEnd = atEnd
    ? text.slice(
        atEnd.index + atEnd.length,
        standaloneAhead.find((m) => m.index > atEnd.index)?.index ??
          text.length,
      )
    : "";
  const trailing =
    atEnd && !hasMeaningfulContent(afterAtEnd) ? atEnd : undefined;
  let boxEnd = trailing ? trailing.index + trailing.length : regionEnd;

  // 서술형 라벨에서 끊는다 (수식에 갇히지 않으므로 probe 에서 본다).
  const essayAt = probe.slice(contentStart, contentEnd).search(ESSAY_LABEL_RE);
  if (essayAt > 0) {
    contentEnd = contentStart + essayAt;
    boxEnd = contentEnd;
  }
  // 하위 문항·시험지 머리말에서 끊는다 — 원문에서 본다(마커가 수식 안에 있다).
  const stopAt = findBoxStop(text, contentStart, contentEnd, subQuestions);
  if (stopAt > contentStart) {
    contentEnd = stopAt;
    boxEnd = contentEnd;
  }

  const content = text.slice(contentStart, contentEnd);
  const contentProbe = probe.slice(contentStart, contentEnd);
  const run = findItemRun(contentProbe);

  const label = header?.label ?? trailing?.label ?? nearestLabel(markers, from);

  /**
   * 헤더 없이 항목만으로 상자를 세울 때는 그 항목이 **첫 마커보다 뒤**에 있어야 한다.
   * 발문이 `(가)와 (나)에 알맞은 말은? <상자> …` 처럼 항목 글자를 먼저 쓰는 문항이
   * 실제로 있어서, 이 단서가 없으면 **발문이 통째로 상자가 된다**(실측 6건에서 났다).
   * 라벨이 뒤로 밀린 경우(trailing)는 항목이 마커보다 앞서는 것이 정상이라 예외다.
   */
  const runAllowed =
    run.length >= 2 &&
    (header !== null ||
      trailing !== undefined ||
      contentStart + run[0]!.start > markers[0]!.index);

  if (runAllowed) {
    const tail = findQuestionTail(
      content,
      contentProbe,
      run[run.length - 1]!.start,
    );
    const limit = tail >= 0 ? tail : content.length;
    if (tail >= 0) boxEnd = contentStart + tail;

    // 상자는 물음표로 끝나지 않는다 — 끝난다면 발문을 삼킨 것이고, 꼬리를 못 잘랐다는 뜻이다.
    if (endsWithQuestion(content.slice(0, limit)))
      return { box: null, next: regionEnd };

    const items: string[] = [];
    for (let i = 0; i < run.length; i += 1) {
      const itemEnd = i + 1 < run.length ? run[i + 1]!.start : limit;
      const body = content.slice(run[i]!.start, itemEnd).trim();
      if (body.length > 0) items.push(body);
    }
    if (items.length >= 2) {
      const lead = content.slice(0, run[0]!.start).trim();
      // 헤더가 없으면 첫 항목 앞은 발문이다 — 상자 밖에 남긴다.
      const boxStart = header ? header.index : contentStart + run[0]!.start;
      return {
        box: {
          start: boxStart,
          end: boxEnd,
          segment: { kind: "box", label, lead: header ? lead : "", items },
        },
        next: boxEnd,
      };
    }
  }

  /**
   * 항목을 못 나눴다 — **헤더로 시작하는 구역일 때만** 통짜 한 항목으로 상자를 그린다.
   * 뒤로 밀린 라벨(trailing)은 여기서 쓰지 않는다. 항목 흔적이 없는데 라벨만 뒤에
   * 붙어 있으면 그 앞은 상자가 아니라 **발문**이다(`옳은 것은? <보기> [그림]`).
   */
  if (!header) return { box: null, next: regionEnd };
  const tail = findQuestionTail(content, contentProbe, 0);
  const body = (tail >= 0 ? content.slice(0, tail) : content).trim();
  if (tail >= 0) boxEnd = contentStart + tail;
  if (!hasMeaningfulContent(body)) return { box: null, next: regionEnd };
  // 물음표로 끝나면 상자 내용이 아니라 발문이다 (`<보기> 삼각비의 값을 …나열하면?`).
  if (endsWithQuestion(body)) return { box: null, next: regionEnd };

  return {
    box: {
      start: header ? header.index : contentStart,
      end: boxEnd,
      segment: { kind: "box", label, lead: "", items: [body] },
    },
    next: boxEnd,
  };
}

function nearestLabel(markers: MarkerHit[], position: number): BoxLabel {
  let label: BoxLabel = markers[0]?.label ?? "보기";
  for (const marker of markers) {
    if (marker.index <= position) label = marker.label;
  }
  return label;
}

/* ────────────────────────────────────────────────────────────────────────
 * 4-B. 마커 없는 «다음 조건» 상자 (2026-08-18)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 발문이 「뒤에 조건이 온다」고 말하는 문구. **이것이 유일한 근거다.**
 *
 * 마커(`<조건>`)가 아예 없는 문항이라 항목만 보고 상자를 세울 수는 없다 —
 * 그러면 아무 불릿 나열이나 상자가 된다. 발문이 스스로 조건을 예고할 때만 연다.
 * 전수 실측: 이 문구가 있는 문항 1,936건(4.11%), 그중 이미 상자인 513건을 빼고
 * **마커 없이 불릿만 있는 것 61건**.
 */
const BARE_CONDITION_TRIGGER =
  /(?:다음|아래)\s*(?:의\s*)?(?:세\s*|네\s*|두\s*)?조건|조건을\s*(?:모두\s*)?만족|(?:다음|아래)을?\s*(?:모두\s*)?만족/g;

/**
 * 그 자리가 **수식과 수식 사이**인가. 양쪽이 `$` 면 항목 기호가 아니라 연산자다.
 *
 * ⚠️ 수식을 가리는 것만으로는 부족하다. OCR 이 합성함수를 `$(f$ ∘ $g)(3)$` 처럼
 * **수식 밖으로** 쪼개 놓기 때문에 `∘` 가 평문 자리에 남는다(실측 1ed8fb78).
 * 그대로 두면 발문이 통째로 조건 상자가 된다.
 */
function isBetweenMathSpans(text: string, at: number): boolean {
  let left = at - 1;
  while (left >= 0 && /\s/.test(text[left]!)) left -= 1;
  let right = at + 1;
  while (right < text.length && /\s/.test(text[right]!)) right += 1;
  return text[left] === "$" && text[right] === "$";
}

/**
 * 마커 없이 불릿로만 나열된 조건을 상자로 만든다. 없으면 null.
 *
 * 항목 찾기는 반드시 **probe(수식 가림)** 에서 한다. 안 가리면 합성함수
 * `$(f$ ∘ $g)(3)$` 의 `∘` 셋이 불릿으로 보여 발문이 통째로 상자가 된다
 * (실측 1ed8fb78). `□` 를 불릿 목록에 넣지 않는 이유도 같다 — `□ABCD` 는
 * 도형 표기이지 항목이 아니다(실측 11830247).
 */
function findBareConditionBox(
  text: string,
  probe: string,
  subQuestions: readonly number[] = [],
): FoundBox | null {
  BARE_CONDITION_TRIGGER.lastIndex = 0;
  const trigger = BARE_CONDITION_TRIGGER.exec(probe);
  if (!trigger) return null;
  const after = trigger.index + trigger[0].length;

  const region = probe.slice(after);
  const hits = findBulletItems(region);
  if (hits.length < 2) return null;
  /*
   * **첫 항목만** 자리를 따진다. 목록의 첫 기호가 수식과 수식 사이에 끼어 있으면
   * 그건 항목 기호가 아니라 연산자다(합성함수 `$(f$ ∘ $g)$`, 실측 1ed8fb78).
   * 뒤 항목까지 같은 잣대를 대면 안 된다 — `∘ $A=…$ ∘ $B=…$` 처럼 **항목이 통째로
   * 수식인** 조건 목록이 실제로 있고(004e03ea), 그건 둘째 기호부터 양옆이 수식이다.
   */
  if (isBetweenMathSpans(text, after + hits[0]!.start)) return null;

  const start = after + hits[0]!.start;
  const content = text.slice(start);
  const contentProbe = probe.slice(start);

  // 조건 뒤에 발문이 붙어 오면 되돌린다 (`<조건> … 의 값은?`).
  const tail = findQuestionTail(
    content,
    contentProbe,
    hits[hits.length - 1]!.start - hits[0]!.start,
  );
  let limit = tail >= 0 ? tail : content.length;
  if (endsWithQuestion(content.slice(0, limit))) return null;

  /*
   * 🔴 회귀 ① 의 수리(`findBoxStop`)가 **이 경로에는 안 걸려 있었다.**
   *    마커 있는 상자만 하위 문항·시험지 머리말에서 끊고, 마커 없는 조건 상자는
   *    문단 끝까지 먹었다 — 고쳤다던 결함이 옆문으로 돌아왔다(적대적 리뷰 ① §3).
   *    실측 e7ae0c15 · 42736426.
   */
  const stopAt = findBoxStop(text, start, start + limit, subQuestions);
  if (stopAt > start) limit = Math.min(limit, stopAt - start);

  const items: string[] = [];
  for (let i = 0; i < hits.length; i += 1) {
    const from0 = hits[i]!.start - hits[0]!.start;
    if (from0 >= limit) break; // 끊긴 자리 뒤의 항목은 상자 것이 아니다
    const to = Math.min(
      i + 1 < hits.length ? hits[i + 1]!.start - hits[0]!.start : limit,
      limit,
    );
    const body = content.slice(from0, to).trim();
    if (body.length > 0) items.push(body);
  }
  if (items.length < 2) return null;

  return {
    start,
    end: start + limit,
    segment: { kind: "box", label: "조건", lead: "", items },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * 4-C. 나열 대상 상자 (2026-08-18)
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 발문이 「나열」을 말하는가. 이것이 유일한 근거다.
 *
 * 정본 `F:\시험지변환기` 를 봤지만 **거기에도 이 규칙은 없다** —
 * `core/content_parser.py` 의 박스 판정도 우리와 같은 **마커 기반**이라
 * 베낄 규칙이 없었다. 대신 그 저장소의 박스 **모양**(5×5 병합표, 내용 셀 양옆에
 * 스페이서 셀, `vertAlign="CENTER"`)을 참고했다 — 가운데 정렬 시안의 근거다.
 */
const ENUMERATION_TRIGGER =
  /나열한\s*것은|나열했을\s*때|나열하시오|나열하면|나열할\s*때|차례대로|순서대로|작은\s*(?:수|것)부터|큰\s*(?:수|것)부터|크기순/;

/** 쉼표로 늘어선 수식 나열. 항목이 **넷 이상**이라야 «나열»이다. */
const ENUMERATION_LIST =
  /^\s*(?:\$[^$\n]+\$\s*[,，]\s*){3,}\$[^$\n]+\$\s*$|^\s*\$[^$\n]*?(?:[,，][^$\n,，]+){3,}[^$\n]*\$\s*$/;

/**
 * 발문 **뒤**에 마커 없이 늘어선 나열 대상을 상자로 만든다. 없으면 null.
 *
 * ⚠️ **발문 물음표 뒤**여야 한다. 실측 478건 중 나열이 발문 **안**에 박힌 것이
 * 122건인데(`세 수 $a=…$, $b=…$, $c=…$ 의 대소관계는?`), 그건 상자로 빼면
 * **문장이 끊긴다.** 뒤에 오는 33건만 대상이다.
 */
function findEnumerationBox(text: string, probe: string): FoundBox | null {
  if (!ENUMERATION_TRIGGER.test(probe)) return null;
  const mark = probe.search(/[?？]/);
  if (mark < 0) return null;
  const start = mark + 1;
  const tail = text.slice(start);
  if (!ENUMERATION_LIST.test(tail)) return null;
  const body = tail.trim();
  if (!hasMeaningfulContent(body)) return null;

  return {
    start: start + (tail.length - tail.trimStart().length),
    end: text.length,
    segment: {
      kind: "box",
      label: "상자",
      headerless: true,
      lead: "",
      items: [body],
    },
  };
}

/* ────────────────────────────────────────────────────────────────────────
 * 5. 공개 API
 * ──────────────────────────────────────────────────────────────────────── */

/**
 * 지문을 «평문 · 상자» 조각으로 나눈다.
 *
 * 상자를 하나도 못 찾으면 **입력을 그대로** 한 조각으로 돌려준다 —
 * 마커가 없는 44,165건의 렌더가 한 글자도 달라지지 않는 근거가 이 반환이다.
 */
export function splitBoxSegments(raw: string): ContentSegment[] {
  if (!raw) return [{ kind: "text", text: raw }];
  // 「다음을 모두 만족」처럼 낱말 «조건»이 없는 발문도 있으므로 여기서 같이 본다.
  if (
    !/보\s*기|조\s*건|상\s*자|만\s*족|나\s*열|차례|순서|크기순|부터/.test(raw)
  )
    return [{ kind: "text", text: raw }];

  const text = normalizeBoxMarkers(raw);
  const markers = findMarkers(text);
  if (markers.length === 0) {
    // 마커가 없어도 발문이 조건·나열을 예고하고 항목이 있으면 상자로 그린다.
    const blank = maskMathInPlace(text);
    const bareSubQuestions = findSubQuestionMarkers(text).map((m) => m.index);
    const bare =
      findBareConditionBox(text, blank, bareSubQuestions) ??
      findEnumerationBox(text, blank);
    return bare ? assemble(text, [bare]) : [{ kind: "text", text: raw }];
  }

  const probe = maskMathInPlace(text);
  // 하위 문항 판정은 **문항 전체**를 봐야 한다(오름차순 근거가 상자 밖에도 있다).
  // 한 번만 계산해 구역마다 물려준다.
  const subQuestions = findSubQuestionMarkers(text).map((m) => m.index);
  const found: FoundBox[] = [];
  let cursor = 0;
  // 마커 수만큼만 돈다 — 진행이 없으면 즉시 멈춘다(무한 루프 방지).
  for (
    let guard = 0;
    guard <= markers.length + 1 && cursor < text.length;
    guard += 1
  ) {
    const { box, next } = findBoxFrom(
      text,
      probe,
      markers,
      cursor,
      subQuestions,
    );
    if (box) found.push(box);
    if (next <= cursor) break;
    cursor = next;
  }

  if (found.length === 0) {
    // 마커는 있는데 상자를 못 세웠다 — 마커 없는 두 경로를 한 번 더 본다.
    const bare =
      findBareConditionBox(text, probe, subQuestions) ??
      findEnumerationBox(text, probe);
    return bare ? assemble(text, [bare]) : [{ kind: "text", text }];
  }

  return assemble(text, found);
}

/** 찾은 상자들을 «평문 · 상자» 조각으로 엮는다. */
function assemble(text: string, found: readonly FoundBox[]): ContentSegment[] {
  const segments: ContentSegment[] = [];
  let position = 0;
  for (const box of found) {
    const before = text.slice(position, box.start).trim();
    if (before.length > 0) segments.push({ kind: "text", text: before });
    segments.push(box.segment);
    position = box.end;
  }
  const rest = text.slice(position).trim();
  if (rest.length > 0) segments.push({ kind: "text", text: rest });
  return segments;
}
