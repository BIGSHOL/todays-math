# T3.0 후반 — dry-run / 적재 리포트

생성 시각: 2026-08-13T16:41:58.829Z

## DB 대상

- 선택 소스: `none`
- 선택 대상: **missing** — DATABASE_URL이 없습니다.
- 프로세스 env: missing
- worktree `.env`: missing
- 메인 저장소 `.env`(참고, 사용 안 함): supabase — 공유 Supabase — 프로덕션이라 적재 안 함
- migrate/적재: 안 함 — DATABASE_URL이 없습니다. / 메인 .env는 공유 Supabase — 프로덕션이라 적재 안 함

## 기출 OCR

- 시험지 415부 / 파싱 실패 0
- total 9173 / ok 3569 / unclassified 4618 / figure 986
- 리포트: `scripts/import/reports/ocr-report.json`

## 자작 시드

- total 1318 / ok 758 / unclassified 560 / figure 0
- 원본 `F:\\math_test` 수정 없음

## RPM (sumaek, SELECT만)

- 추출 6151건 / ok 4862 / unclassified 1289 / figure 0 / 전량 잠금 true
- 문서상 5,035건보다 많을 수 있음 (`source_ref IS NOT NULL` 전량)

## 리포트 파일

- `scripts/import/reports/T30-LOAD-REPORT.md`
- `scripts/import/reports/t30-summary.json`
- `scripts/import/reports/ocr-report.json` / `ocr-unclassified.json` / `ocr-figures.json`
- `scripts/import/reports/manual-report.json` / `manual-unclassified.json`
- `scripts/import/reports/rpm-report.json` / `rpm-unclassified.json` / `rpm-extract.json`
- `scripts/import/reports/load-result.json`

## 금지 사항 준수

- UI/인쇄/T5 파일 변경 없음
- 원본 저장소 무변경
- 프로덕션 INSERT 없음
- main 병합/push 없음

