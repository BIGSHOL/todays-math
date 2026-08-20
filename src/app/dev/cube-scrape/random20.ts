import type { CubeScrapeItem } from "./fixtures";

const RIGHT_TRIANGLES = {
  version: "elem-1",
  kind: "namedShapes",
  items: [
    { shape: "rightTri", label: "가" },
    { shape: "wideTri", label: "나" },
  ],
};

const SIX_SHAPES = {
  version: "elem-1",
  kind: "namedShapes",
  items: [
    { shape: "square", label: "가" },
    { shape: "rightTri", label: "나" },
    { shape: "isoTri", label: "다" },
    { shape: "diamond", label: "라" },
    { shape: "tallDiamond", label: "마" },
    { shape: "rect", label: "바" },
  ],
};

const SIXTHS_RECT = {
  version: 2,
  style: { show_points: false, segment_width: 1.4, font_size: 13 },
  points: {
    tl: [12, 20],
    tr: [156, 20],
    br: [156, 72],
    bl: [12, 72],
    t1: [36, 20],
    t2: [60, 20],
    t3: [84, 20],
    t4: [108, 20],
    t5: [132, 20],
    b1: [36, 72],
    b2: [60, 72],
    b3: [84, 72],
    b4: [108, 72],
    b5: [132, 72],
  },
  segments: {
    top: ["tl", "tr"],
    right: ["tr", "br"],
    bot: ["br", "bl"],
    left: ["bl", "tl"],
    m1: ["t1", "b1"],
    m2: ["t2", "b2"],
    m3: ["t3", "b3"],
    m4: ["t4", "b4"],
    m5: ["t5", "b5"],
  },
};

/**
 * 개념 3-1 진도북 무작위 20. seed=20260823.
 * 합격 16·이전 무작위 40은 빠졌다 (`scripts/qa/pick-cube-random20.py` EXCLUDE).
 * 그림 규칙: 09 §2.1 · D-61 — namedShapes 라벨 아래, table 폭≤240,
 * trapFour 합동 직각삼각형 넷. 적재하지 않았다.
 */
