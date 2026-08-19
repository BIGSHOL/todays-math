# 원문자 목록을 **한 곳**으로 — 무엇을 고쳤고 무엇을 안 고쳤나

2026-08-19 · 원장님 지시 「나머지 열두 벌도 같은 방식으로 고쳐」

> 다시 만들기:
> ```
> npx tsx scripts/qa/census-circled-glyphs.ts --samples   # 발견기 (분모 47,152건)
> npx tsx scripts/qa/emit-circled-glyphs.ts               # JSON 산출 (Python·mjs 용)
> bash  scripts/qa/mutate-circled-glyphs.sh               # 가드를 망가뜨려 본다
> npx vitest run src/__tests__/unit/circledNumber.test.ts \
>                src/__tests__/unit/circledGlyphsJson.test.ts \
>                src/__tests__/unit/regexTemplateEscape.test.ts
> ```

---

## 0. 「같은 방식」이 무엇이었나

1. **무엇이 원문자인지 미리 정하지 않는 발견기**로 실제 건수를 센다.
2. 계열은 **계산**한다 — 시작 코드포인트만 적는다.
3. 목록은 **한 곳**에 두고, 자리마다 **이름으로** 어느 목록을 쓰는지 드러낸다.
4. 가드를 **망가뜨려 본다.**
5. 🔴 **넓히면 안 되는 자리는 세어서 밝히고 안 넓힌다.**

**5번이 이 회차의 핵심이다.** 열두 벌을 전부 넓혔으면 제품이 깨졌다.

---

## 1. 실측 — 분모 47,152건 (`census-circled-glyphs.ts`)

| 계열 | answer | content | solution |
| --- | ---: | ---: | ---: |
| `①` 원문자 (U+2460) | 34,290 | 1,638 | 626 |
| **`➀` 산세리프 (U+2780)** | **43** | 2 | 2 |
| `❶` 검은 (U+2776) | 1 | 4 | 4 |
| `➊` 검은산세 (U+278A) | 0 | 5 | 0 |
| `⓵` 겹원 · `㉑` · `㊱` | 0 | 0 | 0 |

**손 목록(`①..⑮`) 밖 = 58행.**

### 1.1 그 58행이 다 «정답»은 아니었다 — 전량 육안

`answer` 44행의 모양을 전부 봤다:

| | 건수 | 무엇 |
| --- | ---: | --- |
| 값 전체가 원문자 = **진짜 정답 번호** | **43** | 전부 `➀`~`➄` |
| 문장 속 원문자 = **단계 표시** | 1 | `ad7dca98` — `❶ 컴퍼스, 반지름의 길이 AB, …` |

`content` 쪽 비표준 11행 중 **줄머리에 온 6행은 전부 보기가 아니었다**:

- `352f8aac`·`65fa779b` — `<규칙>` 아래 `➊ 두 눈의 수의 …` (**규칙 항목**)
- `ad7dca98`·`e303ddb0` — `❶로 AB 의 길이를 잰다` (**작도 순서**)
- `d40ade78` — `직선 ➀은 떡볶이를 …` (**그래프 라벨**)
- `4db67fe7` — `<조건>` 안 항목

**그래서 본문 마커는 안 넓혔다.** 넓혔으면 이것들이 보기로 잘려 나간다.

---

## 2. 목록이 셋이다 — **이름으로 갈린다**

`src/lib/math/circledNumber.ts` 한 곳.

| 이름 | 범위 | 쓰는 자리 | 왜 |
| --- | --- | --- | --- |
| `ANSWER_CIRCLED_CLASS` | **7계열 90자** | 정답 판독 | 비표준 43행이 진짜 정답 번호 |
| `BODY_CHOICE_MARKS` | `①..⑮` | 본문 보기 마커 | 넓히면 «규칙»·작도 순서가 보기로 잘린다 |
| `CHOICE_MARKS` | `①..⑩` | 지면에 찍는 글자 | 출력이라 계열 문제가 없다 |

Python·`.mjs` 는 TS 를 못 읽으므로 `scripts/qa/circled-glyphs.json` 을 **생성해서 커밋**하고
그 파일 하나를 읽는다(`build-hwp-vocab.py` 와 같은 방식). 커밋된 산출물은 낡으므로
`circledGlyphsJson.test.ts` 가 모듈과 어긋나면 **빨개진다.**

---

## 3. 고친 자리 (17)

