# 트랙 F 인계 산출물

`scripts/qa/reports/` 는 gitignore 라 다른 트랙이 못 본다. 인계가 필요한 것만 여기 복사한다.
전부 `npx tsx scripts/qa/load-dedupe-check.ts && npx tsx scripts/qa/load-dry-run.ts` 로 재생성된다.

| 파일 | 받는 곳 | 내용 |
|---|---|---|
| `load-external-ids.json` | **코디네이터 · 되돌리기** | 넣은 `externalId` 6,042개 + 입력 corpus 지문. **적재 전에 커밋한다** — INSERT 는 백업이 아니라 이 목록이 되돌리는 수단이다(승인 조건 1·5) |
| `load-figure-handoff.json` | **트랙 A** | 편 → 문항번호 → 그림 장수. 1,059행 / 306편 / 1,240장. `출제보류_우선` 7행부터 봐 달라 |
| `load-exclusions.json` | 코디네이터 | 편 단위 중복 4편 + 본문 결함 편별 행수 |
| `load-dedupe-check.json` | 코디네이터 | F-2 전량 대조 결과 |
| `load-dry-run.json` | 코디네이터 | F-3 분포 |

적재할 행 전량(`load-rows.json`, 약 6.6MB)은 커밋하지 않는다 — 원장 §4-4.
본문은 `externalId` 로 트랙 D `hwp-latex/` 에서 언제든 다시 만들 수 있다.

## 입력 corpus 지문

`load-external-ids.json` 의 `입력corpus.fingerprint` 가 그 목록을 만든 트랙 D 산출물의
내용 해시다. **적재분이 어느 추출본에서 나왔는지는 이 값으로 답한다.**
2026-08-16 적재분은 `346b5894c606b4c9` (3,302편 46MB, 트랙 D 10:00 재추출본).
