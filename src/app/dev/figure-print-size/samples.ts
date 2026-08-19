/**
 * 전후 비교 지면의 표본 — **원본 픽셀 폭이 서로 크게 다른 실제 그림**을 고른다.
 *
 * 고른 기준: `public/figures` 표본 674장의 폭 분포(68~2,829px)에서 구간마다 하나씩.
 * 지금 규칙에서 **상한 아래인 것(픽셀 그대로)과 상한에 걸리는 것(70mm)** 이 둘 다
 * 있어야 「무엇이 달라지는가」가 지면에 나온다.
 *
 * ⚠️ 문항 본문은 **시안 문구**다. 공유 DB(D-31)를 읽지 않고 만든 화면이라 실제
 *    문항이 아니다. 이 화면이 보여 주는 것은 **그림의 크기**이지 본문이 아니다.
 *    본문 길이는 실측 문항의 흔한 길이를 본떴다(그림이 본문을 밀어내는지 봐야 한다).
 */

export interface FigureSample {
  /** `public/figures` 아래 실제 파일. 없으면 화면이 「지금 없다」고 적는다. */
  url: string;
  /** 왜 이 장을 골랐나 — 화면에 그대로 적는다. */
  why: string;
  content: string;
  answer: string;
}

export const FIGURE_SAMPLES: FigureSample[] = [
  {
    url: "/figures/2065/hwp-q04.png",
    why: "가장 작은 축(68px). 지금은 68px 그대로 = 18.0mm 로 나간다.",
    content:
      "그림과 같이 한 변의 길이가 $6\\,\\mathrm{cm}$ 인 정삼각형 $\\mathrm{ABC}$ 가 있다. " +
      "변 $\\overline{\\mathrm{BC}}$ 의 중점을 $\\mathrm{M}$ 이라 할 때, 선분 $\\overline{\\mathrm{AM}}$ 의 길이는?\n" +
      "1. $3\\,\\mathrm{cm}$\n2. $3\\sqrt{2}\\,\\mathrm{cm}$\n3. $3\\sqrt{3}\\,\\mathrm{cm}$\n4. $6\\,\\mathrm{cm}$\n5. $6\\sqrt{3}\\,\\mathrm{cm}$",
    answer: "③",
  },
  {
    url: "/figures/1731/hwp-q05.png",
    why: "작은 축(121px). 지금은 121px 그대로 = 32.0mm.",
    content:
      "그림은 어느 반 학생 $30$ 명의 하루 수면 시간을 조사하여 나타낸 것이다. " +
      "수면 시간이 $7$ 시간 이상인 학생은 전체의 몇 %인가?\n" +
      "1. $20\\,\\%$\n2. $30\\,\\%$\n3. $40\\,\\%$\n4. $50\\,\\%$\n5. $60\\,\\%$",
    answer: "④",
  },
  {
    url: "/figures/1557/hwp-q03.png",
    why: "상한 바로 아래(220px = 58.2mm). 여기까지는 지금도 픽셀 그대로다.",
    content:
      "그림과 같이 좌표평면 위에 두 점 $\\mathrm{A}(-2,\\,3)$, $\\mathrm{B}(4,\\,-1)$ 이 있다. " +
      "선분 $\\overline{\\mathrm{AB}}$ 를 $1:2$ 로 내분하는 점의 좌표를 구하시오.",
    answer: "$(0,\\,\\frac{5}{3})$",
  },
  {
    url: "/figures/2248/q01.jpeg",
    why: "상한을 막 넘는다(300px). 지금은 70mm 로 줄어든다.",
    content:
      "그림과 같이 직육면체 모양의 상자가 있다. 이 상자의 겉넓이가 $94\\,\\mathrm{cm}^2$ 이고 " +
      "밑면의 가로와 세로의 길이가 각각 $5\\,\\mathrm{cm}$, $3\\,\\mathrm{cm}$ 일 때, 높이를 구하시오.",
    answer: "$4\\,\\mathrm{cm}$",
  },
  {
    url: "/figures/1622/q06.png",
    why: "상한을 크게 넘는다(500px). 지금은 70mm.",
    content:
      "그림과 같이 원 $\\mathrm{O}$ 에서 두 현 $\\overline{\\mathrm{AB}}$ 와 $\\overline{\\mathrm{CD}}$ 가 " +
      "점 $\\mathrm{P}$ 에서 만난다. $\\overline{\\mathrm{PA}}=4$, $\\overline{\\mathrm{PB}}=6$, " +
      "$\\overline{\\mathrm{PC}}=3$ 일 때 $\\overline{\\mathrm{PD}}$ 의 길이는?\n" +
      "1. $6$\n2. $7$\n3. $8$\n4. $9$\n5. $10$",
    answer: "③",
  },
  {
    url: "/figures/2027/q09.jpeg",
    why: "가장 큰 축(900px). 지금도 새 규칙에서도 70mm — 여기는 안 바뀐다.",
    content:
      "그림과 같은 함수 $y=f(x)$ 의 그래프에 대하여 $f(f(2))$ 의 값을 구하시오.",
    answer: "$1$",
  },
];

/**
 * 🔴 **원장(`figure-rect-ledger.json`)이 없을 때 쓰는 «가정» mm.**
 *
 * 우리 오려내기가 **200dpi 로** 잘랐다는 것이 근거다
 * (`crop-rpm-from-pdf.py` `DEFAULT_DPI = 200` · `extract-all-figures.py` `CLIP_DPI = 200`,
 * 그림 화질 브리프 §2). 그 경로로 잘린 그림은 `픽셀 / 200 * 25.4` 가 원본 지면에서의
 * 물리 폭이다.
 *
 * ⚠️ **전량에 맞는 값이 아니다.** 같은 추출기에 「네이티브 이미지 추출(xref)」 경로가
 *    따로 있고, 그쪽은 픽셀이 **원본에 박힌 이미지의 픽셀**이라 200 으로 나누면 틀린다.
 *    그 두 경로의 비율은 **아직 안 쟀다** — 계수기가 값을 올리기만 하고 안 찍는다
 *    (브리프 §15). 그래서 이 값은 **측정이 아니라 가정**이고, 화면에 그렇게 적는다.
 *    원장 파일이 생기면 이 함수는 안 쓰인다.
 */
export const ASSUMED_CROP_DPI = 200;

export function assumedSourceMm(pixelWidth: number): number {
  return (pixelWidth / ASSUMED_CROP_DPI) * 25.4;
}

/** 회수된 실측 원장. `그림벡터` 트랙 산출물 — 아직 없으면 화면이 가정값으로 내려간다. */
export const RECT_LEDGER_PATH = "scripts/qa/reports/figure-rect-ledger.json";
