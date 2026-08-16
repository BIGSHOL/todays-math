# 트랙 B 인계 — 정답 (2026-08-16)

**이 문서 하나로 이어받을 수 있게 쓴다.** 무엇을 바꿨고, 어떻게 되돌리고,
안 한 것이 왜 안 됐는지가 전부다. 상세 근거는 `track-b-report.md`.

---

## 0. 한 줄

정답 **726건을 6단계로 나눠 고쳤고**, 값 판단이 필요한 **312건은 손대지 않고**
원장님 확인 목록(`docs/planning/14-answer-conflicts-review.md`)으로 넘겼다.

---

## 1. 바꾼 것 — 6단계 726건

단계마다 **되돌리기 목록을 따로** 남겼다. 섞으면 되돌릴 때 못 가른다
(트랙 C 가 1차·2차를 한 파일에 섞었다가 겪은 일이다).
`scripts/qa/reports/` 는 gitignore 라 목록만 `scripts/qa/applied/` 에 **커밋**했다.

| 단계 | 무엇 | 건수 | 도구 | 되돌리기 목록 |
|---|---|---|---|---|
| 1 | PUA 원문자 복구 (`U+F08x` → `①~⑤`) | **96** | `repair-answer-glyphs.ts` | `applied/phase1-glyph.json` |
| 2 | 깨진 표기를 공식 정답면 값으로 | **25** | `repair-answer-render.ts` | `applied/phase2-render.json` |
| 3 | 구조 근거 교정 (복수정답 15 · 우리일부만 20) | **35** | `apply-official-answers.ts` | `applied/phase3-structural.json` |
| 4 | RPM 원본 정답 채우기 | **209** | 트랙 C `recover-rpm-answers.ts` | `applied/phase4-rpm.json` |
| 5 | `$` 밖 `\degree` → `°` | **259** | `repair-bare-degree.ts` | `applied/phase5-bare-latex.json` |
| 6 | `$` 밖 수식을 `$…$` 로 감싸기 | **102** | `wrap-bare-math.ts` | `applied/phase6-wrap-math.json` |

전 단계 **건너뜀 0**. 도구마다 update 직전에 「현재 값이 우리가 본 값 그대로인지」를
다시 확인한다 — 공유 DB 를 여러 트랙이 같이 쓰기 때문이다.

**쓴 컬럼은 `answer` 하나뿐이다.** 트랙 C 의 도구도 그렇다(465~468행 확인).
같은 테이블의 `content` 가 바뀌어 있으면 트랙 D, 행이 늘어 있으면 트랙 F 다.

### 되돌리는 법

목록은 `{id, externalId, before, after}` 배열이다. 한 단계만 되돌리려면
그 파일의 `before` 로 `answer` 를 되쓰면 된다. `after` 와 현재 값이 다르면
그 사이 누가 또 바꾼 것이니 멈추고 확인할 것.

### 4단계만 방식이 다르다

`recover-rpm-answers.ts` 는 **트랙 C 소유라 고치지 않았다**(트랙 규칙 9).
그 도구는 되돌리기 목록을 안 남기므로, `answer` 가 우리 소관인 점을 이용해
적용 **전후로 값을 찍어** 실제 바뀐 행만 뽑았다 — `snapshot-answers.ts`.

```bash
npx tsx scripts/qa/snapshot-answers.ts --tag <단계> --source transformed --missing-only --before
# … 남의 도구 실행 …
npx tsx scripts/qa/snapshot-answers.ts --tag <단계> --source transformed --missing-only --after
```

---

## 2. 효과

| | 착수 | 지금 |
|---|---|---|
| 공식 정답과 **일치** | 19,544 | **19,779** |
| 지면에 깨져 나갈 정답 | 172 | **28** |
| DB 잔여 PUA 원문자 | 98 | **2** (되돌릴 표가 없는 `U+E287`) |
| `$` 밖 LaTeX 명령 보유 | 388 | **28** |
| `transformed` 정답 없음 | 280 | **71** |

> ⚠️ 문항 총수는 세션 중 36,597 → 42,639 로 늘었다. **트랙 F 의 신규 적재**다
> (시험지 300편 6,042행). 집계가 이유 없이 바뀌면 남의 트랙을 먼저 의심할 것.

---

## 3. 안 한 것 — 왜 남아 있나

### 3.1 값이다름 148 · 소문항불일치 95 — **근거가 부족하다**

「진짜오답」은 *DB 와 공식이 다르다*는 뜻이지 *DB 가 틀렸다*는 뜻이 아니다.
표본 26건을 **원본 정답면을 렌더해 눈으로** 대조했더니
**14건만 진짜 오답이고 12건은 규칙이 못 걷은 표기 차이**였다.

그 12건에서 규칙 6개를 새로 얻어 넣어 「값이다름」을 232 → 148 로 줄였지만,
**남은 148건에도 표기 차이가 섞여 있다.** 값을 덮으면 맞는 답을 틀리게 바꾼다.

→ 이어받는 사람이 할 일: 표본을 더 떠서 규칙을 더 얻거나, 사람이 전수로 본다.
지면을 오려 보는 도구가 있다 — `python scripts/qa/shot-official-answer.py <examId>-<번호>`.

### 3.2 빈 정답 86 — **표기 정책이 먼저다**

공식 정답면에 값이 있는데 DB 가 비어 있다. 그대로 넣으면 안 되는 것이 섞여 있다:

- 근호 가로선 잔재 `√⁄5` → `√5` 로 되돌릴 수 있다
- **위첨자 소실 `e15`(=e¹⁵) `a2+b2` — 그대로 인쇄하면 틀린 값이다.** 보류 중
- `(서술형)` 처럼 값이 아닌 것

