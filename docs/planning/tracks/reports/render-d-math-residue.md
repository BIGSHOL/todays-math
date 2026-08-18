# 렌더 D — 지면에 날 글자로 나가는 수식 (2026-08-18)

> ⚠️ **문서 이름 확인 필요.** `render-a/b/c` 뒤를 이어 `render-d` 로 붙였다.
> 다른 세션이 같은 글자를 썼다면 참조가 적은 쪽을 옮긴다 (tracks/README).
> 이 트랙이 소유한 파일: `scripts/qa/**`, `src/lib/math/{textPreprocess,katexRender,renderMathHtml}.ts`,
> `src/lib/testchanger/**`. `src/components/**` 와 `boxBlock.ts`·`parseProblemContent.ts` 는 건드리지 않았다.

원장님이 화면에서 직접 찾은 다섯 가지(`\htmlClass`·`\overarc` 붉은 글씨,
`3times5`, `le`, `ge`)에서 출발해 **전수로** 다시 셌다.

---

## 0. 한 장 요약

| | 전 | 후 |
|---|---|---|
| 붉게 나가는 문항 | **671** (1.42%) | **619** (1.31%) |
| 붉은 수식 span | 1,798 (0.44%) | 1,625 (0.40%) |
| 정본 키워드가 맨 글자로 남은 문항 | **338** (0.72%) | **143** (0.30%) |
| DB 갱신 | — | content 1,185행 · answer 17행 · solution 504행 |

**남은 붉은 글씨 619행 중 320행은 데이터 문제가 아니다.** 우리 전처리가 만든
`\htmlClass` 를 화면 렌더가 `trust` 없이 거부하는 것이고, **`MarkdownRenderer` 한 줄**로
사라진다(§4). 나머지 304행은 짝 없는 중괄호 등 **구조가 이미 무너진 행**으로,
후보정으로는 못 살리고 재추출이 답이다(§5).

---

## 1. 왜 지금까지 안 잡혔나 — 진짜 원인은 하나였다

세 가지 증상이 있었지만 뿌리는 하나다. **잔재를 세는 쪽과 고치는 쪽이 각자 손으로
낱말을 나열했고, 그래서 둘이 같이 눈이 멀었다.**

| 놓친 것 | 세는 쪽 | 고치는 쪽 |
|---|---|---|
| `DIVIDE` (2026-08-17) | `DIV` 패턴이 뒤의 `I` 에 막혀 **영원히 0** | 있었지만 lookaround 가 거꾸로 |
| `le` · `ge` (2026-08-18) | 목록에 **없음** | 규칙 자체가 **없음** (`<=`·`>=` 만 있었다) |
| 소문자 `times` | 목록에 **없음** | 대문자 `TIMES` 만 있었다 |
| `vert` | 목록에 **없음** | 없음 — 정본이 왕복 정합성 때문에 **일부러** 안 되돌린다 |

그래서 이번에는 목록을 사람이 쓰지 않게 바꿨다.

```
F:\시험지변환기\core\{latex_to_hwpeq,hwpeq_to_latex}.py     ← 정본
        │  build-hwp-vocab.py 가 import 해서 추출
        ▼
scripts/qa/hwp-vocab.json          HWP 토큰 162 · 역매핑 183 · 구조 45 · 글루접두 15
        │
        ├── hwpVocab.ts ──────────► census-math-tokens.ts   (세는 쪽)
        │                     └──► renderPostfixRules.ts   (고치는 쪽)
        └── measure-hwp-latex-residue.py                    (재추출 성적표)
```

### 정본을 그대로 믿어도 샌다

`SYMBOL_MAP` 은 `\le`·`\leq` → `LEQ` **한 방향**이라 역매핑 키가 `LEQ` 뿐이다.
HWP 가 실제로 쓰는 짧은꼴 `le`·`ge` 는 역매핑에 없어 **토큰째 흘러나간다**
(`hwpeq_to_latex._P.atom` 의 `v`/`low`/`up` 조회가 전부 빗나감).

그래서 정본 어휘와 **별도로**, 목록에 기대지 않는 발견기를 만들었다:
`census-math-tokens.ts` 의 `bareRuns` 는 수식 안 «두 글자 이상 영문 덩어리»를
**전부** 세고 빈도순으로 늘어놓는다. 무엇이 잔재인지 미리 정하지 않는다.
`le`(208) · `vert`(211) · `CENTIGRADE`(30) · `sinx`(108) 이 그렇게 나왔다.

