/**
 * 렌더 결과 동일성 잠금 (성능 수리 B 전용).
 *
 * 이 저장소의 성능 수리는 **"같은 결과를 덜 계산해서 낸다"** 만 허용된다 (D-07).
 * 메모이제이션·알고리즘 교체가 수식 렌더 HTML 을 한 글자라도 바꾸면 실패다.
 *
 * 기대 해시(`src/__tests__/fixtures/renderParity.json`)는 성능 수리 **이전**
 * 커밋(2c3c6d0d)의 코드로 뽑았다. 이 파일이 빨개지면 회귀이지 기대값 갱신
 * 대상이 아니다 — 화면·지면이 실제로 달라졌다는 뜻이다.
 *
 * ── 변경 이력 ─────────────────────────────────────────────────────────────
 * 2026-08-17 렌더 수리 B(`<보기>`·`<조건>` 상자): 케이스 **3개를 추가**했다
 *   (`상자-보기-자모` / `상자-조건-발문꼬리` / `상자-긴보기-1열`).
 *   기존 14개 키의 해시는 **하나도 바뀌지 않았다** — 그것이 "상자 없는 문항의
 *   렌더는 불변"이라는 약속의 증거다. 상자 렌더를 고칠 때 이 셋이 빨개지는 것은
 *   정상이지만, **기존 14개가 같이 빨개지면 회귀다.** 갱신 전에 어느 쪽이
 *   빨개졌는지부터 확인할 것.
 *
 * 2026-08-18 **이 파일 자체가 고장나 있었다.** 케이스 문자열의 역슬래시를 한 번만
 *   써서 TypeScript 가 escape 로 먹었다 — `"$\frac…"` = 폼피드 + `rac`,
 *   `"$0.\overline{3}$"` = `$0.overline{3}$`. 그래서
 *     · `분수-유한소수`·`원문자-보기`·`극한-limits` 는 **붉은 글씨를 잠그고** 있었고
 *     · `순환소수-점표기` 는 순환마디 경로를 **한 번도 지나가지 않았다**.
 *   해시는 내내 초록이었다. 문자열을 바로잡고 해시를 다시 뽑았다 —
 *   **12개가 바뀌고 6개(역슬래시가 없던 것)는 그대로다.** 이 12개는 회귀가 아니라
 *   «드디어 제 입력을 보게 된» 것이다. 새 키 둘(`순환마디-두점`·`호-widehat`)은
 *   전처리가 만드는 `\htmlClass` 경로를 잠근다.
 *   같은 사고를 다시 침묵시키지 않으려고 아래 «붉은 글씨 금지» 검사를 붙였다.
 *
 * 2026-08-19 **R2 (D-58) — 줄 중간 보기 마커를 보기 경계로.** 원장님 확정으로
 *   제품 파서가 「보기 다섯이 한 줄에 붙은」 문항을 다시 가른다. 바뀐 키는
 *   **`corpus:mock-problems` 하나뿐**이고 나머지 19개는 그대로다 — 상자·수식·
 *   순환소수 경로가 안 바뀌었다는 증거다.
 *   mock 30건 중 R2 가 건드리는 것은 **2건**이며, 둘 다 보기가 발문에 통째로
 *   붙어 **0칸**이던 것이 **4칸**이 됐다(`…000002` 정답 ②, `…000025` 정답 ②·④).
 *   즉 지면이 «달라진» 게 아니라 **없던 보기가 생겼다.** 회귀가 아니다.
 *
 * 재생성(표기 자체를 의도적으로 바꾼 경우에만):
 *   PARITY_DUMP=1 npx vitest run src/__tests__/unit/renderParity.test.tsx
 *
 * (그림 `<img>` 속성은 여기서 잠그지 않는다. 지연 로딩 속성은 렌더 결과가 아니라
 *  로딩 정책이라 `problemFigures` 테스트가 따로 검증한다.)
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { MathText } from "@/components/math/MathText";
import { PaperProblemView } from "@/components/print/PaperProblemView";
import { MOCK_PROBLEMS } from "@/mocks/data/problems";

const FIXTURE = path.join(
  process.cwd(),
  "src/__tests__/fixtures/renderParity.json",
);

const DUMP = Boolean(process.env.PARITY_DUMP);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function readExpected(): Record<string, string> {
  try {
    return JSON.parse(readFileSync(FIXTURE, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * 실측 문항에서 뽑은 대표 입력 — 전처리 경로를 골고루 지나가도록 골랐다.
 *
 * ⚠️ **역슬래시를 반드시 두 번 쓴다(`\\frac`).** 2026-08-18 이전 이 배열은
 * 한 번만 써 놓아서 TypeScript 가 escape 로 먹었다 — `"$\frac…"` 은 실제로
 * **폼피드(U+000C) + `rac`** 였고, `"$0.\overline{3}$"` 은 `$0.overline{3}$`
 * 였다. 그 결과:
 *   · `분수-유한소수`·`원문자-보기`·`극한-limits` 는 **줄곧 붉은 글씨를 잠그고**
 *     있었다. 해시는 「달라지지 않았다」고 초록이었다.
 *   · `순환소수-점표기` 는 `\overline` 이 사라져 순환마디 경로를 **한 번도**
 *     지나가지 않았다 — 이 파일이 지키려던 바로 그 경로다.
 * 「지표가 실패를 셀 수 있는 형태인지 먼저 확인하라」(CLAUDE.md 2026-08-16)가
 * 여기서 그대로 재현됐다. 고친 뒤 해시를 다시 뽑았다.
 */
