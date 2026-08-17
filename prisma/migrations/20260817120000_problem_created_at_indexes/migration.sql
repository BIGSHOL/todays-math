-- 문제은행 목록 정렬 인덱스 3종 — GET /api/problems 의 Seq Scan + Sort 제거.
--
-- 근거(성능 감사 2026-08-17):
--   src/app/api/problems/route.ts GET 은 `orderBy [createdAt desc, id desc]` 로 읽고
--   **같은 where 로 count 를 한 번 더** 돈다. `created_at` 을 선두로 갖는 인덱스가
--   기존 마이그레이션 전수(14개)에 **하나도 없어**, 필터 없는 기본 진입(문제은행 1페이지)이
--   problem 47,152행 전체를 훑고 정렬까지 두 번 했다.
--
-- 정렬 방향을 인덱스에 그대로 심는다(DESC, DESC). 방향이 어긋나면 Postgres 가 역방향
-- 스캔은 해도 `(created_at DESC, id DESC)` 복합 정렬은 못 없앤다.
-- `id DESC` 를 빼지 말 것 — 이관 배치는 created_at 이 같은 행이 수천 건이라 보조 키가
-- 없으면 페이지가 겹친다(S-08 에서 실제로 고친 결함).
--
-- 추가 전용이다. 컬럼·제약·데이터를 건드리지 않으므로 기존 행에 영향이 없다.
-- ⚠️ 수기 헤더 + 스키마 @@index 대응 CREATE INDEX. 공유 Supabase 에는 적용하지 않았다
--    (로컬 docker Postgres 부재로 이 워크트리에서는 `prisma validate` 까지만 확인).

-- CreateIndex
CREATE INDEX "problem_created_at_id_idx" ON "problem"("created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "problem_unit_id_created_at_id_idx" ON "problem"("unit_id", "created_at" DESC, "id" DESC);

-- CreateIndex
CREATE INDEX "problem_review_status_created_at_idx" ON "problem"("review_status", "created_at" DESC);