---

## 2. 계량기를 고친 것 — 숫자가 틀렸던 자리 셋

**(1) 화면과 다른 방식으로 그리고 있었다.**
기존 `measure-katex-unknown.ts` 는 **DB 원문**을 우리 QA 옵션(`trust` 허용)으로
그렸다. 그런데 화면은 `decodeHtmlEntities → preprocessMathText → rehype-katex(옵션 없음)`
이다. 그래서 **우리 전처리가 스스로 만들어 넣는** `\htmlClass` 붉은 글씨를 구조적으로
못 봤다. 새 계량기는 화면 파이프라인을 그대로 태운다.

**(2) 붉은 명령 집계가 통째로 오귀속이었다.**
KaTeX 출력은 `katex-mathml`(원문 TeX 전체가 든 주석) + `katex-html`(보이는 조판)이다.
붉은 조각을 원문에서 찾으면 그 식의 **모든 명령**이 범인 명단에 오른다 — 1차 측정에서
`\displaystyle`(우리 전처리가 거의 모든 span 에 넣는다)이 **1,345건으로 1위**였다.
전부 오귀속이었다. 이제 보이는 조각에서만, 그것도 **붉은 조각이 명령 이름 하나 그
자체일 때만** 지목한다. 짝 없는 중괄호 같은 구조 오류는 원문 전체가 한 덩어리로
붉어지므로 `(구조오류)` 로만 센다.

**(3) 붉은 span 을 행 단위로 세고 있었다** — 671 = 671 로 같은 숫자가 나왔다.

---

## 3. 고친 것 — 표본을 **전량** 눈으로 보고 정했다

문항 의미를 바꾸지 않는 것만 옮기고, 애매하면 손대지 않고 목록으로 남겼다.

### 3.1 붉은 글씨 (KaTeX 가 못 그리는 명령)

| 규칙 | 전 span/행 | 후 | 근거 |
|---|---|---|---|
| `\overarc{AB}` → `\overset{\frown}{AB}` | 80/66 | 0 | 정본 `ACCENT_MAP` 이 `\overarc ↔ arch` 로 맵을 둬 역변환이 내놓는데 **KaTeX 에 그런 명령이 없다** |
| `\cm` → `\mathrm{cm}` | 29/7 | 0 | 단위가 명령이 돼 버린 것 |
| `\A`·`\B`·`\O`·`\ABCD` … → 백슬래시만 제거 | ~100/~60 | 0 | 점 라벨·기댓값 `E(X)`·분산 `V(X)`. **렌더가 모르는 명령일 때만** 뗀다 — `\Delta`·`\Re`·`\S` 는 그대로 |
| `\leftvert`/`\rightvert` → `\left\vert`/`\right\vert` | 10/8 | 0 | `LEFT vert` 가 한 낱말로 붙은 잔재 |

명령 목록을 손으로 만들지 않았다. `isUnknownCommand` 가 **실제로 렌더해서** 판정한다.

### 3.2 조용히 틀리게 그려지는 글자 (KaTeX 가 에러로 안 본다)

| 규칙 | 전 span/행 | 후 | 눈으로 본 범위 |
|---|---|---|---|
| `le`·`ge` → `\leq`·`\geq` | 630/약 380 | 2/1 | **분해되는 덩어리 87종 전량** |
| 맨 함수 이름 `sin cos tan sec csc cot log ln` | 약 700/약 480 | 7/5 | **뒤가 영숫자가 아닌 82곳 전량** |
| `vert` → `\vert` | 211/136 | 0 | **서로 다른 모양 158종 + 붙은 것 14종 전량** |
| 소문자 `times` → `\times` | 43/16 | 20/4 (남은 것은 통째 미변환 행) | **36 span 전량** |
| 맨 그리스 이름 → `\theta` 등 | 42/18 | 0 | 전량 |
| `LEQ`/`GEQ`/`NEQ` → `\leq`/`\geq`/`\neq` | — | — | 짧은꼴보다 **먼저** 처리(안 그러면 `leq`→`\leq q`) |
| `CENTIGRADE`/`FAHRENHEIT` → `^\circ\mathrm{C}`/`F` | 30/8 | 0 | 전량 |

### 3.3 붉지도 않고 아무 지표도 안 울린 것 — `\P`

