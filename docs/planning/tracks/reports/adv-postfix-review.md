# 적대적 리뷰 ② — 후보정·DB 변경 (2026-08-17~18)

- **작업일** 2026-08-18
- **브랜치** `BIGSHOL/adv-postfix` (main 병합 금지)
- **자세** 나는 고친 사람이 아니다. **공유 Supabase 는 읽기만 했다** — 쓰기 명령을
  한 번도 실행하지 않았고 `ALLOW_SHARED_IMPORT` 를 켠 적이 없다. 되돌리기는
  오케스트레이터가 한다.
- **대상** `renderPostfixRules` · `apply-render-postfix` · `apply-math-residue` ·
  `hwpVocab` · `census-math-tokens` · `mathTokenCensus` · `measure-render-defects` ·
  `measure-katex-unknown` · `build-hwp-vocab.py` · `hwpeq_unglue.py` ·
  `measure-hwp-latex-residue.py` · `textPreprocess.collapseBlankBoxPadding` ·
  `docs/planning/tracks/reports/*.json*`
- **재현물** `qa/adversarial/_adv-postfix-label-guard.test.ts` (7건 전부 빨강 — 의도)
  · 감사 스크립트 `scripts/qa/reports/_adv/**` (gitignore, 재현 절차는 §9)
- **품질 게이트** `npm run test` 초록 유지 (92 파일 · 1,369건 통과)

---

## 0. 한 줄

**되돌릴 수 없는 손상이 하나 남아 있다 — `\overline{GE}` 사고는 2행이 아니라
5행 6곳이었고, 그중 3행 4곳이 지금도 DB 에 `\overline{\geq }` 로 들어 있다.**
그리고 **가장 큰 변경(라벨 8,436행)만 되돌리기 로그가 추적 경로에 없다.**
로그 자체는 건강하다 — 연쇄를 다시 굴려 보니 **10,001개 (컬럼,행) 쌍 전부**
지금 DB 값을 정확히 재현했다. 즉 로그에 안 담긴 갱신은 없다.

| 심각도 | 소견 | 규모 |
|---|---|---|
| 🔴 | `\overline{\geq }` — 되돌리지 않은 잔여 손상 | **3행 4곳** |
| 🔴 | 라벨 8,436행 되돌리기 로그가 gitignore 경로에만 있다 | 8,436행 |
| 🔴 | 라벨을 뗀 자리에 **틀린 배지**가 인쇄된다 | **275문항** (+누락 94) |
| 🟡 | 되돌리기는 **적용의 역순**으로만 듣는다 (문서에 순서 없음) | 지금 259행이 조용히 안 돌아감 |
| 🟡 | 통째 미변환 가드가 대괄호·소문자를 못 본다 → 반쪽 수리 | 43행, 지면 악화 1행 |
| 🟡 | 세는 쪽은 아직 점 라벨을 잔재로 센다 | bareRuns 의 **14.9%** |
| 🟡 | 어휘 추출기가 정본의 «위험 목록»을 안 읽는다 | `_KEYWORD_LABEL_QUOTE` |
| 🟡 | 「성적표」가 손 목록이다 | 목록 밖 부류 58문항 |
| 🟡 | 빈칸 네모 채움 — 실제 영향은 86문항이 아니라 **153문항** | `\,` 1,429개 미집계 |
| 🟡 | 「본문이 낱말로 서술형을 쓰는 문항 2건」은 **61건**이다 | 원장님 지시 미충족 |
| 🟢 | 못 깨뜨린 것 10가지 | §8 |

---

## 1. 🔴 `\overline{GE}` 사고는 **끝나지 않았다** — 3행 4곳이 남아 있다

### ① 무엇이 틀렸나

`dbcb92d3` 은 "`\overline{GE}` → `\overline{\geq }` **2행**을 되돌렸다" 고 적는다.
그 2행은 실제로 되돌아갔다. 그런데 **같은 사고를 당한 행은 5행이었다.**
전수 감사 결과 — 적용 로그의 `\명령{...}` 인자가 before/after 에서 달라진 자리를
전부 세니, 라벨 인자가 훼손된 것은 `\overline{GE}` 4곳 · `\mathrm{\overline{GE}}` 2곳,
합쳐서 **5행 6곳**이었다. 되돌린 것은 그중 2행 2곳뿐이다.

### ② 실데이터 근거

DB 를 직접 조회했다 (읽기 전용, 2026-08-18 기준):

```
content 컬럼에 `{\geq }` / `{\leq }` 가 든 행
  6d840bbf-817b-4e12-bc39-ecc47a6cc7c0  1곳
     …⫽\overline{DF}$이다. $\mathrm{\overline{\geq }}=4cm$일 때, $x-y$의 값은?…
  770327c0-b3b5-4768-8052-230fe8f3bb49  1곳
     …$\overline{\geq }=\overline{EC}$…
  c1a859a5-7ecb-4abd-9f13-70ca62a2aede  2곳
     …③ $\overline{GD}=\overline{\geq }=\overline{GF}$…
     …④ $\overline{BG}=2\overline{\geq }$…
```

셋 다 **무게중심·중선 문항**이다. 지면에는 「선분 GE」가 있어야 할 자리에
**≥ 가 찍힌다.** `c1a859a5` 는 「다음 중 옳지 <u>않은</u> 것은?」 5지선다인데
③④ 두 선택지가 동시에 망가져 **정답 판정이 불가능**하다.

