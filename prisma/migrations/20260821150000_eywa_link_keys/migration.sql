-- eywa 진도 연계 매칭 키 (2026-08-21).
-- 이름 매칭 금지 — eywa uuid 가 유일한 열쇠다(동명이인 fan-out 방지, eywa 선례).
-- 둘 다 NULL 허용 + unique: 연계 밖 학생/반(수동·demo)은 NULL 로 공존한다.
ALTER TABLE "student" ADD COLUMN "eywa_student_id" UUID;
ALTER TABLE "class"   ADD COLUMN "eywa_class_id"   UUID;
CREATE UNIQUE INDEX "student_eywa_student_id_key" ON "student"("eywa_student_id");
CREATE UNIQUE INDEX "class_eywa_class_id_key"     ON "class"("eywa_class_id");
