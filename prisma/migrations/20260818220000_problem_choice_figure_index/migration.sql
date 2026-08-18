-- 보기 번호 ↔ 그림 짝 — 「어느 그림이 ①인가」를 담는다.
--
-- 왜 컬럼인가: 오늘 지면에는 `① [그림] ② [그림]` 이라고 찍히고 그래프는 그 위에
-- 따로 쌓인다. **어느 그래프가 ①인지 지면에 없어 학생이 답을 고를 수 없다**(147건).
-- 짝은 원본 시험지에 늘 있었는데(PDF 텍스트 레이어의 ①②③④⑤ 좌표) 이관 파이프라인이
-- 다섯 군데서 버렸다 — 담을 자리가 없어서다.
-- 근거: docs/planning/tracks/reports/choice-figures.md
--
-- 형식: `figure_urls` 와 **같은 순서·같은 길이**의 정수 배열.
--   0      = 보기 그림이 아니다 (발문·자료 그림)
--   1..10  = 그 번호의 보기 그림 (오늘 데이터는 1~5 뿐)
--
-- ⚠️ **빈 배열 = «짝을 모른다»** 이고 그게 기본값이다. 47,152행이 여기서 시작한다.
--    모를 때 지면은 **오늘 그대로** 그린다 — 한 덩어리로 놓고 번호를 안 붙인다.
--    빈 배열이 «아무 그림이나 ①에 붙여도 된다» 로 미끄러지면 안 된다. 지금은
--    못 푸는 문항이 못 푸는 채로 보이지만, **틀린 짝은 그럴듯해 보이면서 틀린다.**
--
-- 판정이 «모른다» 로 받는 경우 — 셋 다 **통째로**, 반쪽은 안 받는다
--   (1) cardinality(choice_figure_index) <> cardinality(figure_urls)
--   (2) 값이 0..10 밖
--   (3) 0 이 아닌 번호가 **겹친다** (그림 둘이 같은 ③을 주장한다)
-- 같은 규칙을 `parseChoiceFigureIndex`(src/lib/problem/choiceFigureIndex.ts) 한 곳이
-- 갖는다. `figure_dims` ↔ `parseFigureDimensions` 와 같은 규약이다.
--
-- 되돌리기: ALTER TABLE "problem" DROP COLUMN "choice_figure_index";
-- (기존 데이터를 한 바이트도 안 건드리는 순수 추가다. 기본값이 카탈로그에 저장되므로
--  47,152행을 다시 쓰지 않는다 — PostgreSQL 11+.)
ALTER TABLE "problem"
  ADD COLUMN "choice_figure_index" INTEGER[] NOT NULL DEFAULT ARRAY[]::INTEGER[];

COMMENT ON COLUMN "problem"."choice_figure_index" IS
  'figure_urls 와 같은 순서·같은 길이. 0=보기 그림 아님(발문), 1..10=그 번호의 보기. '
  '빈 배열=짝을 모른다(기본값) → 지면은 오늘처럼 번호 없이 한 덩어리로 그린다. '
  '길이 불일치·범위 밖·0 아닌 번호 중복이면 통째로 «모른다»로 받는다(반쪽 금지). '
  '규칙 한 곳: src/lib/problem/choiceFigureIndex.ts. 적재: scripts/qa/apply-choice-figure-index.ts';