되돌린 2행(`16c652ee`, `194b158f`)과 남은 3행은 **같은 로그, 같은 규칙, 같은 모양**이다.
남은 3행만 못 본 이유는 되돌릴 대상을 **`\mathrm{\overline{GE}}` 모양으로만** 찾았기
때문으로 보인다 — 되돌린 2행 중 하나가 그 모양이었다.

전수성 근거 두 가지를 따로 셌다.
- **인자 감사**: 네 로그(content pass1/pass2 · answer · solution)의 모든
  `\cmd{...}` 인자 다중집합을 before/after 로 견줬다. 라벨 인자가 사라진 것은
  위 6곳뿐이고, 나머지(`\overarc{AB}`→`\overset{\frown}{AB}` 139곳,
  `\frac{cosA}`→`\frac{\cos A}` 등)는 전부 정상 규칙 결과다.
- **le/ge 자리 감사**: 네 로그에서 «대문자가 든 영문 덩어리가 부등호로 바뀐 자리»
  231곳을 전량 늘어놨다. 기하 문항에서 일어난 것은 14곳이고, 그중 `GE` 6곳을 뺀
  나머지는 정규분포표의 `0leZlez`·신뢰구간 `640.2LEmLE659.8` 로 **전부 옳다**.

### ③ 재현물

`qa/adversarial/_adv-postfix-label-guard.test.ts` §① — 세는 쪽이 아직
`\overline{GE}` 의 `GE` 를 잔재 후보로 센다(§6). 감사 스크립트는
`scripts/qa/reports/_adv/arg-audit.ts` · `lege-site-audit.ts` · `db6.ts`.

### ④ 심각도 🔴 — 되돌릴 수 없는 데이터 손상 (되돌리기 로그는 있다)

---

## 2. 🔴 가장 큰 변경만 되돌리기 로그가 **추적 경로에 없다**

### ① 무엇이 틀렸나

렌더-C 보고서 §7 은 이렇게 적는다 — "`scripts/qa/reports/` 는 gitignore 라
워크트리를 지우면 근거가 사라진다. 그래서 적용 로그를 **추적되는 경로에 복사**해
두었다." 실제로 복사된 것은 HWP 잔재 90 · vec 15 · `$` 11 = **116행**뿐이다.

**라벨 8,436행 — 이 트랙에서 가장 큰 변경 — 은 복사되지 않았다.**
보고서를 쓸 때는 아직 적용 전(§4.2 "적용 보류")이었고, 나중에 적용하면서
복사를 안 했다. 지금 그 로그는 **다른 워크트리의 gitignore 경로 한 곳**에만 있다.

### ② 실데이터 근거

```
git ls-files | grep -E 'applied|revert'
  docs/planning/tracks/reports/h-answer-applied.json.gz          17행
  docs/planning/tracks/reports/h-content-applied-pass1.json.gz 1,128행
  docs/planning/tracks/reports/h-content-applied.json.gz          57행
  docs/planning/tracks/reports/h-content-revert-overline-ge.json.gz 2행
  docs/planning/tracks/reports/h-solution-applied.json.gz        504행
  docs/planning/tracks/reports/render-c-revert-dollar.json         11행
  docs/planning/tracks/reports/render-c-revert-residue-vec.json    15행
  docs/planning/tracks/reports/render-c-revert-residue.json        90행
                                                    ← 라벨 8,436행 로그가 없다
```

유일한 사본 두 개 (둘 다 gitignore 경로):
```
C:/Creative/testautocreator/scripts/qa/reports/render-postfix-label-applied.json  6.9MB  8,436행
C:/Creative/testautocreator/scripts/qa/reports/render-postfix-label.json          8.3MB  계획+meta
```

계획 파일은 단순한 백업이 아니다 — **각 행의 라벨이 무슨 유형을 말했는지**
(`meta.kind`)가 거기에만 남아 있다. 본문에서 라벨을 뗐으므로 DB 에는 그 근거가
없다. §3 의 배지 오류를 판정할 유일한 자료다. 이 워크트리가 지워지면 **275문항의
배지가 왜 틀렸는지 아무도 못 밝힌다.**

### ③ 재현물

`_adv-postfix-label-guard.test.ts` §④ 「라벨 8,436행 되돌리기 로그가 추적 경로에 없다」.

### ④ 심각도 🔴 — 되돌릴 수단 자체가 사라질 수 있다

---

## 3. 🔴 라벨을 뗀 자리에 **틀린 배지**가 인쇄된다 — 275문항

### ① 무엇이 틀렸나

지면 배지는 `assignEssayLabels` 가 `questionType === "서술형"` 일 때만 붙인다.
라벨을 떼기 전에는 근거가 둘(원본 시험지가 인쇄한 라벨 · `questionType` 컬럼)이었고
374행에서 둘이 어긋났다. 렌더-C 보고서 §5.4 는 이 어긋남을 **"다른 트랙에 넘긴다"**
고 적고 "라벨을 떼기 전에 정리하는 편이 낫다" 고 권고했다. **정리하기 전에 뗐다.**

그래서 지금은 **어긋난 쪽이 이겼다** — 원본 시험지가 `[단답형 3]` 이라고 인쇄한
문항에 우리 시험지는 「서술형 n」 배지를 찍는다.