**정답 판독 — 넓혔다 (9):** `answer-notation.ts` · `answerChoiceRules.ts` ·
`audit-answers-vs-official.ts` · `load-answer-backfill.ts` · `classify-answer-mismatch.ts`(3곳) ·
`recover-rpm-answers.ts` · `restore-choice-markers.ts` · `verify-convert-rpm.ts` ·
`apply-choice-figure-discard.ts` · `report-figref-layout.ts` · `measure-figref-layout.tsx` ·
`judge-hwp-replacement.ts` · `extract-official-answers.py`(3곳) · `crop-pdf-by-stem.py` ·
`crop-rpm-from-pdf.py`

**본문 마커 — 좁게 두되 한 곳에서 (6):** `parseProblemContent.ts`(**제품**) ·
`renderMathHtml.ts` · `convertRpm.ts` · `choiceFigureRules.ts` · `figrefRuler.ts` ·
`simulate-choice-repairs.ts` · `answerChoiceRules.ts` · `ocr-audit.mjs` ·
`check-pilot-rows.mjs` · `choice_figure_recover.py`

**지면 마커 (2):** `ProblemContent.tsx`(**제품**) · `figrefLayout.tsx`

> `ocr-audit.mjs` 는 `①..⑩` 만 봐서 **제품보다 좁았다.** 제품과 맞추면 판정이 바뀌므로
> `CHECKSET_VERSION` 을 2로 올렸다 — 원장이 자동 무효화돼 전수 재검사한다.

---

## 4. 🔴 **안 고친 자리 — 이유와 함께**

| 자리 | 왜 안 고쳤나 |
| --- | --- |
| `⑴-⒇` 소문항 마커 (`audit-box-boundary.ts` · `audit-subquestion-rule.ts` · `hwpJudgeRules.ts` · `measure-subquestions.ts` · `convertPastExam.ts` · `boxBlock.ts` · `subQuestion.ts` · `extract-official-answers.py:134`) | **다른 계열이다.** 괄호 원문자는 «보기 번호»가 아니라 «소문항»을 뜻한다. 같이 묶으면 뜻이 섞인다 — 필요하면 **별도 정리**가 맞다 |
| `ⒶⒷⒸⒹⒺ` (`boxBlock.ts:146`) | 둘러싼 **라틴 문자** — 또 다른 계열 |
| `RESIDUE`·`KEEPABLE` 문자 허용 목록 (`plan-rpm-*.py` · `score-rpm-latex.py`) | **목적이 다르다.** 「이 글자가 본문에 있어도 되는가」이지 「이게 보기 번호인가」가 아니다. 넓히면 잔재 판정이 조용히 느슨해진다 |
| `textPreprocess.ts:1196` | **이식 정본이다.** 파일 머리에 「수작업 재작성 금지 — 회귀 위험이 커서 원본을 복사한 뒤 필요한 보정만 덧붙인다」가 박혀 있다. 게다가 그 자리는 «보기 판정»이 아니라 인용문 **접두 보존**이다 |
| `scripts/vendor/testchanger/hwp_extract.py:15` | **벤더링본은 읽기 전용**(tracks/README §3). 고치면 다음 재벤더링 때 조용히 사라진다 |
| `mutate-choice-figure-*.sh` 안의 리터럴 | 변이 스크립트는 **바꿀 원문을 그대로 들고 있어야** 동작한다 |
| 테스트 픽스처·화면 문구 | 규칙이 아니라 데이터다 |

---

## 5. 가드 — 망가뜨려 봤다

`bash scripts/qa/mutate-circled-glyphs.sh` → **변이 6개 전부 빨강.**

처음에 하나가 초록이었는데 **테스트 구멍이 아니라 코드 중복**이었다 —
`repairGlyphs` 를 두 번 부르고 있었다(글자 단위 치환이라 두 번 불러도 결과가 같다).
중복을 지우니 빨강이 됐다.

### 5.1 🔴 변이 스크립트에도 같은 함정이 있었다

`mutate-answer-choice-rules.sh` 는 **표적을 못 찾아도 「🟢 안 바뀜」으로 셌다.**
계열표를 한 곳으로 옮기자 변이 5개가 표적을 잃었는데 표에는 «초록»으로 보였다 —
「가드가 안 잡았다」와 「시험을 못 했다」가 같은 칸에 들어갔다.

