# 잔여 과제 병렬 트랙 (2026-08-16 착수)

A단계·B단계가 끝난 뒤 남은 것을 **파일 소유권과 DB 컬럼이 겹치지 않게** 갈랐다.
트랙끼리 서로를 기다리지 않는다.

| 트랙 | 주제 | 소유 파일 | 쓰는 DB 컬럼 |
|------|------|-----------|--------------|
| [A](track-a-figures.md) | 그림 연결·정밀도 | `scripts/figure/**`, `recover-rpm-figures.ts` | `figureUrls` `figureSource` |
| [B](track-b-answers.md) | 정답 대조·잔여 | `extract-official-answers.py`, `audit-answers-vs-official.ts` | `answer` |
| [C](track-c-rpm.md) | RPM 역추적·중복 | `convertRpm.ts`, `extract-rpm.ts`, `recover-rpm-answers.ts` | `externalId` |
| [D](track-d-hwp.md) | 본문 HWP 재추출 | `scripts/qa/hwp*`, `build-discard-list.ts` | `content` |
| [E](track-e-todays-exam.md) | **'오늘의 시험'** 예측기 | `src/lib/predictor/**`, `scripts/predictor/**`, `src/lib/schools/**` | **새 테이블** + `Student.school*` · `Problem.questionType` |
| [F](track-f-newload.md) | 신규 적재 (편 단위 결손) | `scripts/qa/load-*`, 적재기 | **신규 행 INSERT 전용** (기존 행 UPDATE 금지) |
| [G](track-g-classify.md) | 소단원 분류 기준 | `src/lib/classify/**`, `scripts/classify/**` | **없음 — DB 를 쓰지 않는다.** 판정 파일만 낸다 |
| **F2** | [G 판정 적재](track-f2-report.md) (2차) | `scripts/qa/load2-*` | **신규 행 INSERT 전용** (F 와 같은 규칙) |

## 트랙 글자·문서 번호를 새로 붙일 때

⚠️ **먼저 `ls docs/planning/tracks/` 와 `ls docs/planning/` 을 확인하고, 원장님께 알린 뒤 정한다.**
오르카 다중 세션이 동시에 만들면 겹친다 — 2026-08-16 에 실제로 두 번 겹쳤다
(문서 11번이 둘, 트랙 D가 둘, 트랙 E가 둘 — 세 번이다). 겹치면 **참조가 적은 쪽 / 아직 push 안 한 쪽**을 옮긴다.
스크립트가 생성하는 문서는 그 스크립트의 출력 경로 상수도 같이 고친다.

## 공통 규칙 (셋 다 지킨다)

1. **읽기 전 필독**: `CLAUDE.md`, `docs/planning/10-handoff.md`, `08-import-ledger.md`,
   `07-coding-convention.md` Decision Log (특히 D-31 공용 풀, D-37 완료본만).
2. **공유 DB 쓰기는 기본 차단**. dry-run 이 기본이고 `--apply` + `ALLOW_SHARED_IMPORT=1`
   둘 다 있을 때만 쓴다. 게이트를 네트워크·DB 접근 **앞**에 둔다.
3. **원본 저장소는 읽기 전용**: `F:\시험지변환기`(testchanger), `C:\Creative\sumaek`,
   `C:\Creative\eywa`, N드라이브. 한 바이트도 쓰지 마라.
4. **문항 본문을 보고에 대량으로 싣지 마라.** 숫자 요약과 표본 2~3건이면 된다.
5. **Windows JSON**: PowerShell `Out-File`/리다이렉트로 JSON 을 쓰면 BOM·이스케이프로
   깨진다. 스크립트가 파일을 직접 쓰게 할 것.
6. 임시 스크립트는 `scripts/qa/_*` 에 둔다 (gitignore 됨). 커밋할 도구는 이름을 제대로 짓는다.
7. 마치기 전 `npm run type-check` · `npm test` · `npm run lint`.
8. **커밋은 자기 브랜치에만.** main 병합은 코디네이터가 한다.
9. 남의 트랙 파일을 고치지 마라. 필요하면 보고서에 적어 코디네이터에게 넘겨라.