### ② 실데이터 근거

계획 파일의 `meta.kind` 와 **현재** DB `questionType` 을 8,436행 전량 대조했다.

| 라벨이 말한 유형 ↔ 현재 `questionType` | 행 | 지면 결과 |
|---|---|---|
| 서술형 ↔ 서술형 | 6,694 | 배지 정상 |
| 서답형 ↔ 서술형 | 942 | 배지 정상(양립) |
| 서답형 ↔ 단답형 | 283 | 배지 없음(양립) |
| **단답형 ↔ 서술형** | **275** | **틀린 배지가 찍힌다** |
| 단답형 ↔ 단답형 | 140 | 정상 |
| 서술형 ↔ 객관식 | 31 | 배지 누락 |
| 서술형 ↔ 단답형 | 27 | 배지 누락 |
| 서술형 ↔ null | 24 | 배지 누락 |
| 서답형 ↔ 객관식 | 11 | 배지 누락 |
| 단답형 ↔ null | 4 | 정상(없음) |
| **주관식 ↔ 서술형** | **3** | **틀린 배지** |
| 서답형 ↔ null / 주관식 ↔ 객관식 | 2 | — |

- **틀린 배지 278문항** (단답형 275 + 주관식 3)
- **배지 누락 94문항** (서술형·서답형인데 배지가 안 붙는다 — 서답형↔단답형 283은
  상위어라 제외)

표본: `010857c3` `01c6c980` `0237c89e` (원본 `[단답형 n]` → 현재 `questionType=서술형`).

렌더-C 보고서 §3 구현 규칙은 **"모르는 것을 서술형이라 단정하면 틀린 표시가 나가고,
그건 표시가 없는 것보다 나쁘다"** 고 적었다. 지금 벌어지는 일이 정확히 그것이고,
`questionType` 이 «비어 있지 않고 틀렸을 때» 는 그 가드가 못 막는다.

### ③ 재현물

`scripts/qa/reports/_adv/badge-audit.ts` (계획 파일 + DB 대조, 읽기 전용).
계획 파일이 gitignore 경로에 있어 단위 테스트로 잠글 수 없다 — **§2 를 먼저
해결해야 이 감사가 재현 가능해진다.**

### ④ 심각도 🔴 (지면에 틀린 사실이 인쇄된다) — 다만 데이터 손상은 아니다.
`questionType` 을 고치면 배지는 따라온다.

---

## 4. 🟡 되돌리기는 **적용의 역순**으로만 듣는다 — 문서에 그 순서가 없다

### ① 무엇이 틀렸나

가드는 진짜로 일한다(아래 근거). 그런데 **여러 로그가 같은 행을 건드렸다.**
`WHERE p.content = v.before` 는 지금 값이 그 로그의 `after` 일 때만 되돌린다.
그러니 오래된 로그부터 되돌리면 **연쇄된 행은 조용히 건너뛴다.**
두 보고서(§7) 어디에도 순서가 적혀 있지 않고, `--revert` 는 `되돌림 N / M` 만
찍고 **어느 행을 왜 건너뛰었는지 말하지 않는다.**

### ② 실데이터 근거

가드와 **똑같은 조인·똑같은 조건**을 SELECT 로 흉내 내 읽기만 했다
(`_adv/guard-probe.ts`). 지금 각 로그로 `--revert` 하면:

| 로그 | 행 | 되돌아갈 행 | **조용히 건너뜀** |
|---|---|---|---|
| render-c residue | 90 | 69 | **21** |
| render-c vec | 15 | 12 | **3** |
| render-c dollar | 11 | 9 | **2** |
| 라벨 | 8,436 | 8,235 | **201** |
| h-content pass1 | 1,128 | 1,096 | **32** |
| h-content pass2 | 57 | 57 | 0 |
| h-answer | 17 | 17 | 0 |
| h-solution | 504 | 504 | 0 |

합계 **259행**. 연쇄가 얼마나 넓은지도 셌다 — 라벨 ∩ pass1 **198행** ·
라벨 ∩ (pass2·answer·solution) **323행** · (residue·vec·dollar) ∩ 라벨 **22행** ·
같은 셋 ∩ pass1 **5행**.

이것은 가드가 **일한** 결과다 — 가드가 안 걸렸다면 뒤 단계의
수리까지 통째로 짓밟혔을 것이다. 실제 적용 시점의 「건너뜀 0」도 진짜다(§8-①).

실측한 적용 순서(`updated_at`, UTC):

```
08-17 11:05  residue 90 · dollar 11
08-17 11:11  vec 15
08-17 11:33  라벨 8,436          ← 7,989행이 이 분에, 나머지 447행은 뒤 단계가 다시 건드림
08-18 01:36  content pass1 1,128
08-18 01:40  content pass2 57 · answer 17
08-18 01:49  overline-ge 되돌림 2
08-18 01:50  solution 504
```

### ③ 재현물

`_adv-postfix-label-guard.test.ts` §④ 「연쇄된 행이 없다」 — 실제로는 5행이 나온다
(`41db11e7` `47f9c9d9` `62b0e1dc` `ccd2512e` `d4dccf59`).

### ④ 심각도 🟡

---

## 5. 🟡 통째 미변환 가드가 **대괄호와 소문자를 못 본다** → 반쪽 수리

### ① 무엇이 틀렸나

