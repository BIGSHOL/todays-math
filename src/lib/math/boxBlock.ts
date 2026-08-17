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

/** 상자 라벨 — 정본 `blocksToMarkdown.ts` 32행 BOX_MARKERS 와 같은 셋. */
export type BoxLabel = "보기" | "조건" | "상자";

export interface BoxSegment {
  kind: "box";
  label: BoxLabel;
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
const BULLET_CHARS = [..."∘•◦○⦁∙⚪⚬◯⸰◎✽Ÿ॰"];

/** 상자를 끊는 신호 — 소문항 번호와 서술형 라벨은 상자 밖이다. */
const BOX_STOP_RE = /[⑴⑵⑶⑷⑸⑹]|\[\s*서[술답]형/;

/** 발문 안 참조(`<보기>에서`, `<조건>을`)를 상자 머리와 가른다. */
const PARTICLE_AFTER_MARKER =
  /^\s*(?:에서|에게|에|의|을|를|이며|이고|이다|이|가|은|는|와|과|만|중|처럼|대로|같이|로|으로|보다|부터|까지|랑|도)/;

/** 그림 자리표시자 — 상자 내용으로 치지 않는다(그림은 ProblemContent 가 따로 그린다). */
const FIGURE_PLACEHOLDER_RE = /\[\s*그\s*림\s*\d*\s*\]/g;

interface ItemHit {
  start: number;
}

/** 계열 원소를 **순서대로** 앞에서 뒤로 훑는다 → 오름차순이 구조적으로 보장된다. */
function findFamilyItems(probe: string, family: Family): ItemHit[] {
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

function maskMathInPlace(text: string): string {
  return text.replace(MATH_SPAN_RE, (span) => {
    const inner = span.replace(/^\$\$?/, "").replace(/\$\$?$/, "");
    // 구두점만 든 수식(`$.$`, `$,$`)은 가리지 않는다 — OCR 이 항목 마침표를
    // 통째로 수식으로 감싼 흔적이라, 가리면 `ㄱ $.$ …ㄴ $.$ …` 이 한 덩어리로 남는다(실측).
    // 달러 기호만 공백으로 바꾸므로 **길이는 그대로**이고, 바뀌는 것은 탐지용 사본뿐이다.
    if (inner.length > 0 && PUNCTUATION_ONLY_MATH.test(inner))
      return span.replace(/\$/g, " ");
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
/** 발문은 물음표로 끝난다. 보기·조건 항목은 끝나지 않는다 — 실측 38건 전부 그랬다. */
function endsWithQuestion(text: string): boolean {
  return /[?？]\s*$/.test(text);
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
  let sentenceCut = -1;
  for (const match of probe.matchAll(/다\s*\./g)) {
    const at = match.index + match[0].length;
    if (at > minCut && content.slice(at).trim().length >= 4) sentenceCut = at;
  }
  if (sentenceCut >= 0) return sentenceCut;

  let lineCut = -1;
  for (const match of probe.matchAll(/\n/g)) {
    const at = match.index + 1;
    if (at > minCut && content.slice(at).trim().length >= 8) lineCut = at;
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

  // 소문항 번호·서술형 라벨에서 끊는다.
  const stopAt = probe.slice(contentStart, contentEnd).search(BOX_STOP_RE);
  if (stopAt > 0) {
    contentEnd = contentStart + stopAt;
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
  if (!/보\s*기|조\s*건|상\s*자/.test(raw))
    return [{ kind: "text", text: raw }];

  const text = normalizeBoxMarkers(raw);
  const markers = findMarkers(text);
  if (markers.length === 0) return [{ kind: "text", text: raw }];

  const probe = maskMathInPlace(text);
  const found: FoundBox[] = [];
  let cursor = 0;
  // 마커 수만큼만 돈다 — 진행이 없으면 즉시 멈춘다(무한 루프 방지).
  for (
    let guard = 0;
    guard <= markers.length + 1 && cursor < text.length;
    guard += 1
  ) {
    const { box, next } = findBoxFrom(text, probe, markers, cursor);
    if (box) found.push(box);
    if (next <= cursor) break;
    cursor = next;
  }

  if (found.length === 0) return [{ kind: "text", text }];

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