## 지난 회차에서 실제로 낸 사고 — 되풀이 금지

- **합성 픽스처가 이관 결함을 통과시켰다.** `convertRpm` 이 원본 키 `choiceId` 를 `id` 로
  읽어 객관식 정답 4,862건이 통째로 비었는데, 내가 만든 픽스처는 `id` 를 써서 테스트가
  초록이었다. **이관 변환기는 반드시 실데이터로 검증하고, 검증은 고친 사람이 아닌 쪽에 맡겨라.**
- **라벨을 믿고 2,730건을 버릴 뻔했다.** `problemType='서술형'` 의 95% 가 실제로는
  `[서술형 N]` 배점 머리표였다. 라벨은 표본으로 확인하기 전엔 근거가 아니다.
- **가드를 정확히 거꾸로 걸었다.** "한 시험지에 어긋남이 몰리면 추출 결함" 이라는 가드를
  넣었는데, 몰린 48건이 전부 진짜 DB 오답이었고 안 몰린 2건이 내 추출 버그였다.
  **몰림은 조사 단서일 뿐 배제 근거가 아니다.**
- **AI 로 푸는 것보다 원본에서 되찾는 게 늘 나았다.** 여섯 결함 전부 이관 단계 유실이었다.
  **AI 를 돌리기 전에 이관 코드를 먼저 의심하라.** 토큰 0 에 정확도가 높다.

---

## 저장소 밖 산출물은 `C:/Creative/testautocreator-data/` 에 있다

`scripts/qa/reports/` 는 **gitignore 대상**이라 main 병합으로 따라가지 않는다.
그래서 트랙 워크트리를 지우기 전에 **저장소 밖 고정 위치로 옮겨 두었다**
(2026-08-17). 워크트리는 지웠고 산출물은 남아 있다.

```
C:/Creative/testautocreator-data/
  D-HWP/qa-reports/          1.9G   ← 대부분이 여기다
    hwpx/                    1.8G   3,302편. 다시 뽑으면 약 10.5시간
    hwp-latex/                51M   3,302편. 수식이 LaTeX 로 변환된 판
    hwp/                      49M   원본 추출본
    db-content.jsonl          22M   DB 스냅숏 (몇 분이면 다시 뜬다)
  G-소단원분류/               57M   분류 학습·평가 데이터
  B-정답/                     26M   공식 정답면 추출본
  E-신규적재/                 25M   적재 대조본
  A-그림/                     15M   그림 색인
  C-RPM/                      11M   RPM 대조본
```

**되살릴 수 없는 것은 `hwpx/` 하나뿐이다.** 나머지는 거기서 다시 만들거나
(hwp-latex) DB 에서 몇 분이면 다시 뜬다(db-content.jsonl).

### 중요한 기록은 이미 git 에 있다

부피 때문에 밖으로 뺀 것은 **중간 산출물**이고, 되짚는 데 필요한 **기록**은
저장소 안에 있다. 산출물 폴더가 사라져도 아래는 남는다.

| 파일 | 무엇 |
|---|---|
| `scripts/classify/reports/unit-predictions.jsonl` | 트랙 G 의 소단원 판정 4,566건 (근거·확신 포함) |
| `scripts/qa/handoff/load2-external-ids.json` | **추정 배정분 4,513행** — 소단원을 통계로 붙인 행 목록 |
| `scripts/qa/handoff/` 전체 18개 | 트랙 간 인계 산출물 |
| `scripts/qa/rpm-external-id-solution-batch.json` 류 | 되돌리기 목록 |

### 다시 쓸 때

스크립트는 `scripts/qa/reports/` 상대경로를 본다. 산출물이 필요하면 그 경로로
디렉터리 링크를 걸거나 복사해서 쓴다.

```bash
# 예: D 산출물을 새 워크트리에서 쓰기 (관리자 명령 프롬프트)
mklink /J scripts\qaeports C:\Creative	estautocreator-data\D-HWP\qa-reports
```

`hwp-latex/` 를 다시 뽑아야 한다면 그 전에 적재 담당에게 알려라 — 적재기가 입력
corpus 지문을 기록해 두어서, 지문이 달라지면 멈춘다(그게 설계다).
