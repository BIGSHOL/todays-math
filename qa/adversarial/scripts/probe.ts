/**
 * 적대적 리뷰 — 손으로 만든 **손상된 입력**을 판정기에 직접 먹여 본다. 읽기 전용.
 * (정상 입력만 보면 전부 초록이다 — CLAUDE.md 2026-08-16.)
 *
 * 실행: npx tsx qa/adversarial/scripts/probe.ts
 */
import { splitBoxSegments } from "../../../src/lib/math/boxBlock";
import { splitEquationChain } from "../../../src/lib/math/equationChain";
import {
  displayWidth,
  fitsTwoColumns,
} from "../../../src/lib/math/displayWidth";
import { parseProblemContent } from "../../../src/lib/problem/parseProblemContent";
import { findSubQuestionMarkers } from "../../../src/lib/math/subQuestion";

const line = (s: string) => console.log(s);

function subq(label: string, text: string) {
  const marks = findSubQuestionMarkers(text);
  line(
    `  ${label.padEnd(34)} → ${marks.length}개 ${JSON.stringify(marks.map((m) => m.number))}`,
  );
}

function box(label: string, text: string) {
  const segs = splitBoxSegments(text);
  const desc = segs
    .map((s) =>
      s.kind === "box"
        ? `[BOX ${s.label}${s.headerless ? "/머리없음" : ""} items=${JSON.stringify(s.items)}]`
        : `TEXT(${JSON.stringify(s.text.slice(0, 60))})`,
    )
    .join(" ");
  line(`  ${label.padEnd(34)} → ${desc}`);
}

function chain(label: string, span: string, worked = false) {
  const parts = splitEquationChain(span, { workedProcess: worked });
  line(`  ${label.padEnd(34)} → ${parts ? JSON.stringify(parts) : "null"}`);
}

line("\n■ 하위 문항 판정 (subQuestion)");
subq("(1)(2) 정상", "가. 문제\n(1) 첫째\n(2) 둘째");
subq("(2) 만 있다", "가. 문제\n(2) 둘째");
subq("(1)(3) 번호 건너뜀", "가. 문제\n(1) 첫째\n(3) 셋째");
subq("(1)(2)(1) 두 번 나옴", "문제\n(1) 첫째\n(2) 둘째\n(1) 다시");
subq("(2)(1) 거꾸로", "문제\n(2) 둘째\n(1) 첫째");
subq("$f$ $(1)$ · $f$ $(2)$ 함수값", "$f$ $(1)$ 과 $f$ $(2)$ 의 합은?");
subq("$f(1)$ $f(2)$ 한 span 안", "$f(1)+f(2)$ 의 값은?");
subq("보기 안의 ⑴⑵", "다음 중 옳은 것은? <보기> ㄱ. ⑴ 참 ㄴ. ⑵ 거짓");

line("\n■ 상자 판정 (boxBlock)");
box(
  "보기 안에 하위문항",
  "다음 중 옳은 것은? <보기>ㄱ. ⑴ 참이다 ㄴ. ⑵ 거짓이다",
);
box(
  "보기 안에 $(1)$ $(2)$",
  "다음 중 옳은 것은? <보기>ㄱ. $(1)$ 참이다 ㄴ. $(2)$ 거짓이다",
);
box(
  "서술형 발문 삼킴",
  "다음 조건을 만족한다. ∘ $a=1$ 이다 ∘ $b=2$ 이다 $a+b$ 의 값을 구하시오.",
);
box(
  "물음표 발문(대조군)",
  "다음 조건을 만족한다. ∘ $a=1$ 이다 ∘ $b=2$ 이다 $a+b$ 의 값은?",
);
box(
  "•가 본문 글자",
  "다음 조건을 모두 만족한다. 점 • 는 중점이다 • 는 또 다른 점이다",
);
box(
  "나열 안에 하위문항",
  "다음 수를 작은 것부터 나열하시오. $1$, $2$, $3$, $4$ ⑴ 첫째 ⑵ 둘째",
);

line("\n■ 계산 과정 (equationChain)");
chain("정상 이음", "$1+2=3+4=7$", true);
chain("연립 \\begin{cases}", "$x=\\begin{cases}1\\\\2\\end{cases}=3$", true);
chain("부등호 섞임", "$a=b\\le c=d$", true);
chain("\\lbrace 집합", "$A=\\lbrace x\\vert x=2\\rbrace$", true);
chain("\\leftarrow 화살표", "$a \\leftarrow b \\rightarrow c=d=e$", true);
chain("\\rightarrow 만", "$a \\rightarrow b=c=d$", true);
chain("HWP 잔재 # (줄바꿈)", "$1=2#3=4$", true);
chain("\\text 안의 쉼표", "$a=\\text{가, 나}=b$", true);
chain("행렬 \\pmatrix", "$A=\\pmatrix{1&2}=B$", true);
chain("\\begin 공백", "$x=\\begin {cases}1\\end{cases}=3$", true);

line("\n■ 표시폭 (displayWidth)");
for (const s of [
  "$a:b=9:40$",
  "$\\triangle ECG:\\triangle ACD=9:40$",
  "$a=b$",
  "$a\\colon b$",
  "$\\cdots$",
  "$1,~2,~3$",
])
  line(`  ${s.padEnd(34)} → ${displayWidth(s)}`);
line(
  `  fitsTwoColumns(['$a:b=9:40$','$x$']) → ${fitsTwoColumns(["$a:b=9:40$", "$x$"])}`,
);

line("\n■ 전체 경로 (parseProblemContent)");
const cases: Array<[string, string]> = [
  [
    "보기 안 하위문항",
    "다음 중 옳은 것은? <보기>ㄱ. ⑴ 참이다 ㄴ. ⑵ 거짓이다\n\n1. ㄱ\n2. ㄴ",
  ],
  ["제어문자 U+0001 한가운데", "앞 문장이다.뒤 문장이다."],
];
for (const [label, raw] of cases)
  line(`  ${label.padEnd(24)} → ${JSON.stringify(parseProblemContent(raw))}`);
