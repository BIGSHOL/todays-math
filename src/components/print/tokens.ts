export const PAPER_COLORS = {
  ink: "#0E0E10",
  ink90: "#1F1F23",
  ink70: "#3A3A40",
  ink50: "#6B6B72",
  ink30: "#A0A0A8",
  ink15: "#D4D4D8",
  ink08: "#E8E8EB",
  paper: "#FFFFFF",
  paperWarm: "#FCFCF8",
  accentGold: "#A57F00",
} as const;

export const PAPER_FONTS = {
  serifKR: '"KoPubBatang", "Nanum Myeongjo", "Noto Serif KR", "Batang", serif',
  sansKR: 'Pretendard, "Apple SD Gothic Neo", "Malgun Gothic", sans-serif',
} as const;

export const A4_DIMENSIONS = {
  widthMm: 210,
  heightMm: 297,
  widthPx: 794,
  heightPx: 1123,
} as const;

/**
 * 지면 CSS 변수 — A4Page(인쇄)와 PaperProblemView(화면 지면 틀)가 같은 값을 쓴다.
 * 한쪽만 바꾸면 화면과 인쇄물이 갈라지므로 반드시 여기서만 정의한다.
 */
export const PAPER_CSS_VARIABLES = {
  "--a4-width": `${A4_DIMENSIONS.widthMm}mm`,
  "--a4-height": `${A4_DIMENSIONS.heightMm}mm`,
  "--paper-color": PAPER_COLORS.paper,
  "--paper-warm": PAPER_COLORS.paperWarm,
  "--paper-ink": PAPER_COLORS.ink,
  "--paper-gold": PAPER_COLORS.accentGold,
  "--paper-font-serif": PAPER_FONTS.serifKR,
  "--paper-font-sans": PAPER_FONTS.sansKR,
} as const;
