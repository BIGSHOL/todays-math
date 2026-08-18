-- 그림 원본 치수 — 넘침 판정이 그림 높이를 보려면 필요하다.
--
-- 왜 DB 인가: 판정(`assessOverflowRisk`)은 브라우저에서 돈다. 인쇄 미리보기를 그리기
-- **전에** 경고를 내야 하므로 그 시점에 이미지 파일을 읽을 방법이 없다. 그림 치수는
-- 적재 때 한 번 읽어 두는 값이라(원본이 안 바뀐다) 컬럼이 맞다.
--
-- 형식: `figure_urls` 와 **같은 순서**로 짝지은 `[w1,h1,w2,h2,…]` 평탄 배열.
-- 길이가 `cardinality(figure_urls) * 2` 가 아니면 판정이 통째로 «모른다»로 받는다
-- (`parseFigureDimensions`) — 어긋난 짝을 흘리면 판정이 안다고 착각한다.
--
-- 되돌리기: ALTER TABLE "problem" DROP COLUMN "figure_dims";
-- (기존 데이터를 한 바이트도 안 건드리는 순수 추가다. 기본값이 카탈로그에 저장되므로
--  47,152행을 다시 쓰지 않는다 — PostgreSQL 11+.)
ALTER TABLE "problem"
  ADD COLUMN "figure_dims" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];
