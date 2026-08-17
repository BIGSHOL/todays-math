# 트랙 F 2차 인계 산출물 (트랙 G 소단원 판정분 · A안)

`scripts/qa/reports/` 는 gitignore 라 다른 트랙이 못 본다. 인계가 필요한 것만 여기 복사한다.
전부 `npx tsx scripts/qa/load2-dedupe-check.ts && npx tsx scripts/qa/load2-dry-run.ts` 로 재생성된다.

| 파일 | 받는 곳 | 내용 |
|---|---|---|
| `README-추정배정분.md` | **코디네이터 · 원장님** | ⚠️ 이 4,513행은 소단원을 **추정으로** 붙였다. 조회 명령 포함 |
| `load2-external-ids.json` | **코디네이터 · 되돌리기** | 넣을 `externalId` 4,513개 + **입력 corpus 지문** + **문항별 배정 단원·확신**. **적재 전에 커밋한다** — INSERT 는 백업이 아니라 이 목록이 되돌리는 수단이다(조건 1) |
| `load2-figure-handoff.json` | **트랙 A** | 편 → 문항번호 → 그림 장수. 1,021행 / 346편 / 1,120장. `출제보류_우선` 21행부터 봐 달라 |
| `load2-exclusions.json` | 코디네이터 | 행 단위 중복 19 + 안 뺀 것(다른 학교 8짝 · 후보끼리 49묶음) |
| `load2-dedupe-check.json` | 코디네이터 | 전량 대조 결과 (열쇠 다섯) |
| `load2-dry-run.json` | 코디네이터 | 분포 |

적재할 행 전량(`load2-rows.json`, 약 4.2MB)은 커밋하지 않는다 — 원장 §4-4.
본문은 `externalId` 로 트랙 D `hwp-latex/` 에서 언제든 다시 만들 수 있다.

## 1차와 무엇이 다른가

| | 1차 (`load-*.ts`) | 2차 (`load2-*.ts`) |
|---|---|---|
| 대상 | 시험지가 **소단원명을 적어 준** 문항 | 시험지가 **아무것도 안 적어 준** 문항 |
| `unitId` | `mapUnitHint(topic)` (실측 96.3%) | **트랙 G 판정**(A안, 실측 90%) |
| 중복 판정 | **편** 단위 한글서명 겹침률 | **행** 단위 훼손내성열쇠 + 같은 학교 |
| 넣은 행 | 6,042 | **4,513 (2026-08-17 적재 완료)** |

위생 규칙(`sanitizeContent`·`contentDefect`)은 **1차 파일을 그대로 부른다.** 베끼지 않았다 —
베끼면 판정이 갈라져 재현이 재현이 아니게 된다.

## ⚠️ 이 행들은 «추정으로 붙인 단원» 이다

`Problem` 에 "추정" 을 적을 칸이 없다. **`load2-external-ids.json` 이 유일한 기록이다.**
나중에 그 시험지의 소단원이 적힌 판본이 나오면 그쪽이 이긴다(힌트 기반 96.3% > 판정 90%).
되돌리거나 덮어쓸 때 이 파일의 `판정[]`(externalId → unitId · confidence · 학년)을 쓴다.

## 입력 corpus 지문

`load2-external-ids.json` 의 `입력corpus.fingerprint` 가 그 목록을 만든 트랙 D 산출물의
내용 해시다. 2026-08-17 기준 `346b5894c606b4c9` — **1차 적재분과 같은 추출본이다.**
트랙 D 가 `hwp-latex/` 를 다시 쓰면 지문이 달라지고 `load2-apply.ts` 가 멈춘다(설계다).