KaTeX 는 `\P` 를 **성공적으로** ¶(문단기호)로 그린다. 그런데 이 말뭉치의 `\P` 23곳은
**전량이 확률 P(…) 아니면 점 라벨 P** 였다. 지면에는 `¶(1≤Y≤4)=3/8` 이 찍히고 있었다.
**렌더로 판정하는 계량기로는 영원히 안 잡히는 부류다.**

그래도 무턱대고 바꾸지 않았다 — 본문과 독립인 근거를 하나 요구한다:
① 바로 뒤가 `(`·`\left(` (¶ 는 함수 적용을 못 한다), 또는
② 같은 행에 백슬래시 붙은 «모르는» 대문자 라벨이 이미 있다(`\A`·`\O`).
둘 다 아니면 손대지 않고 `text-symbol-command` 로 남긴다.

---

## 4. 3단 방어를 UI 가 타게 할 것인가 — **연결해야 한다. 다만 3단 방어는 아니다**

### 4.1 지금 무슨 일이 벌어지고 있나

```
DB content
   └ decodeHtmlEntities → preprocessMathText
         └ uprightGeometryLabels  →  \htmlClass{geom-arc-wrap}{\mathrm{AB}}   (호 ⌒)
         └ repeatDotTex           →  \htmlClass{repeat-dot}{3}                (순환마디 점)
   └ react-markdown + remark-math + rehypeKatex()      ← ⚠️ 옵션을 하나도 안 넘긴다
         └ KaTeX: trust 없음 → HTML 확장 거부
              → **예외가 아니라 color:#cc0000 붉은 글자로 그린다**
```

**우리 전처리가 만든 글자를 우리 렌더가 거부한다.** 실측 문항 320행 · 수식 787곳.
원장님이 본 `0.\htmlClass\htmlClass이 되었고` 가 정확히 이것이다(순환마디 점 두 개).

`renderKatexSafe`(3단 방어)는 `trust` 를 넘기므로 이 문제가 없다. 그런데 그 함수는
**UI 가 한 곳도 안 탄다** — `src/lib/testchanger/mathRenderQa.ts` 와 QA 스크립트만 쓴다.

### 4.2 권고 — `trust` 만 연결한다. 3단 방어 전체는 옮기지 마라

`src/lib/math/katexRender.ts` 에 **`UI_KATEX_OPTIONS` 를 내어 두었다**(테스트 포함).
`MarkdownRenderer` 소유 세션이 할 일은 두 줄이다:

```ts
import { UI_KATEX_OPTIONS } from "@/lib/math/katexRender";
const REHYPE_PLUGINS: PluggableList = [[rehypeKatex, UI_KATEX_OPTIONS]];
```

실측으로 확인했다 — `trust` 하나면 붉은 글씨가 사라지고 `repeat-dot`·`geom-arc-wrap`
클래스도 살아남는다. `strict:false` 는 콘솔 경고만 없앤다.

**3단 방어(`renderKatexSafe`)를 UI 로 옮기는 것은 권하지 않는다.** 위험이 이득보다 크다:

| 위험 | 내용 |
|---|---|
| 렌더 경로가 둘로 갈린다 | 3단 방어는 **문자열 HTML** 을 만든다. 화면은 react-markdown 의 hast 트리다. 둘을 붙이려면 `dangerouslySetInnerHTML` 이 필요하고, 그러면 `<보기>` 상자·선택지 분해 등 마크다운 레이어가 통째로 빠진다 |
| 이중 전처리 | `renderKatexSafe` 는 안에서 `cleanMalformedLatex` 와 `$` 제거를 또 돈다. `MarkdownRenderer` 가 이미 `preprocessMathText` 를 돌린 뒤라 같은 변환이 두 번 걸린다 |
| 성능 | `MarkdownRenderer` 는 문제은행 20카드·검수 30문항·인쇄 지면이 모두 지나가는 목이고, 캐시·`React.memo`·모듈 스코프 상수로 조율돼 있다(파일 머리 주석). 렌더 경로를 바꾸면 그 전제가 깨진다 |
| 회귀 잠금 | `renderParity.test.tsx` 가 출력 HTML 을 글자 단위로 잠근다. 경로 교체는 그 잠금을 통째로 갱신해야 한다 |
| 얻는 것이 작다 | 3단 방어가 추가로 주는 것은 «그래도 붉으면 회색 `.math-raw` 로 강등» 뿐이다. 지금 붉은 619행 중 **320행은 `trust` 로 사라지고**, 나머지 304행은 구조가 무너진 행이라 회색으로 바뀔 뿐 읽히지는 않는다 |

