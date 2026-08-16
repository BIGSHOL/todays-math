# 트랙 F 인계 산출물

`scripts/qa/reports/` 는 gitignore 라 다른 트랙이 못 본다. 인계가 필요한 것만 여기 복사한다.
전부 `npx tsx scripts/qa/load-dedupe-check.ts && npx tsx scripts/qa/load-dry-run.ts` 로 재생성된다.

| 파일 | 받는 곳 | 내용 |
|---|---|---|
| `load-figure-handoff.json` | **트랙 A** | 편 → 문항번호 → 그림 장수. 1,010행 / 297편 / 1,176장 |
| `load-exclusions.json` | 코디네이터 | 편 단위 중복 4편 + 본문 결함 편별 행수 |
| `load-dedupe-check.json` | 코디네이터 | F-2 전량 대조 결과 |
| `load-dry-run.json` | 코디네이터 | F-3 분포 |

적재할 행 전량(`load-rows.json`, 6.4MB)은 커밋하지 않는다 — 원장 §4-4.
