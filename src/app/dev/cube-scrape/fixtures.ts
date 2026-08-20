export type CubeScrapeItem = {
  id: string;
  genre: string;
  page: number;
  title: string;
  content: string;
  figureUrls?: string[];
  figureSpec?: unknown;
};

const FIG = "/dev/cube-scrape";

/** 각 ㄱㄴㄷ — FigureSpec v2 (엔진 A). 빈칸 문장은 본문. */
export const ANGLE_SPEC = {
  version: 2,
  style: { show_points: true, label_offset: 16, point_radius: 2.2 },
  points: { G: [24, 88], N: [120, 22], D: [216, 88] },
  segments: { gn: ["G", "N"], nd: ["N", "D"] },
  labels: { G: "ㄱ", N: "ㄴ", D: "ㄷ" },
};

/** 원·삼각형·사다리꼴 안 수 — FigureSpec v2. */
export const SHAPES_SPEC = {
  version: 2,
  style: { show_points: false, label_offset: 1, font_size: 12 },
  points: {
    t1: [18, 18],
    t2: [78, 18],
    t3: [48, 78],
    tL: [48, 42],
    r1: [96, 22],
    r2: [160, 22],
    r3: [160, 62],
    r4: [96, 62],
    rL: [128, 42],
    O1: [214, 42],
    u1: [18, 96],
    u2: [78, 148],
    u3: [18, 148],
    uL: [34, 128],
    O2: [128, 126],
    z1: [176, 122],
    z2: [236, 122],
    z3: [252, 158],
    z4: [160, 158],
    zL: [206, 142],
  },
  circles: {
    c1: { center: "O1", radius: 28 },
    c2: { center: "O2", radius: 24 },
  },
  segments: {
    t12: ["t1", "t2"],
    t23: ["t2", "t3"],
    t31: ["t3", "t1"],
    r12: ["r1", "r2"],
    r23: ["r2", "r3"],
    r34: ["r3", "r4"],
    r41: ["r4", "r1"],
    u12: ["u1", "u2"],
    u23: ["u2", "u3"],
    u31: ["u3", "u1"],
    z12: ["z1", "z2"],
    z23: ["z2", "z3"],
    z34: ["z3", "z4"],
    z41: ["z4", "z1"],
  },
  labels: {
    tL: "207",
    rL: "385",
    O1: "469",
    uL: "437",
    O2: "543",
    zL: "118",
  },
};

/** 개념 3-1 진도북에서 긁은 검수 표본. 공유 DB 행이 아니다. */
export const CUBE_SCRAPE_ITEMS: CubeScrapeItem[] = [
  {
    id: "eval-04",
    genre: "평가",
    page: 149,
    title: "문장제",
    content:
      "야구장에 입장한 남자는 $278$명이고, 여자는 남자보다 $156$명 더 많습니다. 야구장에 입장한 여자는 몇 명인지 구하세요.",
  },
  {
    id: "wrap-14",
    genre: "단원 마무리",
    page: 29,
    title: "문장제",
    content:
      "어느 가게에서 초콜릿을 지난주에 $876$개 팔았고, 이번 주에 $547$개 팔았습니다. 이 가게에서 지난주와 이번 주에 판 초콜릿은 모두 몇 개인가요?",
  },
  {
    id: "wrap-16",
    genre: "단원 마무리",
    page: 30,
    title: "문장제 · 초등 엔진",
    content:
      "수 카드 $3$장을 한 번씩만 사용하여 만들 수 있는 가장 큰 세 자리 수와 $356$의 차를 구하세요.",
    figureSpec: {
      version: "elem-1",
      kind: "numberCards",
      cards: ["2", "9", "4"],
    },
  },
  {
    id: "drill-03",
    genre: "수학 익힘",
    page: 24,
    title: "문장제 · 삽화 오림",
    content:
      "오늘 동물원에 입장한 남자는 $347$명, 여자는 $428$명입니다. 오늘 동물원에 입장한 사람은 모두 몇 명인가요?",
    figureUrls: [`${FIG}/p24-q03-illust.png`],
  },
  {
    id: "wrap-04",
    genre: "단원 마무리",
    page: 28,
    title: "계산",
    content: "계산해 보세요.\n\n$126+745$",
  },
  {
    id: "wrap-05",
    genre: "단원 마무리",
    page: 28,
    title: "계산",
    content: "계산해 보세요.\n\n$781-254$",
  },
  {
    id: "drill-02",
    genre: "수학 익힘",
    page: 24,
    title: "계산",
    content:
      "계산 결과를 비교하여 $\\bigcirc$ 안에 $<$, $=$, $>$ 를 알맞게 써넣으세요.\n\n$256+312 \\quad \\bigcirc \\quad 435+124$",
  },
  {
    id: "eval-01",
    genre: "평가",
    page: 149,
    title: "계산 · 세로셈",
    content:
      "계산해 보세요.\n\n$$\\begin{array}{r} 265 \\\\ +413 \\\\ \\hline \\end{array}$$",
  },
  {
    id: "wrap-01",
    genre: "단원 마무리",
    page: 28,
    title: "계산 · 초등 엔진",
    content: "수 모형을 보고 $264+123$을 계산해 보세요.\n\n$264+123=\\square$",
    figureSpec: {
      version: "elem-1",
      kind: "base10",
      rows: [
        { hundreds: 2, tens: 6, ones: 4 },
        { hundreds: 1, tens: 2, ones: 3 },
      ],
    },
  },
  {
    id: "drill-04",
    genre: "수학 익힘",
    page: 24,
    title: "계산 · 초등 엔진",
    content: "빈칸에 알맞은 수를 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "boxChain",
      start: "219",
      steps: ["+462", "+138"],
    },
  },
  {
    id: "drill-05",
    genre: "수학 익힘",
    page: 24,
    title: "계산 · 도형 엔진",
    content: "원 안에 있는 수의 합을 구하세요.",
    figureSpec: SHAPES_SPEC,
  },
  {
    id: "wrap-10",
    genre: "단원 마무리",
    page: 29,
    title: "계산 · 초등 엔진",
    content: "빈칸에 알맞은 수를 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "opTree",
      start: "725",
      ops: ["-513", "+679"],
    },
  },
  {
    id: "wrap-12",
    genre: "단원 마무리",
    page: 29,
    title: "문장제 · 초등 엔진",
    content: "수 카드가 나타내는 수보다 $145$만큼 더 큰 수를 구하세요.",
    figureSpec: {
      version: "elem-1",
      kind: "placeValue",
      hundreds: 3,
      tens: 2,
      ones: 6,
    },
  },
  {
    id: "eval-03",
    genre: "평가",
    page: 149,
    title: "계산 · 초등 엔진",
    content: "$\\square$ 안에 알맞은 수를 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "opBox",
      input: "845",
      op: "−369",
    },
  },
  {
    id: "eval-07",
    genre: "평가",
    page: 149,
    title: "도형 · 도형 엔진",
    content:
      "그림을 보고 각, 꼭짓점, 변을 쓰세요.\n\n각 (　　)  \n각의 꼭짓점 (　　)  \n각의 변 (　　)",
    figureSpec: ANGLE_SPEC,
  },
  {
    id: "drill-01",
    genre: "수학 익힘",
    page: 24,
    title: "계산 · 초등 엔진",
    content: "빈칸에 두 수의 합을 써넣으세요.",
    figureSpec: {
      version: "elem-1",
      kind: "sumBox",
      left: "143",
      right: "532",
    },
  },
];
