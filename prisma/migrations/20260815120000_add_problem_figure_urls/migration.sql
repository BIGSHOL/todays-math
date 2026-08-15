-- 원본 시험지에서 오려 온 그림 경로들.
-- 완료본 PDF 는 그림을 이미지로 심고 있어 재작도가 필요 없다(08 §5.1.1 계열 조사).
-- 선택지마다 그림인 문항이 있어 배열이다(실측 한 문항 최대 6장).
--
-- NOT NULL + 상수 기본값이라 PostgreSQL 11+ 에서 테이블 재작성 없이 즉시 붙는다.
-- (다른 세션이 적재 중이어도 안전하다.)
ALTER TABLE "problem"
  ADD COLUMN IF NOT EXISTS "figure_urls" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