**대신 권하는 것**: `trust` 연결 + 붉은 글씨가 다시 새면 **테스트가 실패하게** 만들 것.
`uiKatexOptions.test.ts` 가 "전처리는 `\htmlClass` 를 만든다 / 옵션 없이 그리면 붉다"를
이미 잠갔다. `renderParity.test.tsx` 옆에 «렌더 결과에 `#cc0000` 이 없다» 를 한 줄
더하면 이 부류는 다시 침묵하지 못한다.

### 4.3 ⚠️ 이 연결이 **먼저** 와야 하는 후속 수리가 있다

`0.dot7`(순환소수) 같은 잔재 **205 span · 58행**을 지금 안 고쳤다. 고치면
`\dot{7}` → 전처리가 `\htmlClass{repeat-dot}{7}` 로 바꾸고 → **지금 UI 에서는 붉어진다.**
지금은 이탤릭 `dot7` 로 나가고 있으니, 고치는 것이 오히려 지면을 **더 나쁘게** 만든다.
`trust` 가 연결된 뒤에 적용할 것.

(`\overarc` 66행은 다르다. 고치기 **전에도** 붉은 `\overarc` 였고 고친 뒤에도 붉은
`\htmlClass` 라 지면이 나빠지지 않는다. 그래서 지금 적용했고, `trust` 연결과 동시에
정상적인 교과서 호 ⌒ 로 그려진다.)

---

## 5. 손대지 않고 남긴 것 (후속 과제)

| 사유 | 행 수 | 무엇인가 |
|---|---|---|
| `wholesale` | content 59 · solution 4,471 | **변환기를 통째로 안 거친 행.** `1 over {2}`·`{BOX{~1.~}}`·`LEFT (`·`cdots` 가 날것이다. 키워드 치환으로 못 살린다 — 재추출이 답이다 |
| `(구조오류)` | 304 | 짝 없는 중괄호·`#` 구분자. `-\sqrt{` 처럼 식이 잘려 있다 |
| `lege-upper-label` | solution 36 | 전부 대문자 덩어리 — `\angle GEF`·`CGE`·`GECF` 처럼 기하 라벨과 구분이 안 된다 |
| `glued-function` | 20 | `asin3x` — 계수 `a·sin3x` 인지 변수 이름의 일부인지 못 가른다 |
| `text-symbol-command` | 소수 | 근거 없는 `\P`·`\S` |
| `dot` 순환소수 | 58 | §4.3 — `trust` 연결 **후에** 적용 |
| `CLSUB`/`LSUB` | 30 | HWP 좌첨자 조합 `C LSUB 10 _1` = ₁₀C₁. 구조 변환이라 규칙으로 못 한다 |
| `JLM`/`HK` | 43 | 절댓값 구분자가 깨진 듯한 정체불명 잔재. 원본 대조 필요 |
| base64 오염 행 | 소수 | `audit-base64-contamination.ts` 소관. 규칙들이 전부 비켜 가도록 확인함 |

---

## 6. 실제로 저지른 실수와 그 교훈

### 6.1 `\overline{GE}` 를 `\overline{\geq }` 로 만들었다 (2행, 되돌림)

`GE` 를 부등호로 읽었다. 원인이 둘이었다.

1. **`\overline` 계열이 보호 목록에 없었다.** 도형 오버레이의 인자는 항상 점 라벨이다.
2. **보호 정규식이 `[^{}]*` 라 `\mathrm{\overline{GE}}` 를 아예 못 봤다** —
   보호가 새는 줄도 모르고 있었다. 중괄호 한 겹 중첩까지 보게 고쳤다.

### 6.2 content 만 보고 정한 규칙이 solution 에서 `∠GEF` 를 부수려 했다

`content` 의 `le`/`ge` 후보 87종을 전량 확인하고 「전부 부등호였다」고 결론냈다.
그 규칙을 `solution` 에 돌리니 `∠GEF` → `∠\geq F`, `∠FGE` → `∠F\geq ` 가 나왔다.
`solution` 에는 `\angle GEF`·`CGE`·`GECF`·`AGE`·`BGE` 가 있었다 — content 에는 없던 모양이다.