const PAPER_CASES: Array<{ name: string; content: string }> = [
  {
    name: "분수-유한소수",
    content: "$\\frac{7}{25}$를 유한소수로 나타내어라.",
  },
  {
    name: "원문자-보기",
    content:
      "다음 중 유한소수로 나타낼 수 없는 것은?\n① $\\frac{3}{8}$\n② $\\frac{5}{12}$\n③ $\\frac{7}{20}$\n④ $\\frac{9}{50}$",
  },
  {
    name: "숫자-보기",
    content:
      "두 수\n\n$A=2^{3}\\times 3$\n\n의 최소공배수는?\n1. $a$\n2. $b$\n3. $c$\n4. $d$\n5. $e$",
  },
  {
    name: "순환소수-점표기",
    content: "순환소수\n\n$0.\\overline{3}$\n\n을 기약분수로 나타내어라.",
  },
  {
    name: "도형-기호",
    content:
      "$\\triangle ABC$ 에서 $\\angle C = 90^{\\circ}$ 이고 $\\overline{AB}=10$ 일 때 $\\overline{AC}$ 의 길이는?",
  },
  {
    name: "극한-limits",
    content:
      "$\\lim_{n \\to \\infty} \\frac{2n^{2}+1}{n^{2}-3}$ 의 값을 구하시오.",
  },
  {
    name: "유니코드-기호",
    content: "√10 ≤ x ≤ 5 를 만족하는 자연수 x 의 개수는? (단, x ≠ 4)",
  },
  {
    name: "보기상자-blockquote",
    content:
      "다음 조건을 만족시키는 함수의 개수는?\n\n> $f(1)=2$\n> $f(2)=3$\n",
  },
  {
    name: "꼬리중복-OCR결함",
    content:
      "다음 중 일차부등식이 아닌 것은?\n\n$5-3x\\ge x+9$\n\n$6x\\le3x+1$\n\n$x-2x^{2}>7-2x^{2}$\n\n$5-3x\\ge x+9$\n\n$6x\\le3x+1$\n\n$x-2x^{2}>7-2x^{2}$",
  },
  {
    // ── 렌더 수리 B(2026-08-17)에서 **새로 추가**한 상자 케이스 ───────────────
    // 기존 10개 케이스의 해시는 한 글자도 안 바뀐다(상자 마커가 없으므로).
    // 아래 셋만 새 키로 들어온다 — 상자 렌더가 이제 잠긴다.
    name: "상자-보기-자모",
    content:
      "<보기>에서 옳은 것만을 고른 것은?\n< 보 기 >\nㄱ. 참이다.\nㄴ. 거짓이다.\nㄷ. 알 수 없다.\n1. ㄱ\n2. ㄴ",
  },
  {
    name: "상자-조건-발문꼬리",
    content:
      "다음 <조건>을 만족한다. <조건>(가) $p$는 확률이다.(나) $q$는 확률이다.이 때 $p+q$의 값은?",
  },
  {
    name: "상자-긴보기-1열",
    content:
      "다음 중 옳은 것은?\n1. 서로 다른 두 소수는 항상 서로소이다.\n2. $b$\n3. $c$\n4. $d$",
  },
  {
    name: "지수-계산",
    content: "$a^{3} \\times a^{2} \\div a^{4}$ 을 간단히 하시오.",
  },
  /* ── 2026-08-18 추가: 전처리가 **스스로 만드는** KaTeX HTML 확장 경로 ────────
     `\htmlClass{repeat-dot}` · `\htmlClass{geom-arc-wrap}` 은 이 저장소가
     만들어 내는 것인데, 렌더가 `trust` 없이 거부해 붉은 날문자로 나갔다.
     위 `순환소수-점표기` 가 escape 사고로 이 경로를 못 지나갔으므로 따로 둔다. */
  {
    name: "순환마디-두점",
    content: "$1.2\\dot{3}\\dot{4}$ 를 기약분수로 나타내어라.",
  },
  { name: "호-widehat", content: "호 $\\widehat{AB}$ 의 길이를 구하시오." },
];