```ts
["LEFT/RIGHT", /(?<![\\A-Za-z])(?:LEFT|RIGHT)\s*[()]/],
```

**소괄호일 때만** 걸린다. 실데이터에는 `LEFT [ … RIGHT ]`(대괄호)와 소문자
`left[ … right]` 가 있고, 이 행들은 통째 미변환인데 가드를 통과해 **부분 수리**를
받았다. `over`·`DIVIDE`·`vert` 때와 **같은 자리**다 — 표지를 손으로 적었고,
실데이터의 모양이 그 목록보다 넓었다.

### ② 실데이터 근거

가드를 통과했지만 통째 미변환 표지가 있는 행: **content 1 · solution 43**
(`맨 therefore/because` 29 · `맨 sqrt/root` 7 · `소문자 left/right` 6 ·
`LEFT/RIGHT+대괄호` 3 · `맨 int/sum/prod` 3 · `맨 SUB/SUP` 2).

그중 **한 행은 지면이 실제로 나빠졌다.** 전/후를 화면과 같은 방식으로 렌더해
붉은 span 을 세니(`_adv/render-delta.ts`), 나빠진 행은 전체 로그를 통틀어
`93156cba` 하나였다.

```
전: $int _0 ^ ln2 {(2 - e^x ) }dx + int _ln2 ^ln4{(e^x - 2)}dx$      붉지 않음
후: $int _0 ^ \ln 2 {(2 - e^x ) }dx + int _\ln 2 ^\ln 4{(e^x - 2)}dx$  붉다 (2 span)
```

`^\ln 2` 는 KaTeX 가 못 그린다. 고치기 전에는 이탤릭 `ln2` 로라도 읽혔다.

### ③ 재현물

`_adv-postfix-label-guard.test.ts` §③ 두 건.

### ④ 심각도 🟡 — 되돌리기 로그가 있고, 되돌리면 원래대로다.

---

## 6. 🟡 세는 쪽은 **아직** 점 라벨을 잔재로 센다 — 사고의 절반만 고쳤다

### ① 무엇이 틀렸나

`dbcb92d3` 은 **고치는 쪽만** 고쳤다.

| | 고치는 쪽 `renderPostfixRules` | 세는 쪽 `mathTokenCensus` |
|---|---|---|
| `\overline` 계열 보호 | ✅ `PROTECTED_ARG_COMMANDS` 에 추가됨 | ❌ `LABEL_ARG_COMMANDS` 에 **없다** |
| 중괄호 한 겹 중첩 | ✅ `(?:[^{}]|\{[^{}]*\})*` | ❌ `[^{}]*` **그대로** |