`apply-official-answers.ts` 가 「글자 뒤에 숫자」 낌새를 보류로 잡아낸다.
§4 의 표기 정책이 정해지면 그때 채운다.

### 3.3 정답 없는 532건 — **원본에 답이 없다**

이관 결함이 아니다. 정답 없는 기출 178건 중 **149건은 HWP 시험지도 뽑혔고
그 번호도 있는데 `answer` 필드가 전부 비어 있다.** RPM 280건도 원본에서 회수 불가
(`recover-rpm-answers.ts` 드라이런 기준).

→ 다만 **178건 중 148건에 HWP `solution`(해설)이 있다.** 서술형·증명의
「해설참조」를 대체할 후보다. 해설 전문을 `answer` 에 넣으면 학생 시험지에
그대로 인쇄되므로 **넣는 방식은 제품 결정**이다.

### 3.4 지면 표기 결정 대기

| 항목 | 건수 | 문서 |
|---|---|---|
| 값이 갈린 수치 정답 (기출) | 29 | `14-answer-conflicts-review.md` §1 |
| 번호 충돌 (RPM) | 3 | 〃 §2 |
| 한글 섞인 수식 | 10 | 〃 §3 |
| 훼손돼 답으로 안 읽히는 값 | 18 | 〃 §4 |

**D-50 (복수정답 `③, ④`) 은 확정됐지만 인쇄 항목이라
완료 조건이 실물 프린터 출력 검수다(CLAUDE.md 6번) — 「원장님 실물 검수 대기」.**

---

## 4. 도구 지도

| 파일 | 하는 일 | DB |
|---|---|---|
| `answer-notation.ts` | 표기 정규화 규칙 한곳 (분류·교정이 공유) | — |
| `classify-answer-mismatch.ts` | 불일치를 표기차이/진짜오답/판정불가로 분류 | 안 씀 |
| `audit-answers-vs-official.ts` | DB ↔ 공식 정답면 대조 (기존 도구) | 안 씀 |
| `audit-answer-render.ts` | 정답이 지면에 깨져 나가는지 전수 검사 | 안 씀 |
| `audit-bare-latex.ts` | `$` 밖 LaTeX 명령 전수 조사 | 안 씀 |
| `classify-missing-answers.ts` | 정답 없는 문항을 회수 가능성으로 분류 | 안 씀 |
| `list-numeric-conflicts.ts` | 원장님 확인 목록(문서 14) 생성 | 안 씀 |
| `repair-answer-glyphs.ts` · `repair-answer-render.ts` · `apply-official-answers.ts` · `repair-bare-degree.ts` · `wrap-bare-math.ts` | 1·2·3·5·6단계 적용 | 드라이런 기본 |
| `snapshot-answers.ts` | 남의 도구 적용 전후를 찍어 되돌리기 목록 생성 | 안 씀 |
| `shot-official-answer.py` | **정답면의 그 줄만 오려 눈으로 확인** | — |
| `extract-official-answers.py` | 공식 정답면 추출 (고침: 소문항 파싱 · 정답면 판정 · `--reparse`) | — |
| `extract-hwp-answers.py` | 필요한 편만 HWP 정답 추출 | — |

재생성이 필요한 산출물(gitignore):

```bash
npx tsx scripts/qa/audit-answers-vs-official.ts     # 대조표
npx tsx scripts/qa/classify-answer-mismatch.ts      # 분류
npx tsx scripts/qa/list-numeric-conflicts.ts        # 문서 14
```

`official-answers/` 는 2,243편 분량이라 다시 뽑으면 오래 걸린다. PDF 를 다시 열지 않고
파서만 다시 돌리려면 `python scripts/qa/extract-official-answers.py --reparse`.

---

## 5. 이어받는 사람이 밟을 함정

- **heredoc 이 정규식의 역슬래시를 먹는다.** `/\\[a-zA-Z]+/` 가 `/\[a-zA-Z]+/` 가 되어
  **0건이 나온다 — 문제가 없는 것처럼 보인다.** 실제로 "렌더 실패 0" 이라고 잘못
  보고했다. 정규식을 고쳤으면 `ascii()` 로 파일을 확인할 것.
- **`canon()` 의 NFKC 가 원문자를 숫자로 바꾼다.** `③, ④` → `34`. 개수를 세거나
  수치를 판별할 때 `canon` 위에서 하면 복수정답이 「수치 충돌」로 섞인다(실측 15건).
  원문자는 `circledSet()` 으로 본다.
- **감싸는 것과 고치는 것은 다르다.** 훼손된 값을 `$…$` 로 감싸면 렌더는 통과하지만
  「깨지지 않은 틀린 답」이 된다. 더 나쁘다.
- **HWP 는 독립 출처가 아니다 — DB 정답의 출처다.** 3자 대조는 성립하지 않는다
  (DB 와 HWP 가 84건 전부 글자까지 같았다). 독립 출처는 완료본 PDF 정답면뿐이다.
- **문서 번호·Decision Log 번호는 붙이기 전에 등록부를 볼 것.** D-46 이 겹쳐
  내 항목을 D-50 으로 옮겼다. 트랙 글자도 같은 사고가 두 번 났다.
- **externalId 형식을 가정하지 말 것.** 트랙 C 가 RPM 행에 sumaek UUID 를 채운다.
  `source` 로 먼저 거른 뒤 파싱한다.

---

## 6. 검증

`npm run type-check` · `npm run lint`(기존 경고 1) · `npm test` 662건 통과.
회귀 테스트는 `src/__tests__/unit/answerNotation.test.ts` 50건 —
픽스처가 전부 실제 DB·실제 정답면에서 온 짝이고, 「진짜 오답」 14건은 지면을
렌더해 확인한 것이다. 합성 픽스처가 이관 결함을 통과시킨 전례 때문이다.
