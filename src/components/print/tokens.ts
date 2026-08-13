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
