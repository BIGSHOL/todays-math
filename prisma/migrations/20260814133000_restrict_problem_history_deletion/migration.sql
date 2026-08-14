-- TEST / TEST_PROBLEM은 출제 후 2년 보존 대상이다. 문제은행 문항 삭제가 연결 행을
-- cascade-delete해 확정·인쇄 이력을 훼손하지 못하도록 DB에서 직접 차단한다.
ALTER TABLE "test_problem"
DROP CONSTRAINT "test_problem_problem_id_fkey";

ALTER TABLE "test_problem"
ADD CONSTRAINT "test_problem_problem_id_fkey"
FOREIGN KEY ("problem_id") REFERENCES "problem"("id")
ON DELETE RESTRICT ON UPDATE CASCADE;
