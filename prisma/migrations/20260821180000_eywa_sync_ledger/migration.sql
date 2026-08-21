-- eywa 동기화 되돌리기 원장 (2026-08-21): 서버(「지금 가져오기」)는 파일을 못 쓴다.
CREATE TABLE "eywa_sync_ledger" (
    "id" UUID NOT NULL,
    "run_id" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    CONSTRAINT "eywa_sync_ledger_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "eywa_sync_ledger_created_at_idx" ON "eywa_sync_ledger"("created_at");