`measure-hwp-latex-residue.py` 의 `PROTECTED` 는 둘 다 고쳐져 있다. **셋 중 하나만
안 고쳤고, 그게 하필 「무엇이 잔재인지 사람에게 알려 주는」 census 다.**
census 를 다시 돌리면 `GE`·`AB` 가 또 잔재 후보 상위에 오른다 — 이 사고를 낳은
그 정보원이 그대로 살아 있다. CLAUDE.md 2026-08-18 교훈("세는 쪽과 고치는 쪽이
같이 눈이 먼다")이 **절반만** 적용됐다.

### ② 실데이터 근거

```
bareRuns 총 34,623개 · 그중 «도형 오버레이/중첩 라벨 안» 인데 잔재로 세어진 것 5,152 (14.9%)
   AB 924 · BC 771 · AC 516 · AD 388 · CD 269 · BD 212 · DE 160 …
   정본 `_KEYWORD_LABEL_QUOTE` 가 이름 붙여 둔 것: GE 2 · GG 4
```

픽스처 실측:
```
\overline{GE}=2            → run=GE  inLabelCommand=false   ← 라벨인데 잔재
\mathrm{\overline{GE}}=4   → run=GE  inLabelCommand=false   ← 마스킹이 통째로 샌다
\mathrm{GE}=4              → run=GE  inLabelCommand=true    ← 이것만 맞는다
```

### ③ 재현물 `_adv-postfix-label-guard.test.ts` §① 두 건 · `_adv/census-inflation.ts`

### ④ 심각도 🟡

---

## 7. 🟡 어휘 추출기가 정본의 **위험 목록**을 안 읽는다 — 이 사고의 뿌리

### ① 무엇이 틀렸나

`build-hwp-vocab.py` 는 "손 목록은 반드시 샌다"는 이유로 만들어졌다. 그런데
**어느 맵을 읽을지 고르는 목록이 다시 손으로 적혀 있고**, 하필 이 사고를
미리 이름 붙여 둔 집합을 안 읽는다.

`F:\시험지변환기\core\latex_to_hwpeq.py:321-323`

```python
# HWP 연산자 키워드와 글자가 같은 점/선분 라벨 — rm {} 안에서도 HWP 가 관계연산자로
# 토큰화해 글자가 증발한다(GE→≥, LE→≤, NE→≠, GG→≫, LL→≪; 대륜중2 #16 GE→≥ 실증).
# 이 라벨은 따옴표 리터럴(□·★ 방식)로 감싸 토큰화를 차단한다.
_KEYWORD_LABEL_QUOTE = {"GE", "LE", "NE", "GG", "LL"}
```

**정본은 「GE 는 점 라벨과 구분이 안 된다」를 이미 알고 있었고, 실증 사례까지
주석에 적어 두었다.** 추출기가 이 집합을 읽었다면 `le`/`ge` 규칙은 처음부터
그 다섯을 위험 목록으로 들고 있었을 것이다. 대신 우리는 그 지식을
**데이터를 부순 뒤에** 다시 발견했다.

추출기가 읽지 않는 다른 맵: `_SUPERSCRIPT_MAP` · `_UNITS`/`_NUM_TAIL_UNITS`
(`\cm` 사고와 같은 부류) · `_PAREN_HANGUL`.

### ② 실데이터 근거 — **낡음 여부는 지금은 괜찮다**

정본으로 다시 생성해 커밋본과 비교했다:

```
python scripts/qa/build-hwp-vocab.py --out …/_adv/hwp-vocab-now.json
diff (커밋본 vs 재생성) → 차이 없음
```

그러나 **낡아도 아무도 모른다.** `hwp-vocab.json` 에는 정본의 해시도 생성 시각도
없다(`_source` 는 경로 문자열뿐). 재생성을 강제하거나 검증하는 테스트·훅·CI 도 없다
(`src/__tests__/unit/hwpVocab.test.ts` 는 json 내용만 본다). 정본은
`F:` 드라이브에 있어 이 저장소의 어떤 검사에도 안 걸린다.

### ③ 재현물 `_adv-postfix-label-guard.test.ts` §②

### ④ 심각도 🟡 (지금 값은 맞다 — 구조가 문제다)

---

## 8. 🟡 나머지 셋

### 8.1 「성적표」가 손 목록이다

렌더-C 보고서 부록은 **"실태 측정(DB 전수). 성적표는 이것 하나만 본다"** 로
`measure-render-defects.ts` 를 지정한다. 그 파일의 `HWP_KEYWORDS` 는 **24개짜리
손 목록**이고 `hwp-vocab.json` 을 **읽지 않는다.** 목록에 없는 것:
`le`·`ge`·`LEQ`·`GEQ`·`NEQ`·소문자 `times`·`vert`·`CENTIGRADE`·삼각함수·그리스 이름
— 전부 렌더-D 가 나중에 찾아낸 바로 그 부류다.

DB 전수 실측:
```
성적표(24개)가 잡는 문항                       52
성적표 목록 **밖** 부류가 있는 문항            58
   맨 삼각함수·log 33 · le/ge 9 · vert 7 · LEQ/GEQ/NEQ 6 · 소문자 times 4 · 그리스 3
```
지금은 수가 작지만(후보정이 대부분 걷어냈다), **다음 부류도 똑같이 0으로 보일 것이다.**
🟡

### 8.2 빈칸 네모 채움 — 실제 영향은 86문항이 아니라 153문항

`0d850a0c` 는 "채움이 줄어든 문항 **86건** · `~` 1,460 → 723(**737개 제거**)"라고
적는다. 규칙(`collapseBlankBoxPadding`)은 `~` 와 `\,` **둘 다** 줄이는데,
실측은 `~` 만 셌다. DB 전수로 다시 재니:

```
지면이 바뀌는 문항 153
   ~ 가 줄어든 문항 107 · ~ 875개
   \, 가 줄어든 문항 71 · \, 1,429개   ← 커밋 실측에 없다
```

부작용은 못 찾았다 — 「네모 앞쪽 채움까지 사라진 자리」15곳을 눈으로 봤는데
전부 `\square \,\,\,\,\,(가)` 처럼 **네모에 잇닿은 채움**이었다. 즉 규칙은 옳고
**숫자만 1.8배 과소 보고**다. 다만 DB 가 아니라 렌더 전처리라 되돌리기는 쉽다. 🟡

### 8.3 「본문이 낱말로 서술형을 쓰는 문항은 전수 2건」은 **61건**이다

렌더-C §4.2 는 "본문이 낱말로 「서술형」을 쓰는 문항은 **전수에서 2건**뿐"이라고
적는다. 대괄호 라벨을 걷어낸 뒤 전수를 다시 세니 **61문항**이다.

```
단답형 29 · 서술형 28 · 서답형 3 · 선택형 1
  068296ea  …물음에 답하시오. (서술형이므로 풀이과정을 반드시 서술하시오. …)
  150c4bcd  …$a+b$의 값을 구하시오.⏎<서술형 답안 작성 방법>⏎…
  17158c84  …$A$의 값을 구하시오. (단, $a$는 유리수) (단답형이므로 답만 쓰시오.)
  00dea45d  …<상자> [조건] • ◎ 단답형이므로 답만 적을 것
```

원장님 지시는 **"문제 자체에 서술형이란 글자가 있으면 안되지"** 였다. 대괄호
라벨만 뗐으므로 이 61문항은 지시를 아직 못 지킨다. 🟡

---

## 9. 🟢 못 깨뜨린 것 — 찔렀는데 멀쩡했다

여기 적는 것이 §1~8 만큼 중요하다. **다음 사람이 같은 자리를 다시 파지 않게.**

1. **로그가 진짜 되돌린다 — 로그에 안 담긴 갱신은 없다.**
   실측 적용 순서대로 각 행을 **로그만으로 다시 굴려** DB 현재 값과 대조했다
   (`_adv/chain-sim.ts`). **10,001개 (컬럼,행) 쌍 전부 일치, 어긋난 항목 0.**
   중간 단계에서 «앞 단계 결과와 `before` 가 안 맞아» 건너뛴 항목도 **모든 로그에서 0**.
   즉 적용 시점의 「건너뜀 0」 보고는 사실이고, 이 행들에는 로그 밖 갱신이 없다.
   각 로그의 계획 건수 = 로그 건수 = 실제 갱신 건수도 `updated_at` 분포로 맞췄다
   (라벨: 7,989 + 뒤 단계가 다시 건드린 447 = 8,436).

2. **라벨 8,436행이 잘라낸 조각은 전부 순수 라벨이다.**
   `after` 가 `before` 의 접미가 아닌 행 **0** · 잘라낸 조각 **195종 전량 라벨**
   (`[서술형 $2$] ` 727 … `[서답형 $2$](단답형) ` 1) · 뗀 뒤 `]`·`)`·`,` 로 시작하는
   행 **0** · `$` 짝 홀짝이 뒤집힌 행 **0** · 뗀 뒤 25자 미만 7행(보고서와 일치,
   전부 원래부터 잘려 있던 행). 보고서의 「고유 모양 35종」은 공백을 정규화한
   수치로 보인다(원문 그대로는 195종) — 결론은 바뀌지 않는다.

3. **`\P` 23곳은 전량 확률 P 아니면 점 라벨 P 다.** 전량 눈으로 봤다.
   `\P\left( \mathit{A}\cap B\right)` · `점 $\P$에서 원 $\O$에 그은 두 접선` —
   ¶ 로 그려지고 있던 것이 맞다. 「본문과 독립인 근거」 가드가 일했다.

4. **백슬래시를 뗀 대문자 명령 33종 중 KaTeX 가 아는 것은 `\P` 하나뿐.**
   `\A` `\B` `\O` `\ABCD` `\H`(₅H₁ 중복조합) … 전부 KaTeX 가 모르는 라벨이고,
   `\Delta`·`\Re`·`\S` 는 **한 건도 안 건드렸다.** 렌더로 판정하는 설계가 옳았다.

5. **지면은 전체적으로 좋아졌다.** 전/후를 화면과 같은 파이프라인으로 렌더해
   붉은 span 을 셌다 — content pass1 **275 → 58** · solution 52 → 48 ·
   residue 7 → 3. **나빠진 행은 §5 의 1행뿐.**

6. **`$` 짝을 깨뜨린 행 0.** dollar 11행만 의도대로 홀→짝이 됐고, 나머지 모든
   로그에서 `$` 홀짝이 바뀐 행도 수식 span 개수가 바뀐 행도 0이다
   (라벨은 `$3$` 를 뗐으므로 span 감소가 정상).

7. **`hwp-vocab.json` 은 지금 정본과 일치한다.** 정본으로 재생성해 diff — 차이 없음.

8. **`blockingKeyword` 의 «두 글자 키워드는 안 쓴다» 결정은 옳다.**
   `of`·`to`·`it`·`in`·`pi` 는 길이 필터로 빠져 있어 영어 낱말을 잡지 않는다.
   실데이터 `\mathrm{P}(0leitZle1)`(= `le it Z le`, `it` 는 HWP 이탤릭 지시자)은
   분해에 실패해 `lege-shape` 로 **막혔다** — 검사가 일했다.

9. **`BOX`/`box` 표지는 낱말과 안 부딪친다.** `/(?:BOX|box)\s*\{/` 가 `{` 를
   요구하고, 걸려도 «막는» 방향이라 안전하다. `LEFT`(대문자 4자)도
   `blockingKeyword` 가 정본 `left` 로 잡아 부등호 치환을 막는다.

10. **컬럼별 재검토 — `answer`·`solution` 에서 새 손상은 못 찾았다.**
    `answer` 17행은 전부 `cosA`→`\cos A` 류. `solution` 504행의 대문자 le/ge
    치환 자리를 전량 봤는데 `GEk`(`h(-3) ≥ k`) · `LEa`(`-6 ≤ a < -5`) ·
    `leP`(`P(Y≤29)`) 처럼 **전부 부등호**였다. 전부 대문자인 덩어리는
    `lege-upper-label` 로 막혔다(`\angle GEF` 부류). §1 의 손상은 **`content`
    에서만** 일어났다 — `solution` 은 가드를 고친 뒤에 적용했기 때문이다.

**범위 밖 관찰(🟢).** 08-17 이후 갱신된 13,551행 중 **3,972행**이 이 여덟 로그
어디에도 없다(08-17 00:10 3,783 · 13:35 93 · 03:58 44 · 12:25~12:35 52).
표본을 보니 `answer`·`questionType` 계열 작업으로 보이고 후보정 트랙 소관이
아니다. **다만 확인하지는 못했다** — 그쪽 트랙의 적용 로그를 함께 대조해야 한다.

---

## 10. 되돌려야 할 것 — 목록과 방법 (실행은 오케스트레이터)

> ⚠️ 아래 명령은 **내가 실행하지 않았다.** 전부 공유 Supabase 쓰기다.

### 10.1 🔴 먼저 — `\overline{\geq }` 3행 (§1)

세 행 모두 **pass1 이 그 행에서 바꾼 것은 이 손상 하나뿐**임을 확인했다
(다른 정상 수리를 같이 잃지 않는다). 그러므로 **행 단위 되돌리기가 정확하다.**

```bash
# 1) pass1 로그에서 세 행만 뽑아 되돌리기 로그를 만든다 (읽기 전용)
node -e '
const z=require("zlib"),fs=require("fs");
const R="docs/planning/tracks/reports";
const j=JSON.parse(z.gunzipSync(fs.readFileSync(R+"/h-content-applied-pass1.json.gz")).toString("utf8"));
const ids=["6d840bbf-817b-4e12-bc39-ecc47a6cc7c0",
           "770327c0-b3b5-4768-8052-230fe8f3bb49",
           "c1a859a5-7ecb-4abd-9f13-70ca62a2aede"];
const items=j.items.filter(i=>ids.includes(i.id));
if(items.length!==3) throw new Error("세 행을 못 찾았다: "+items.length);
fs.writeFileSync(R+"/h-content-revert-overline-ge-2.json",
  JSON.stringify({column:"content",items},null,2));
console.log("wrote", items.length);'

# 2) 되돌린다 — 지금 값이 `after`(손상본) 일 때만 `before` 로 돌아간다
ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --revert \
  --log docs/planning/tracks/reports/h-content-revert-overline-ge-2.json
#    기대 출력: 되돌림 3 / 3

# 3) 확인 — 0 이어야 한다
npx tsx scripts/qa/reports/_adv/db6.ts   # content 에 남는 `{\geq }` 행이 2행(무관한 \mathit) 만
```

되돌린 뒤에도 `{\geq }`/`{\leq }` 를 가진 행이 남는데 **전부 손상이 아니다.**
로그의 before/after 로 출처를 하나씩 확인했다:

| 행 | 컬럼 | 모양 | 판정 |
|---|---|---|---|
| `81181424` | content · solution | `\mathit{\geq }` | 로그의 `before` 에 **이미 있었다** — 추출 단계 산물 |
| `37f4ef72` | content | `\mathit{\leq }` | **어느 로그에도 없는 행** — 우리가 안 건드렸다 |
| `d7aee9c8` `625a3c96` | solution | `\mathit{\leq }`·`\mathit{\geq }` | 그 컬럼을 안 건드렸다(해설 로그에 없음) |
| `b3c04bf1` | solution | `2{\leq }n{\leq }14` | **우리가 만들었고 옳다** — 원본 `2{LE}n{LE}14`, 중괄호는 HWP 묶음이지 라벨이 아니다 |

### 10.2 🔴 다음 — 되돌리기 근거를 추적 경로로 옮긴다 (§2)

```bash
node -e '
const z=require("zlib"),fs=require("fs");
const S="C:/Creative/testautocreator/scripts/qa/reports";
const R="docs/planning/tracks/reports";
for (const [src,dst] of [["render-postfix-label-applied.json","render-c-revert-label.json.gz"],
                         ["render-postfix-label.json","render-c-label-plan.json.gz"]])
  fs.writeFileSync(R+"/"+dst, z.gzipSync(fs.readFileSync(S+"/"+src)));
console.log("copied");'
git add docs/planning/tracks/reports/render-c-revert-label.json.gz \
        docs/planning/tracks/reports/render-c-label-plan.json.gz
```

계획 파일(`meta.kind`)도 같이 옮겨야 한다 — §3 의 배지 판정 근거가 그것뿐이다.
`apply-render-postfix.ts` 의 `--revert` 는 `.gz` 를 못 읽는다(`apply-math-residue.ts`
만 푼다). 라벨 로그는 `column` 필드가 없으므로 `--column content` 로
`apply-math-residue.ts --revert` 를 쓰거나, gz 를 풀어서 쓰면 된다.

### 10.3 되돌리기 **순서** — 지금 전부 되돌린다면 (§4)

적용의 역순이어야 한다. 순서를 틀리면 259행이 조용히 안 돌아간다.

```
1. h-solution-applied.json.gz            (--column solution)
2. h-content-applied.json.gz             (pass2)
3. h-answer-applied.json.gz              (--column answer)
4. h-content-applied-pass1.json.gz       (pass1)
5. 라벨 로그 (10.2 에서 옮긴 것)
6. render-c-revert-residue-vec.json
7. render-c-revert-dollar.json  ·  render-c-revert-residue.json
```

(`h-content-revert-overline-ge.json.gz` 2행은 이미 되돌아가 있으므로 4번에서
자동으로 건너뛴다 — 그게 맞는 동작이다.)

### 10.4 🔴 되돌리지 말고 **고쳐야** 하는 것 — 배지 (§3)

되돌리기로는 못 푼다(라벨을 다시 본문에 넣는 것은 원장님 지시에 어긋난다).
`questionType` 을 원본 시험지 근거로 맞춰야 한다. 대상은 계획 파일의
`meta.typeAgrees === false` 374행이고, **지면에 실제로 틀린 글자가 나가는 것은
278행**(단답형·주관식 라벨 ↔ `questionType=서술형`)이다. 그 목록은
`_adv/badge-audit.ts` 가 뽑는다. 원장님 확인 없이 컬럼을 고치지 말 것 —
어느 쪽이 옳은지는 원본 시험지를 봐야 정해진다(렌더-C §5.4 와 같은 판단).

### 10.5 되돌릴 필요 없는 것

- §5 의 43행(반쪽 수리): 되돌리기 로그가 있고 지면이 나빠진 것은 1행뿐이다.
  `93156cba` 는 어차피 재추출 대상이라 개별 되돌리기의 이득이 작다.
- §8.2 빈칸 채움: DB 를 안 건드렸다. 코드 되돌리기로 충분하다.

### 10.6 코드 쪽 후속 (데이터 아님)

| # | 무엇 | 어디 |
|---|---|---|
| 1 | `LABEL_ARG_COMMANDS` 에 `\overline` 계열 추가 · `maskArgs` 를 한 겹 중첩까지 | `scripts/qa/mathTokenCensus.ts` |
| 2 | `_KEYWORD_LABEL_QUOTE` 를 추출해 `keywordLabelQuote` 로 싣고, le/ge 규칙이 그것을 위험 목록으로 쓴다 | `scripts/qa/build-hwp-vocab.py` |
| 3 | `hwp-vocab.json` 에 정본 파일 해시·생성 시각을 넣고, 테스트가 «정본이 있으면 재생성해 일치»를 검사 | 같은 곳 |
| 4 | 통째 미변환 표지에 대괄호·소문자·`therefore`·`int _` 추가 | `renderPostfixRules.WHOLESALE_MARKERS` |
| 5 | `measure-render-defects.ts` 가 `hwp-vocab.json` 을 읽게 (손 목록 제거) | 같은 곳 |
| 6 | `--revert` 가 건너뛴 행의 id 와 «지금 값이 무엇인지» 를 찍게 | `apply-*.ts` `runRevert` |
| 7 | `apply-render-postfix.ts --revert` 도 `.gz` 를 읽게 | 같은 곳 |
| 8 | 빈칸 채움 실측을 `~` 와 `\,` 둘 다 세게 | `measure-tilde-space.ts` |

---

## 11. 재현

감사 스크립트는 `scripts/qa/reports/_adv/` (gitignore — 이 보고서에 결과를 다 옮겨 적었다).
전부 **읽기 전용**이고 `ALLOW_SHARED_IMPORT` 를 쓰지 않는다.

```bash
npm run test:adv -- qa/adversarial/_adv-postfix-label-guard.test.ts   # 7건 전부 빨강(의도)

npx tsx scripts/qa/reports/_adv/chain-sim.ts        # 로그 연쇄 → DB 재현 (§9-①)
npx tsx scripts/qa/reports/_adv/guard-probe.ts      # 가드를 SELECT 로 흉내 (§4)
npx tsx scripts/qa/reports/_adv/arg-audit.ts        # 라벨 인자가 바뀐 행 (§1)
npx tsx scripts/qa/reports/_adv/db6.ts              # DB 에 남은 `{\geq }` (§1)
npx tsx scripts/qa/reports/_adv/badge-audit.ts      # 배지 교차표 (§3)
npx tsx scripts/qa/reports/_adv/label-audit.ts      # 잘라낸 조각 전량 (§9-②)
npx tsx scripts/qa/reports/_adv/render-delta.ts     # 전/후 붉은 span (§5, §9-⑤)
npx tsx scripts/qa/reports/_adv/census-inflation.ts # 세는 쪽 부풀림 (§6)
npx tsx scripts/qa/reports/_adv/scorecard-gap.ts    # 성적표 목록 밖 (§8.1)
npx tsx scripts/qa/reports/_adv/tilde2.ts           # 채움 ~ vs \, (§8.2)
npx tsx scripts/qa/reports/_adv/claim-check.ts      # 본문 낱말 61건 (§8.3)
npx tsx scripts/qa/reports/_adv/verify-claims.ts    # 연쇄 폭 · `{\geq}` 출처 (§4, §10.1)
```

`_adv/` 는 `.env`(공유 Supabase 읽기)와 `C:/Creative/testautocreator` 의 라벨 로그
두 개를 참조한다. §10.2 를 실행하면 라벨 로그 의존은 사라진다.

---

## 12. 이 리뷰가 남기는 한 문장

**손상이 심할수록 그 손상을 정상으로 읽는 가드가 생긴다 — 는 이제 여섯 번
적혔다. 이번에 새로 배운 것은 다른 것이다.**

`dbcb92d3` 은 옳은 진단을 내렸고("컬럼이 다르면 데이터가 다르다") 고치는 쪽을
정확히 고쳤다. 그런데 **같은 결함이 세는 쪽에도 있었고 거기는 안 고쳤다.**
그래서 census 는 지금도 `GE` 를 잔재라고 말한다. 그리고 **되돌리기는
「발견한 모양」으로만 했고 「같은 원인의 모양」 전부로는 안 했다** — 그래서
`\mathrm{\overline{GE}}` 2행은 돌아갔고 `\overline{\geq }` 3행은 남았다.

> **원인을 고쳤으면, 그 원인이 이미 만든 것을 **전수로** 세어 되돌려라.
> 그리고 원인이 여러 곳에 복제돼 있지 않은지 — 특히 «세는 쪽» 에 —
> 같은 커밋에서 확인하라.**

정본은 이 사고의 이름을 이미 알고 있었다(`_KEYWORD_LABEL_QUOTE`, 실증 사례까지).
우리는 그 파일을 import 하면서 그 줄을 안 읽었다. **손 목록을 없애려고 만든
도구의 「무엇을 읽을지」가 다시 손 목록이었다.**