> **컬럼이 다르면 데이터가 다르다. 적용할 컬럼마다 전량을 봐야 한다.**
> 다행히 `solution` 은 적용 전이었다. `content` 는 이미 적용한 뒤라 로그를 되짚어
> 감사했고, 그래서 6.1 의 2행을 찾았다.

### 6.3 `ln` 145곳 중 3곳은 자연로그가 아니었다

`n(ln)2` · `y=ln` · `\dfrac{ln+1}{l_{n}}` — 전부 수열 `l_n` 이다.
`ln` 만 «뒤에 영숫자가 올 때» 로 좁혔다. 다른 함수와 통일한다고 이 lookahead 를
떼면 문항의 뜻이 바뀐다(코드에 경고를 박아 뒀다).

### 6.4 `vert` 는 **앞뒤 어느 쪽에도** 영문자 금지를 걸면 안 됐다

뒤를 막으니 `vertZ`·`vertf(x)vertdx` 44곳이 빠졌고, 앞을 막으니 **닫는 쪽** `vert` 가
빠져 `\vert avert` 라는 반쪽 수리가 나왔다. 절댓값은 원래 피연산자에 붙는다.
막아야 하는 것은 영문자가 아니라 **LaTeX 명령**(`\vert`·`\lvert`·`\rvert`)뿐이었다.
`over`·`DIVIDE` 때와 **정확히 같은 함정**이다.

---

## 7. 되돌리기

`scripts/qa/reports/` 는 gitignore 라 워크트리를 지우면 사라진다. 그래서
**추적 경로에 압축 사본**을 두었고, 적용기가 `.gz` 를 직접 읽는다(실행 확인함).

```bash
ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --revert \
  --log docs/planning/tracks/reports/h-content-applied-pass1.json.gz
```

| 사본 | 대상 | 행 |
|---|---|---|
| `h-content-applied-pass1.json.gz` | content 1차 | 1,128 |
| `h-content-applied.json.gz` | content 2차 (vert·greek) | 57 |
| `h-answer-applied.json.gz` | answer | 17 |
| `h-solution-applied.json.gz` | solution | 504 |
| `h-content-revert-overline-ge.json.gz` | §6.1 되돌린 2행 | 2 |

되돌리기도 적용과 같은 규율이다 — **지금 값이 `after` 일 때만** `before` 로 돌린다.
저장소 밖 원본 사본은 `C:/Creative/testautocreator-data/H-수식잔재/` 에 있다
(census 전/후 JSON 포함).

---

## 8. 재현

```bash
python scripts/qa/build-hwp-vocab.py                    # 정본 어휘 재추출 (F: 드라이브 필요)
npx tsx scripts/qa/census-math-tokens.ts --samples      # 지면 기준 전수 census
npx tsx scripts/qa/apply-math-residue.ts --samples 40   # 드라이런 (기본)
ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/apply-math-residue.ts --apply
python scripts/qa/measure-hwp-latex-residue.py \
  C:/Creative/testautocreator-data/D-HWP/qa-reports/hwp-latex
```

재추출 산출물 성적표도 같이 고쳤다 — 종전 지표는 `le`/`ge` 를 **셀 수 없었다**.

```
문항 69,703 · 수식 span 678,433
잔재 span 4,805 (0.71%) · 잔재 문항 2,654 (3.81%)
1위 le/ge 2,396 · DIV 673 · sin 588 · cos 517 · dot 514 · log 242 · over 217
```

지표가 **자기 자신을 세던 것**도 막았다 — `\begin{cases}` 의 `cases` 가 6,919로
1위였다(환경 이름·점 라벨 인자를 가린다).

---

## 9. 원장님 확인이 필요한 것

1. **`MarkdownRenderer` 에 `trust` 연결** (§4.2). 이것 하나로 붉은 글씨 320행이
   사라지고, 호 ⌒ 와 순환마디 점이 설계대로 그려진다. 다른 세션 소유 파일이라
   여기서 하지 않았다.
2. **순환소수 `dot` 58행** (§4.3) — `trust` 연결 후 적용할지.
3. **통째 미변환 행** (content 59 · solution 4,471) — 재추출 대상으로 넘길지.
4. 인쇄 관련 변경은 **실물 프린터 출력 검수까지가 완료 조건**(CLAUDE.md 절대규칙 6).
   이 트랙은 본문 글자를 바꿨으므로 지면 검수가 필요하다.