export const CUBE_RANDOM_20: CubeScrapeItem[] = [
  {
    id: "cube-concept-3-1-p025-q08",
    genre: "수학 익힘",
    page: 25,
    title: "계산",
    content:
      "$579-234$를 두 가지 방법으로 계산하려고 합니다. $\\square$ 안에 알맞은 수를 써넣으세요.\n\n(1) 백의 자리부터 빼기\n\n$$500-200=\\square$$\n\n$$70-\\square=\\square$$\n\n$$\\square-4=\\square$$\n\n(2) 일의 자리부터 빼기\n\n$$9-4=\\square$$\n\n$$70-30=\\square$$\n\n$$500-200=\\square$$",
  },
  {
    id: "cube-concept-3-1-p028-q02",
    genre: "단원 마무리",
    page: 28,
    title: "계산",
    content:
      "$742-521$을 다음과 같은 방법으로 계산하려고 합니다. $\\square$ 안에 알맞은 수를 써넣으세요.\n\n$700$에서 $500$을 빼고, $40$에서 $20$을 빼고, $2$에서 $1$을 뺍니다.\n\n(1) $700-500=\\square$\n\n(2) $40-\\square=\\square$\n\n(3) $\\square-1=\\square$\n\n$$742-521=\\square$$",
  },
  {
    id: "cube-concept-3-1-p049-q1",
    genre: "수학 익힘",
    page: 49,
    title: "도형 · 초등 엔진",
    content:
      "가와 나 중에서 직각삼각형이 아닌 것을 찾고, 그 이유를 쓰세요.",
    figureSpec: RIGHT_TRIANGLES,
  },
  {
    id: "cube-concept-3-1-p050-q07",
    genre: "단원 마무리",
    page: 50,
    title: "도형 · 초등 엔진",
    content: "직사각형을 모두 찾아 기호를 쓰세요.",
    figureSpec: SIX_SHAPES,
  },
  {
    id: "cube-concept-3-1-p069-q11",
    genre: "단원 마무리",
    page: 69,
    title: "계산 · 초등 엔진",
    content:
      "그림을 보고 나눗셈의 몫을 곱셈식으로 구하세요.\n\n(1) 나눗셈식 $24\\div 8=\\square$\n\n(2) 곱셈식 $8\\times\\square=24$\n\n(3) 몫 $\\square$",
    figureSpec: {
      version: "elem-1",
      kind: "dotGrid",
      rows: 3,
      cols: 8,
    },
  },
  {
    id: "cube-concept-3-1-p069-q49",
    genre: "단원 마무리",
    page: 69,
    title: "계산 · 초등 엔진",
    content:
      "곱셈표를 이용하여 나눗셈의 몫을 구하세요.\n\n(1) $30\\div 6=\\square$\n\n(2) $48\\div 8=\\square$",
    figureSpec: {
      version: "elem-1",
      kind: "table",
      headers: ["×", "3", "4", "5", "6", "7", "8"],
      rows: [
        ["4", "12", "16", "20", "24", "28", "32"],
        ["5", "15", "20", "25", "30", "35", "40"],
        ["6", "18", "24", "30", "36", "42", "48"],
        ["7", "21", "28", "35", "42", "49", "56"],
      ],
    },
  },
  {
    id: "cube-concept-3-1-p070-q19",
    genre: "단원 마무리",
    page: 70,
    title: "문장제 · 초등 엔진",
    content:
      "길이가 $45$ cm인 털실이 있습니다. 이 털실을 한 도막이 $5$ cm씩 되도록 자르면 몇 도막이 되는지 두 가지 방법으로 구하세요.\n\n(1) 뺄셈으로 해결하기\n\n(2) 나눗셈으로 해결하기",
    figureSpec: {
      version: "elem-1",
      kind: "tape",
      length: 45,
      label: "45cm",
      segments: 9,
    },
  },
  {
    id: "cube-concept-3-1-p090-q05",
    genre: "단원 마무리",
    page: 90,
    title: "계산",
    content:
      "$\\square$ 안에 알맞은 수를 써넣으세요.\n\n$$43\\times 3$$\n\n(1) $40\\times 3=\\square$\n\n(2) $3\\times 3=\\square$",
  },
  {
    id: "cube-concept-3-1-p110-q04",
    genre: "수학 익힘",
    page: 110,
    title: "계산 · 초등 엔진",
    content: "길이가 긴 것부터 차례로 기호를 쓰세요.",
    figureSpec: {
      version: "elem-1",
      kind: "boxedList",
      marks: ["㉠", "㉡", "㉢"],
      items: ["1 km 40 m", "1007 m", "1 km 900 m"],
    },
  },
  {
    id: "cube-concept-3-1-p113-q10",
    genre: "수학 익힘",
    page: 113,
    title: "문장제 · 초등 엔진",
    content:
      "시계가 나타내는 시각에서 $2$시간 $40$분 후의 시각은 몇 시 몇 분인지 풀이 과정을 쓰고, 답을 구하세요.",
    figureSpec: {
      version: "elem-1",
      kind: "clocks",
      items: [{ hour: 4, minute: 25 }],
    },
  },
  {
    id: "cube-concept-3-1-p115-q10",
    genre: "단원 마무리",
    page: 115,
    title: "계산 · 초등 엔진",
    content:
      "빈칸에 알맞게 써넣으세요. $7$시 $20$분에서 $1$시간 $50$분 전의 시각입니다.",
    figureSpec: {
      version: "elem-1",
      kind: "pills",
      items: ["7시 20분", "□"],
    },
  },
  {
    id: "cube-concept-3-1-p140-q08",
    genre: "수학 익힘",
    page: 140,
    title: "도형 · 도형 엔진",
    content:
      "그림은 전체의 $\\dfrac{5}{6}$입니다. 그림에서 $\\dfrac{1}{6}$만큼 색칠해 보세요.",
    figureSpec: SIXTHS_RECT,
  },
  {
    id: "cube-concept-3-1-p142-q19",
    genre: "수학 익힘",
    page: 142,
    title: "계산",
    content:
      "두 소수의 크기를 비교하여 $\\bigcirc$ 안에 $>$, $=$, $<$ 를 알맞게 써넣으세요.\n\n(1) $0.8$ $\\bigcirc$ $0.1$이 $9$개인 수\n\n(2) $0.1$이 $45$개인 수 $\\bigcirc$ $4.5$",
  },
  {
    id: "cube-concept-3-1-p142-q21",
    genre: "수학 익힘",
    page: 142,
    title: "계산 · 초등 엔진",
    content: "큰 수부터 순서대로 (　　) 안에 $1$, $2$, $3$을 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "boxedList",
      marks: ["", "", ""],
      items: ["팔 점 삼", "8과 0.6만큼인 수", "0.1이 81개인 수"],
    },
  },
  {
    id: "cube-concept-3-1-p144-q05",
    genre: "단원 마무리",
    page: 144,
    title: "계산 · 초등 엔진",
    content: "과자를 똑같이 $\\square$(으)로 나눈 것입니다.",
    figureSpec: {
      version: "elem-1",
      kind: "fracPie",
      n: 6,
      filled: [0, 1, 2, 3, 4, 5],
    },
  },
  {
    id: "cube-concept-3-1-p145-q08",
    genre: "단원 마무리",
    page: 145,
    title: "도형 · 초등 엔진",
    content:
      "색칠한 부분과 색칠하지 않은 부분을 각각 분수로 나타내어 보세요.\n\n색칠한 부분 (　　)\n\n색칠하지 않은 부분 (　　)",
    figureSpec: {
      version: "elem-1",
      kind: "trapFour",
      filled: [0, 1, 3],
    },
  },
  {
    id: "cube-concept-3-1-p145-q09",
    genre: "단원 마무리",
    page: 145,
    title: "계산 · 초등 엔진",
    content: "$\\square$ 안에 알맞은 분수나 소수를 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "numberLine",
      min: 0,
      max: 1,
      step: 0.1,
      tick: 0.1,
      blanks: [0.1, 0.3, 0.6, 0.8],
    },
  },
  {
    id: "cube-concept-3-1-p150-q13",
    genre: "평가",
    page: 150,
    title: "계산 · 초등 엔진",
    content:
      "그림을 보고 나눗셈의 몫을 곱셈식으로 구하세요.\n\n(1) 나눗셈식 $21\\div 7=\\square$\n\n(2) 곱셈식 $7\\times\\square=21$\n\n(3) 몫 $\\square$",
    figureSpec: {
      version: "elem-1",
      kind: "dotGrid",
      rows: 3,
      cols: 7,
    },
  },
  {
    id: "cube-concept-3-1-p151-q19",
    genre: "평가",
    page: 151,
    title: "문장제",
    content:
      "딸기가 한 상자에 $24$개씩 $6$상자 있습니다. $\\square$ 안에 알맞은 수를 써넣으세요.\n\n$$24\\times 6=\\square$$\n\n딸기는 모두 $\\square$개입니다.",
  },
  {
    id: "cube-concept-3-1-p152-q26",
    genre: "평가",
    page: 152,
    title: "계산 · 초등 엔진",
    content:
      "색칠한 부분은 전체의 얼마인지 분수로 쓰고 읽어 보세요.\n\n쓰기 (　　)\n\n읽기 (　　)",
    figureSpec: {
      version: "elem-1",
      kind: "fracPie",
      n: 8,
      filled: [0, 2, 5],
    },
  },
];