const MATHTEXT_CASES: Array<{
  name: string;
  text: string;
  as: "span" | "div";
}> = [
  { name: "정답-인라인", text: "$\\frac{28}{100}=0.28$", as: "span" },
  { name: "정답-원문자", text: "②", as: "span" },
  {
    name: "해설-블록",
    text: "$\\frac{7}{25} = \\frac{28}{100} = 0.28$\n\n따라서 답은 $0.28$ 이다.",
    as: "div",
  },
  {
    name: "해설-합기호",
    text: "$\\sum_{k=1}^{9} a_k = 12$ 이므로 $a_{10}=3$ 이다.",
    as: "div",
  },
];

function renderAll(): Record<string, string> {
  const hashes: Record<string, string> = {};
  for (const { name, content } of PAPER_CASES) {
    hashes[`paper:${name}`] = sha256(
      renderToStaticMarkup(<PaperProblemView content={content} />),
    );
  }
  for (const { name, text, as } of MATHTEXT_CASES) {
    hashes[`math:${name}`] = sha256(
      renderToStaticMarkup(<MathText as={as} text={text} />),
    );
  }
  // 넓은 그물 — Mock 문항 전량(본문·정답·해설)을 한 해시로 묶는다.
  // 위 대표 입력이 못 지나간 전처리 분기까지 한꺼번에 잠근다.
  hashes["corpus:mock-problems"] = sha256(
    MOCK_PROBLEMS.map((problem) =>
      [
        renderToStaticMarkup(<PaperProblemView content={problem.content} />),
        renderToStaticMarkup(<MathText as="span" text={problem.answer} />),
        renderToStaticMarkup(
          <MathText as="div" text={problem.solution ?? ""} />,
        ),
      ].join(" "),
    ).join(""),
  );
  return hashes;
}

describe("[렌더 동일성] 성능 수리 전후 HTML 이 같아야 한다", () => {
  it("대표 문항의 렌더 HTML 해시가 기준과 같다", () => {
    const actual = renderAll();

    if (DUMP) {
      writeFileSync(FIXTURE, `${JSON.stringify(actual, null, 2)}\n`, "utf8");
      return;
    }

    const expected = readExpected();
    expect(Object.keys(expected).length).toBe(Object.keys(actual).length);
    expect(actual).toEqual(expected);
  });
});