**갈랐다.** 이제 `⛔ 표적 없음` 으로 따로 세고, 하나라도 있으면 **스크립트가 실패한다.**

### 5.1.5 🔴 그리고 그 «표적 없음» 구분이 **스크립트 자체의 고장**을 잡았다

갈라 놓자마자 `mutate-answer-choice-rules.sh` 가 **27개 전부 「표적 없음」**을 냈다.
원인은 가드가 아니라 스크립트였다 — 파이썬 블록의 `
` 이 **진짜 개행**이 되어
문자열 리터럴이 깨져 있었다(이 저장소가 이미 적어 둔 「Python heredoc 이 `
` 을
망가뜨린다」와 같은 자리다). 파이썬이 문법 오류로 죽으니 bash 는 「표적 없음」으로 읽었다.

**갈라 놓지 않았으면 27개가 전부 🟢 초록으로 보였을 것이고**, 「가드가 하나도
안 잡는다」는 잘못된 결론이 나왔을 것이다.

### 5.1.6 🔴 살아남은 변이 하나 — 픽스처가 아니라 **불변식**으로 잠갔다

「본문 보기 마커를 `①..⑤` 로 좁힌다」가 초록이었다. 실데이터를 먼저 셌다 —
분모 47,152건에서 **줄머리 마커가 `⑥`..`⑮` 인 행은 2행**이고 그 둘도 보기가 아니었다
(`<보기>` 상자 · 수식 안). **DB 로는 이 경계를 못 가른다.**

여기서 「⑥ 이 보기인 문항」을 지어내면 없는 데이터를 있다고 말하는 것이다. 대신
**판정기와 제품 파서가 같은 마커를 본다**는 불변식을 잠갔다 — 데이터가 없어도 참이어야
하고, 반증 가능하다. 좁히면 그 검사만 빨개지는 것을 확인했다.

**남는 초록 하나**(「제품 파서와의 본문 대조를 끈다」)는 스크립트 꼬리에 이유가 적혀 있다.

### 5.2 🔴 그리고 정규식 이스케이프가 조용히 죽었다

목록을 한 곳으로 모으며 정규식 열한 개를 문자열 리터럴 → 템플릿 리터럴로 옮겼다.
그때 **`\s` 가 `s` 로 죽었다** — 템플릿 리터럴은 모르는 이스케이프의 백슬래시를 버린다.

**같은 버그가 절반은 침묵했다:**

| 죽은 것 | 결과 | 테스트가 잡았나 |
| --- | --- | :-: |
| `\s` → `s` | `«③, ⑤»` 가 객관식이 아니게 된다 | **잡았다** (2건 빨강) |
| `\n` → 진짜 개행 | 정규식이 개행에 **그대로 매치된다** | ❌ |
| `\t` → 진짜 탭 | `[ \t]` 가 `[ <탭>]` 이 되어 **똑같이 동작** | ❌ |

오늘은 우연히 동작이 같았지만 다음에 `\d`·`\b`·`\w` 를 그렇게 쓰면 조용히 틀린다.
그래서 **동작이 아니라 모양을 검사하는** 가드를 저장소 전수로 걸었다
(`regexTemplateEscape.test.ts`). 안전한 이스케이프(`n t r v f u x`)만 나열하고
**나머지는 막는다** — 위험한 쪽을 나열하면 또 목록이 눈먼다.

---

## 6. 확인한 것 / 안 한 것

**확인**
- 계열별 실제 건수 — 전량 47,152건.
- 손 목록 밖 `answer` 44행 — **전량 육안**, 43 정답 / 1 단계 표시.
- `content` 비표준 11행 — **전량 육안**, 줄머리 6행이 전부 보기 아님.
- 게이트 4종 · 변이 6/6 · JSON 드리프트 가드 · 이스케이프 가드(변이로 빨강 확인).

**안 한 것 (표시해 둔다)**
- `⑴-⒇` 계열은 **손 목록 그대로다.** 같은 정리가 필요하지만 뜻이 달라 별도 건이다.
- `ocr-audit` 재검사를 **돌리지 않았다** — `CHECKSET_VERSION` 만 올렸다. 다음 실행이 전수 재검사한다.
- 넓힌 규칙들을 **실제 데이터에 다시 돌려 보지 않았다.** 판정 결과가 몇 건 달라지는지는
  각 스크립트를 다시 돌려야 나온다(공유 DB 쓰기가 있어 이 회차에서는 안 했다).
