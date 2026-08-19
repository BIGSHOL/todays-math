-- 그림 **원본 지면 물리 폭(mm)** — 「얼마로 그린다」를 담는다.
--
-- ⚠️⚠️ **이 마이그레이션은 아직 적용하지 않았다** (2026-08-19, 그림 인쇄 크기 트랙).
--       공유 DB(D-31)를 쓰는 저장소라 적용은 원장님 확인 뒤에 한다. 그때까지
--       `prisma/schema.prisma` 에도 이 컬럼을 넣지 않았다 — 인쇄 화면 질의가
--       `include: { problem: true }`(스칼라 전량 SELECT)라, 스키마에만 먼저 넣으면
--       컬럼 없는 DB 를 향해 `SELECT figure_source_mm` 을 쏴서 **인쇄가 통째로 죽는다.**
--       적용 순서: 이 SQL → `schema.prisma` 에 `figureSourceMm Float[]` 추가 →
--       `prisma generate` → 인쇄 화면 질의에 필드 추가. 자세한 것은
--       docs/planning/tracks/report-figure-print-size.md §「막힌 것」.
--
-- 왜 필요한가: 지금 지면 규칙은 「픽셀 폭이 264.567(=70mm)을 넘으면 70mm 로 줄이고,
-- 아니면 픽셀 그대로(96dpi)」뿐이다. **「얼마로 그린다」가 없다.** 원본 가로 픽셀이
-- 41~7,343px(중앙 425)이라 **같은 삼각형이 문항마다 다른 크기**로 인쇄된다.
-- 그리고 다른 트랙이 300dpi 로 다시 자르면 지금 200px 인 그림이 600px 이 되어
-- 264 를 넘고 **70mm 로 확대**된다 — 자르기만 고치면 지면이 통째로 달라진다.
-- 근거: docs/planning/tracks/figure-quality-brief.md §9 · §14.
--
-- 원장님 지시(2026-08-19): 「모든 그림이나 도형 크기가 **일관성이 있어야** 하니까」.
--
-- 왜 DB 컬럼인가 (별도 대장·figure_dims 확장을 안 고른 이유)
--   · 판정(`assessOverflowRisk`)은 **브라우저에서** 돈다. 인쇄 미리보기를 그리기
--     전에 경고를 내야 하므로 그 시점에 파일도 대장도 읽을 수 없다. `figure_dims`
--     가 컬럼인 이유와 같다.
--   · `figure_dims` 에 섞으면 길이 검사(`flat.length !== figureCount * 2`)가 조용히
--     무너진다. 그 검사가 「짝이 어긋난 값을 안다고 착각하지 않게」 막는 유일한 가드다.
--   · 별도 대장(JSON)은 서버 컴포넌트에서만 읽힌다. 문제은행·검수는 API 라우트로
--     문항을 받으므로 대장을 각자 이어 붙여야 하고, 한 곳만 빠뜨리면
--     **화면과 지면이 다른 크기**로 그린다.
--   · `choice_figure_index`(2026-08-18)와 **같은 규약**의 형제 컬럼이다 — 읽는 규칙이
--     한 곳(`src/lib/figurePrintSize.ts`)에 모인다.
--
-- 형식: `figure_urls` 와 **같은 순서·같은 길이**의 실수 배열, 단위는 **mm**.
--   값은 **원본 크기**이지 인쇄 폭이 아니다. 70mm 상한은 제품 정책이라
--   `figurePrintWidthMm` 이 인쇄 시점에 건다 — 측정값과 정책을 같은 칸에 담으면
--   정책이 바뀔 때 측정값이 이미 잘려 있어 되돌릴 수 없다.
--
-- ⚠️ **빈 배열 = «모른다»** 이고 그게 기본값이다. 47,152행이 여기서 시작한다.
--    모르면 지면은 **오늘 그대로** 픽셀로 그린다(회귀 0). 이 트랙의 합격 조건이다.
--
-- 판정이 «모른다» 로 받는 경우 (규칙 한 곳: src/lib/figurePrintSize.ts)
--   (1) cardinality(figure_source_mm) <> cardinality(figure_urls)  → **통째로**
--   (2) 값이 0 이하·NaN·무한대                                     → 그 자리만
--   (3) 값이 1mm 미만 또는 210mm(A4 폭) 초과                       → 그 자리만
--   ⚠️ (3)의 두 경계는 **실측이 아니다.** 원장(figure-rect-ledger.json)이 아직 없어
--      실제 분포를 못 쟀다. 「흔한가」가 아니라 **「물리적으로 가능한가」**만 본다.
--      덤으로 단위 착오를 잡는다 — 1/100mm 로 오해해 7000 을 적으면 걸린다.
--
-- 적재 예정: `그림벡터` 트랙 산출물 `scripts/qa/reports/figure-rect-ledger.json`
--            (그림마다 `width_mm`). 적재 검사는 `checkFigureSourceMm` 을 쓸 것 —
--            읽기와 달리 **한 자리만 손상돼도 배열째** 막는다.
--
-- 되돌리기: ALTER TABLE "problem" DROP COLUMN "figure_source_mm";
-- (기존 데이터를 한 바이트도 안 건드리는 순수 추가다. 기본값이 카탈로그에 저장되므로
--  47,152행을 다시 쓰지 않는다 — PostgreSQL 11+.)
ALTER TABLE "problem"
  ADD COLUMN "figure_source_mm" DOUBLE PRECISION[] NOT NULL DEFAULT ARRAY[]::DOUBLE PRECISION[];

COMMENT ON COLUMN "problem"."figure_source_mm" IS
  'figure_urls 와 같은 순서·같은 길이. 원본 지면에서 그 그림이 차지하던 물리 폭(mm). '
  '인쇄 폭이 아니라 원본 크기다 — 70mm 상한은 인쇄 시점 정책(figurePrintWidthMm). '
  '빈 배열=모른다(기본값) → 지면은 오늘처럼 원본 픽셀 크기로 그린다. '
  '길이 불일치는 통째로, 0 이하·1mm 미만·210mm 초과는 그 자리만 «모른다»로 받는다. '
  '규칙 한 곳: src/lib/figurePrintSize.ts';