/**
 * ── 붉은 글씨 금지 (2026-08-18) ──────────────────────────────────────────────
 * 해시 잠금은 «달라졌는가»만 본다. **처음부터 붉었으면 붉은 채로 잠긴다.**
 * 실제로 그랬다 — `preprocessMathText` 가 만든 `\htmlClass{repeat-dot}{…}` 를
 * `MarkdownRenderer` 가 `trust` 없이 넘겨 KaTeX 가 **예외 없이** 붉은 날문자로
 * 그렸다(실측 320행 · 수식 787곳). 원장님이 본 `0.\htmlClass\htmlClass이 되었고`.
 *
 * 그래서 «출력에 `#cc0000` 이 없다»를 따로 센다. 이 부류는 렌더 실패로 안 잡힌다
 * (CLAUDE.md 2026-08-16 «지표가 실패를 셀 수 있는 형태인지 먼저 확인하라»).
 */
const RED_TEXT = /#cc0000|katex-error/i;

/**
 * KaTeX 는 MathML `<annotation>` 에 **원본 TeX 를 그대로** 넣는다. 거기엔 성공해도
 * `\htmlClass` 글자가 남으므로, 「날문자가 지면에 찍혔는가」는 그 부분을 뺀 뒤 본다.
 * (안 빼면 성공한 렌더도 실패로 읽는다 — 지표가 거꾸로 걸리는 그 함정이다.)
 */
const stripAnnotation = (html: string): string =>
  html.replace(/<annotation[\s\S]*?<\/annotation>/g, "");

/** 전처리가 **스스로 만드는** KaTeX HTML 확장 — 이게 거부되면 붉게 나온다. */
const HTML_EXTENSION_CASES: Array<{ name: string; content: string }> = [
  { name: "순환마디-overline", content: "$0.\\overline{3}$ 을 분수로." },
  { name: "순환마디-dot", content: "$0.\\dot{5}$ 를 분수로." },
  { name: "순환마디-두점", content: "$1.2\\dot{3}\\dot{4}$ 를 분수로." },
  { name: "호-widehat", content: "호 $\\widehat{AB}$ 의 길이는?" },
  {
    name: "호-overset-frown",
    content: "호 $\\overset{\\frown}{ABC}$ 의 길이는?",
  },
];

describe("[렌더 안전] 지면에 붉은 글씨가 나가지 않는다", () => {
  it.each(HTML_EXTENSION_CASES)(
    "$name — `\\htmlClass` 가 거부되지 않는다",
    ({ content }) => {
      const html = renderToStaticMarkup(<PaperProblemView content={content} />);
      expect(html).not.toMatch(RED_TEXT);
      // 날문자 `\htmlClass` 가 **지면에** 찍히면 안 된다(MathML 주석은 뺀다).
      expect(stripAnnotation(html)).not.toContain("htmlClass");
      // 클래스는 살아남아야 한다 — 그래야 CSS 가 점·호를 그린다.
      expect(html).toMatch(/class="[^"]*(?:repeat-dot|geom-arc-wrap)/);
    },
  );

  it("대표 문항·Mock 전량에도 붉은 글씨가 없다", () => {
    const red: string[] = [];
    for (const { name, content } of PAPER_CASES)
      if (
        RED_TEXT.test(
          renderToStaticMarkup(<PaperProblemView content={content} />),
        )
      )
        red.push(`paper:${name}`);
    for (const problem of MOCK_PROBLEMS)
      if (
        RED_TEXT.test(
          renderToStaticMarkup(<PaperProblemView content={problem.content} />),
        )
      )
        red.push(`mock:${problem.id}`);
    expect(red).toEqual([]);
  });
});
