/**
 * «둘러싼 숫자»(①②③…) — **목록을 손으로 쓰지 않는 한 곳.**
 *
 * ## 왜 이 파일이 있나
 *
 * 2026-08-19 에 전수로 세어 보니 원문자 목록이 코드에 **손으로 열두 벌 남짓** 적혀
 * 있었다(`scripts/qa/` · `src/lib/` · `src/components/`). 전부 `①..⑩` 나 `①..⑮` 다.
 * 그래서 `➀`(U+2780) 계열이 든 행은 **정답 대조에서 「원문자가 없다」로 읽혔다** —
 * 0 이 나오는데 0 인 줄도 몰랐다(CLAUDE.md 2026-08-18: 목록을 손으로 쓰면 세는 쪽과
 * 고치는 쪽이 같이 눈이 먼다).
 *
 * ## 🔴 그런데 **다 넓히면 안 된다** — 자리마다 하는 일이 다르다
 *
 * 실측(분모 47,152건, `scripts/qa/census-circled-glyphs.ts`)으로 갈렸다:
 *
 * | 자리 | 무엇을 판정하나 | 넓히나 | 근거 |
 * | --- | --- | :-: | --- |
 * | **정답 판독** | `answer` 가 «번호»인가 | **✅ 넓힌다** | 비표준 계열 44행 중 **43행이 진짜 정답 번호**(전부 `➀`~`➄`) |
 * | **본문 보기 마커** | `content` 줄머리가 «보기 시작»인가 | **❌ 좁게 둔다** | 아래 |
 * | **지면 렌더** | 지면에 «무슨 글자를 찍나» | ❌ 해당 없음 | 출력 글자다. 늘 `①②③④⑤` 로 찍는다 |
 *
 * ### 본문 마커를 넓히면 **성한 문항이 깨진다**
 *
 * `content` 에 비표준 계열이 든 11행을 **전량 눈으로** 봤다. 줄머리에 온 6행이
 * 전부 **보기가 아니었다**:
 *
 * - `352f8aac`·`65fa779b` — `<규칙>` 아래 `➊ 두 눈의 수의 …` (**규칙 항목**)
 * - `ad7dca98`·`e303ddb0` — `❶로 AB 의 길이를 잰다` (**작도 순서**)
 * - `d40ade78` — `직선 ➀은 떡볶이를 …` (**그래프 라벨**)
 * - `4db67fe7` — `<조건>` 안 항목
 *
 * 넓히면 이것들이 **보기로 잘려 나간다.** 지금은 발문에 그대로 남아 옳게 나온다.
 * 「손상을 정상으로 읽는 가드」의 거울상이다 — 여기서는 **넓히는 것이 결함**이다.
 * 그래서 본문 쪽은 목록을 **한 곳에 두되 범위는 그대로** 둔다. 어느 자리가 어느
 * 목록을 쓰는지는 **이름으로** 드러난다.
 */

/* ────────────────────────────────────────────────────────────────────────────
 * 1. 계열 — 시작 코드포인트만 적고 번호는 **계산**한다.
 *    유니코드의 «둘러싼 숫자»는 블록마다 «1 의 자리»가 있고 그 뒤로 1씩 는다.
 * ──────────────────────────────────────────────────────────────────────────── */
export const CIRCLED_FAMILIES = [
  { base: 0x2460, size: 20, name: "circled" }, // ①..⑳
  { base: 0x2776, size: 10, name: "negative-circled" }, // ❶..❿
  { base: 0x2780, size: 10, name: "sans-circled" }, // ➀..➉
  { base: 0x278a, size: 10, name: "negative-sans-circled" }, // ➊..➓
  { base: 0x24f5, size: 10, name: "double-circled" }, // ⓵..⓾
  { base: 0x3251, size: 15, name: "circled-21-35" }, // ㉑..㉟
  { base: 0x32b1, size: 15, name: "circled-36-50" }, // ㊱..㊿
] as const;

/** 이 글자가 «둘러싼 숫자»면 그 번호, 아니면 0. **PUA 는 부르는 쪽이 먼저 편다.** */
export function circledValueRaw(ch: string): number {
  const cp = ch.codePointAt(0);
  if (cp === undefined) return 0;
  for (const f of CIRCLED_FAMILIES) {
    if (cp >= f.base && cp < f.base + f.size) return cp - f.base + 1;
  }
  return 0;
}

/** 계열이 달라도 같은 번호면 **같은 글자**로 모은다(1..20 밖은 null). */
export function canonicalCircled(n: number): string | null {
  return n >= 1 && n <= 20 ? String.fromCodePoint(0x2460 + n - 1) : null;
}

/** 규칙이 아는 원문자 전체 — 테스트·census 가 사정권을 확인하는 데 쓴다. */
export function knownCircledGlyphs(): string[] {
  return CIRCLED_FAMILIES.flatMap((f) =>
    Array.from({ length: f.size }, (_, i) => String.fromCodePoint(f.base + i)),
  );
}

/** 정답 판독용 문자 클래스 본문 — **전 계열**. `new RegExp(\`[${…}]\`)` 로 쓴다. */
export const ANSWER_CIRCLED_CLASS = CIRCLED_FAMILIES.map(
  (f) =>
    `${String.fromCodePoint(f.base)}-${String.fromCodePoint(f.base + f.size - 1)}`,
).join("");

/* ────────────────────────────────────────────────────────────────────────────
 * 2. 본문 보기 마커 — **좁게 둔다.** 왜 좁은지는 파일 머리 주석에 실측과 함께 있다.
 * ──────────────────────────────────────────────────────────────────────────── */

/**
 * 본문 줄머리에서 «보기 시작»으로 보는 글자.
 *
 * ⚠️ **`①..⑮` 뿐이다.** 넓히지 마라 — `❶`·`➊` 은 이 데이터에서 규칙 항목·작도
 * 순서·그래프 라벨로 쓰인다(파일 머리 표). 넓히면 성한 문항의 발문이 보기로 잘린다.
 */
export const BODY_CHOICE_MARKS = Array.from({ length: 15 }, (_, i) =>
  String.fromCodePoint(0x2460 + i),
).join("");

/** 위 목록의 문자 클래스 본문 — `[…]` 안에 그대로 넣는다. */
export const BODY_CHOICE_CLASS = `${BODY_CHOICE_MARKS[0]}-${BODY_CHOICE_MARKS[BODY_CHOICE_MARKS.length - 1]}`;

/* ────────────────────────────────────────────────────────────────────────────
 * 3. 지면에 **찍는** 글자 — 출력이라 계열 문제가 없다.
 * ──────────────────────────────────────────────────────────────────────────── */

/** 지면 보기 번호. 파서가 본 순서대로 다시 매겨 찍는다(`ProblemContent.tsx`). */
export const CHOICE_MARKS = Array.from({ length: 10 }, (_, i) =>
  String.fromCodePoint(0x2460 + i),
);
