# 그림 인쇄 크기 트랙 — 보고서

> 워크트리 `그림인쇄` · 브랜치 `feat/figure-print-size` · 2026-08-19
> 지시서: `docs/planning/tracks/brief-figure-print-size.md`
> 배경: `docs/planning/tracks/figure-quality-brief.md` §9 · §13 · §14

## 0. 한 줄

**지면이 그림 크기를 «픽셀»이 아니라 «물리 크기(mm)»로 정할 수 있게 만들었다.
값이 없으면 오늘과 한 픽셀도 다르지 않다.** 값을 회수하는 일은 `그림벡터` 트랙 몫이고,
DB 컬럼 마이그레이션은 **만들었지만 적용하지 않았다**(공유 DB).

🔴 **완료가 아니다.** 인쇄 지면이 바뀌는 변경이라 절대 규칙 6 — 원장님이 실물 프린터로
보시고 `/dev/print-check` 의 `status` 를 바꾸실 때까지 미결이다. 여기서 「완료」를
선언하지 않는다.

---

## 1. 무엇이 문제였나

`printOverflow.ts` 의 그 한 줄이 전부였다:

```ts
const scale = figure ? Math.min(1, figureMaxWidth / figure.width) : 1;
```

즉 **「픽셀 폭이 264.567(=70mm)을 넘으면 70mm 로 줄이고, 아니면 픽셀 그대로(96dpi)」**.
**「얼마로 그린다」가 없다.**

- 원본 가로 픽셀이 **41 ~ 7,343px**(중앙 425) — 같은 삼각형이 문항마다 다른 크기다.
- 그리고 다른 트랙이 300dpi 로 다시 자르면 **지금 200px 인 그림이 600px 이 되어
  264 를 넘고 70mm 로 «확대»된다.** 자르기만 고치면 지면이 통째로 달라진다.

원장님 지시(2026-08-19): 「모든 그림이나 도형 크기가 **일관성이 있어야** 하니까」.

---

## 2. 무엇을 했나

### 2.1 물리 폭을 어디에 두나 — **DB 컬럼**(`problem.figure_source_mm`)

지시서가 준 셋 중에서 골랐다. 근거:

| 후보 | 왜 안 골랐나 / 골랐나 |
| --- | --- |
| **별도 컬럼** ✅ | 넘침 판정(`assessOverflowRisk`)은 **브라우저에서** 돈다. 미리보기를 그리기 전에 경고를 내야 하므로 그 시점에 파일도 대장도 못 읽는다 — `figure_dims` 가 컬럼인 이유와 **같은** 이유다. 그리고 `choice_figure_index`(2026-08-18)와 같은 규약의 형제가 된다 |
| `figure_dims` 확장 | 길이 검사(`flat.length !== figureCount * 2`)가 조용히 무너진다. 그 검사가 「짝이 어긋난 값을 안다고 착각하지 않게」 막는 **유일한** 가드다 |
| 별도 대장(JSON) | 서버 컴포넌트에서만 읽힌다. 문제은행·검수는 API 라우트로 문항을 받으므로 각자 이어 붙여야 하고, **한 곳만 빠뜨리면 화면과 지면이 다른 크기**로 그린다 |

형식: `figure_urls` 와 **같은 순서·같은 길이**의 `DOUBLE PRECISION[]`, 단위 **mm**.

- 담는 값은 **원본 크기**이지 인쇄 폭이 아니다. 70mm 상한은 **제품 정책**이라
  `figurePrintWidthMm` 이 인쇄 시점에 건다. 측정값과 정책을 같은 칸에 담으면
  정책이 바뀔 때 측정값이 이미 잘려 있어 되돌릴 수 없다.
- **정수 1/100mm 도 검토했다가 버렸다.** 형제 컬럼이 `Int[]` 라 결은 맞지만, 단위를
  외워야 하는 인코딩이 하나 늘고 **착오의 방향이 나쁘다** — 70(mm)을 그대로 적으면
  0.7mm 가 되어 그림이 지면에서 사라지는데 아무 오류도 안 난다. 실수 mm 로 두면
  반대 착오(7000)가 210mm 상한에 걸려 **«모른다»로 안전하게 미끄러진다.**

### 2.2 규칙을 한 곳에 — `src/lib/figurePrintSize.ts`

mm→px 환산 · 70mm 상한 · 손상 판정 · 인라인 style 문자열이 전부 여기 있다.
**자(`estimateFigureBlockPx`)와 지면(`ProblemContent`)이 이 파일의 같은 함수를 부른다.**

```
parseFigureDimensions(figureCount, figureDims, figureSourceMm)
   → 자:   estimateFigureBlockPx → figurePrintWidthPx
   → 지면: figureWidthStyle → style={{ width: "40.00mm" }}
```

배선: `problem.figureSourceMm` → `TestPrintProblem` → `ProblemBody` →
`PaperProblemView` → `ProblemContent`, 그리고 `assessSeat`(넘침 판정).

**상한은 mm 에서 건다.** 픽셀에서 걸면 지면 CSS(mm)와 자(px)가 서로 다른 지점에서
잘려 조용히 어긋난다.

**인라인 style 은 Tailwind 를 이긴다**(지시서 경고). 그래서 ㉠ mm 를 모르면 style 을
**아예 안 만들고**(React 가 속성 자체를 안 붙인다 — 마크업이 오늘 그대로), ㉡ 만들 때도
값 자체를 70mm 로 잘라 CSS 상한 한쪽만 믿지 않는다. `print:max-w-[70mm]` 클래스는
**그대로 남겼다** — mm 를 모르는 그림이 같은 지면에 섞이고, `max-width` 는 인라인
`width` 도 이겨 이중 안전망이 된다.

### 2.3 「모르면 오늘 그대로」를 어떻게 **보였나** (회귀 0)

말이 아니라 대조로 보였다.

1. **옛 구현을 테스트 안에 얼려 두고** 폭 20~3,000px 전수(426개)를 대조했다.
   제품 함수를 부르지 않는 사본이다 — 부르면 동어반복이 된다.
   결과 **전량 일치**(차이 < 1e-9). `printFigureHeight.test.ts`
2. 여러 장·모르는 장이 섞인 조합 4가지도 같은 방식으로 일치.
3. 컴포넌트: mm 가 없으면 `<img>` 에 `style` 속성이 **아예 없다**(`getAttribute("style") === null`).
4. `mm` 배열이 손상돼도 **치수는 살아남는다** → 그 그림은 오늘 그대로 픽셀로 나간다.

### 2.4 못 갈라지는 것은 **양쪽이 같이** 모르게 했다

**치수(픽셀)를 모르면 mm 도 버린다.** 비율을 모르면 높이를 못 재는데 폭만 mm 로 좁혀
잡으면 그림 둘이 한 줄에 들어간 것으로 계산돼 **높이가 줄어든다** — 과소평가는 곧
놓침이고, 놓침은 겹쳐 찍힌 시험지로 간다. 지면 컴포넌트도 **같은 함수**를 부르므로
자와 지면이 **같이** 모른다. (변이 시험이 이 자리를 지킨다.)

---

## 3. 실측 — **실제 브라우저에서** 자와 지면을 맞대 봤다

`/dev/figure-print-size` 를 띄우고 Chromium **인쇄 매체**로 잰 값이다.
(`/figures/**` 는 미들웨어가 로그인 없이 307 로 막아, 측정할 때만 Playwright 가
디스크의 파일을 물려 줬다. 제품은 안 건드렸다.)

### 3.1 그림 폭 — 규칙이 실제로 갈리는가

| 그림 | 원본 px | **지금** 그려진 폭 | **새 규칙** 그려진 폭 |
| --- | ---: | ---: | ---: |
| `/figures/2065/hwp-q04.png` | 68×72 | 68.00px (18.0mm) | 32.64px (8.6mm) |
| `/figures/1731/hwp-q05.png` | 121×89 | 121.00px (32.0mm) | 58.08px (15.4mm) |
| `/figures/1557/hwp-q03.png` | 220×186 | 220.00px (58.2mm) | 105.59px (27.9mm) |
| `/figures/2248/q01.jpeg` | 300×363 | 264.56px (70.0mm) | 144.00px (38.1mm) |
| `/figures/1622/q06.png` | 500×268 | 264.56px (70.0mm) | 240.00px (63.5mm) |
| `/figures/2027/q09.jpeg` | 900×751 | 264.56px (70.0mm) | 264.56px (70.0mm) |

⚠️ **새 규칙 쪽 mm 는 가정값이다**(§5.2). 규칙이 갈리는 모양을 보이는 값이지
그 그림이 실제로 몇 mm 인가에 대한 답이 아니다.

**덤으로 드러난 것**: 화면 매체와 인쇄 매체를 따로 쟀더니, mm 를 아는 그림은
**둘이 같은 크기**였다(32.64 / 58.08 / 105.59 / 144 / 240 / 264.56 — 완전히 동일).
지금 규칙은 화면 상한이 `sm:max-w-[360px]`(=95mm), 인쇄 상한이 70mm 라 큰 그림에서
**화면과 지면이 다르다**(300px 짜리가 화면 300px · 지면 264.56px). mm 를 알면
그 차이가 사라진다.

### 3.2 자 vs 지면 — **최대 어긋남 0.020px**

브라우저가 그린 그림 묶음의 실제 높이와 `estimateFigureBlockPx` 의 값을 맞댔다.

| 그림 | 자(옛) | 지면(옛) | 자(새) | 지면(새) |
| --- | ---: | ---: | ---: | ---: |
| 68×72 | 84.00 | 84.00 | 46.56 | 46.55 |
| 121×89 | 101.00 | 101.00 | 54.72 | 54.70 |
| 220×186 | 198.00 | 198.00 | 101.28 | 101.27 |
| 300×363 | 332.13 | 332.11 | 186.24 | 186.23 |
| 500×268 | 153.81 | 153.80 | 140.64 | 140.63 |
| 900×751 | 232.77 | 232.75 | 232.77 | 232.75 |

**최대 어긋남 0.020px** (브라우저의 소수 반올림). 옛 규칙에서도 새 규칙에서도 같다 —
자가 재는 지면이 실제 지면이라는 뜻이다.

---

## 4. 변이 시험 — 가드가 장식이 아닌지

재현: `node scripts/qa/mutate-figure-print-size.mjs`

**변이 20개 · 잡힘 18 · 동치 2 · 안 잡힌 것 0.**

| 변이 | 무엇을 잃는가 | 결과 | 잡은 검사 |
| --- | --- | --- | --- |
| 상한을 70 → 100mm | 그림이 문항 열을 넘어 옆 칸을 침범한다 | 🟢 빨강 | figurePrintSize · printFigureHeight · problemFigures |
| mm→px 를 96 대신 72(pt)로 | 모든 그림이 25% 작게 인쇄된다 — 지면에서 티가 안 난다 | 🟢 빨강 | figurePrintSize · printFigureHeight |
| 인쇄 폭 상한을 min → max | 150mm 짜리가 그대로 나가 지면을 뚫는다 | 🟢 빨강 | figurePrintSize · printFigureHeight · problemFigures |
| mm 를 알아도 원본 픽셀보다 크게는 안 그린다 | 작은 그림이 안 커진다 — 일관성이 반쪽만 생긴다 | 🟢 빨강 | printFigureHeight |
| mm 배열 길이 검사를 뺀다 | 짝이 어긋난 mm 가 엉뚱한 그림에 붙는다 | 🟢 빨강 | figurePrintSize · printFigureHeight · problemFigures |
| 물리적 경계(1~210mm)를 뺀다 | 1/100mm 단위 착오(7000)가 들어와 그림이 0.7mm 로 사라진다 | 🟢 빨강 | figurePrintSize |
| `Number.isFinite` 를 뺀다 | (동치) 경계가 이미 NaN·무한대를 걷어낸다 | ⚪ 동치 | — |
| `typeof value === "number"` 를 뺀다 | (동치) 옆줄 `Number.isFinite` 가 문자열을 이미 막는다 | ⚪ 동치 | — |
| **숫자 검사 둘 다** 뺀다 | 대장 JSON 의 `"40"` 이 경계를 통과해 `toFixed` 에서 터진다 — 인쇄 화면이 죽는다 | 🟢 빨강 | figurePrintSize |
| 치수를 몰라도 mm 는 살린다 | 자는 «모른다»로, 지면은 mm 로 그려 둘이 갈라진다 | 🟢 빨강 | printFigureHeight · problemFigures |
| `parseFigureDimensions` 가 mm 인자를 무시한다 | 규칙만 고치고 배선이 끊긴 상태 | 🟢 빨강 | printFigureHeight · problemFigures |
| 인라인 style 에서 상한을 뺀다 | `width: 150mm` 이 나가고 CSS 상한 한쪽만 남는다 | 🟢 빨강 | figurePrintSize · problemFigures |
| 모를 때 style 을 `0mm` 로 만든다 | mm 를 모르는 그림이 지면에서 사라진다 | 🟢 빨강 | figurePrintSize · problemFigures |
| 자가 줄 접기에 원본 픽셀 폭을 쓴다 | 지면은 나란히 놓는데 자는 두 줄로 세서 헛경고가 는다 | 🟢 빨강 | printFigureHeight |
| 판정이 문항의 `figureSourceMm` 을 안 읽는다 | DB 에 값이 와도 판정만 옛 크기로 잰다 | 🟢 빨강 | printFigureHeight |
| 지면이 인라인 style 을 안 붙인다 | 자만 mm 로 재고 지면은 옛 크기 | 🟢 빨강 | problemFigures |
| `print:max-w-[70mm]` 클래스를 뗀다 | mm 를 모르는 그림이 화면 크기(95mm) 그대로 인쇄된다 | 🟢 빨강 | problemFigures |
| `PaperProblemView` 가 mm 를 안 넘긴다 | 인쇄 지면만 옛 크기 — 화면에선 안 보이는 회귀 | 🟢 빨강 | problemFigures |
| `ProblemBody` 가 mm 를 안 넘긴다 | 정확히 인쇄 경로에서만 값이 끊긴다 | 🟢 빨강 | problemFigures |
| `ProblemBody` 가 `figureDims` 를 안 넘긴다 | 치수를 모르면 mm 도 버리는 규칙 때문에 mm 가 통째로 죽는다 | 🟢 빨강 | problemFigures |

### 🔴 여기서 배운 것 — **겹친 가드는 하나씩 빼서는 못 잰다**

`typeof value === "number"` 와 `Number.isFinite(value)` 는 **서로를 덮고 있다**
(`Number.isFinite("40")` 는 강제 변환을 안 해 false 다). 그래서 하나씩 빼면 동작이
한 톨도 안 바뀌고 **둘 다 초록**이다. 처음에는 그걸 「가드 없음」으로 읽고 쓸데없는
검사를 만들 뻔했다. **같이 빼니** 문자열 `"40"` 이 경계(`>= 1 && <= 210`)를 통과해
`figureWidthStyle` 의 `toFixed` 에서 터졌다 — 인쇄 화면이 죽는 자리다. 그 부류를
잠그는 검사를 새로 넣고 나서야 빨개졌다.

그래서 하네스가 **「동치」를 따로 센다.** «잡았다»에 섞으면 통과율이 부풀고,
«안 잡힘»에 섞으면 다음 사람이 없는 결함을 좇는다.

---

## 5. 전후 비교 지면 — `/dev/figure-print-size`

같은 문항 여섯을 **지금 규칙 / 새 규칙**으로 각각 실제 인쇄 템플릿(`JaseupTemplate`)에
그려 나란히 놓는다. 그림은 `public/figures` 의 **실제 파일**이고 폭 68~900px 로 골랐다.

- 화면 갈무리(**인쇄 매체**): `docs/design/mockups/figure-print-size-print.png`
  — 서버를 안 띄워도 볼 수 있게 남긴다. 화면 매체 갈무리는 안 남겼다(§3.1 대로
  mm 를 아는 그림은 화면과 인쇄가 같은 크기라 두 장을 남길 이유가 없다).
- 표로 「원본 px · 지금 인쇄 폭 · 새 인쇄 폭 · 배율」을 같이 찍는다.

### 5.1 「지금 규칙」 쪽은 **흉내 내지 않았다**

옛 코드를 베끼지 않고 **같은 컴포넌트를 mm 없이** 부른다. 흉내가 남아 있으면
갈라져도 아무도 모른다(CLAUDE.md 2026-08-18 「분모를 먼저 검산하라」).

### 5.2 ⚠️ 그 화면의 mm 는 **가정값이다 — 실측이 아니다**

실측 원장(`scripts/qa/reports/figure-rect-ledger.json`)이 아직 없어서, 「우리가 200dpi 로
잘랐다」는 기록(`crop-rpm-from-pdf.py` `DEFAULT_DPI = 200` · `extract-all-figures.py`
`CLIP_DPI = 200`)에서 `픽셀 / 200 × 25.4` 로 환산했다.

**전량에 맞는 값이 아니다.** 같은 추출기에 「네이티브 이미지 추출(xref)」 경로가 따로
있고 그쪽은 픽셀이 원본에 박힌 이미지의 픽셀이라 200 으로 나누면 틀린다. **두 경로의
비율은 아직 안 쟀다**(화질 브리프 §15 — 계수기가 값을 올리기만 하고 안 찍는다).
화면에도 그렇게 적어 두었다. 원장 파일이 생기면 화면이 자동으로 실측으로 바뀐다.

### 5.3 이 가정 아래 보이는 것 — **대부분의 그림이 작아진다**

상한 아래 그림은 일률적으로 **×0.48**(=96/200)이 된다. 지금 규칙이 200dpi 크롭을
96dpi 로 읽어 **약 2.08배 확대**해 왔다는 뜻이다. 상한에 걸리던 큰 그림은 ×0.54~×1.00.

🔴 **이건 원장님이 종이로 보시고 정하실 일이다.** 「작아진 그림의 글자·눈금이
읽히는가」가 합격 조건이고, `/dev/print-check` 의 볼 것 ②에 그대로 적었다.
가정이 틀렸다면(네이티브 추출본) 축소폭도 틀린다.

---

## 6. 🔴 못 한 것 · 막힌 것 · 못 잰 것

### 6.1 DB 는 **한 줄도 안 바꿨다** — 그리고 `schema.prisma` 도 안 건드렸다

- 마이그레이션 파일만 만들었다:
  `prisma/migrations/20260819120000_problem_figure_source_mm/migration.sql`. **적용 안 함.**
- `prisma/schema.prisma` 에도 **일부러 안 넣었다.** 인쇄 화면 질의가
  `include: { problem: true }`(스칼라 전량 SELECT)라, 스키마에만 먼저 넣고
  `prisma generate` 하면 **컬럼 없는 공유 DB 를 향해 `SELECT figure_source_mm` 을 쏴서
  인쇄가 통째로 죽는다.** 그래서 순서가 있다:

  1. 이 SQL 적용 (원장님 확인 뒤)
  2. `schema.prisma` 에 `figureSourceMm Float[] @default([]) @map("figure_source_mm")`
  3. `npx prisma generate`
  4. `src/app/(main)/tests/[id]/print/page.tsx` 의 문항 매핑에
     `figureSourceMm: item.problem.figureSourceMm` 추가

  **지금은 4번이 없다.** 그래서 실제 인쇄 화면은 아직 mm 를 못 받는다 — 지면 쪽이
  받을 준비만 됐다(지시서 §1: 「네가 할 일은 지면 쪽이 mm 를 받을 수 있게 만드는 것」).

### 6.2 화면(문제은행·검수)은 아직 mm 를 못 받는다

`serializeProblem`/`problem.contract.ts` 가 `figureDims`·`figureSourceMm` 을 안 싣는다.
넣으려면 API 계약을 바꿔야 하고, 그건 컬럼이 실제로 생긴 뒤에 하는 편이 안전하다.
**인쇄 경로는 계약 없이 서버 컴포넌트가 직접 넘기므로 먼저 열렸다.**
그동안 화면과 지면이 갈라지지 않는 이유는 **양쪽 다 mm 를 모르기 때문**이다 —
컬럼이 생기고 4번만 하면 그때부터 갈라진다. **§6.1 4번과 이 항목은 같이 해야 한다.**

### 6.3 도형 SVG(`figureSvg`)는 손대지 않았다

`ProblemContent` 의 SVG 갈래도 `print:max-w-[70mm]` 를 쓰지만 mm 를 안 받는다.
벡터라 해상도 개념이 없고, 크기 정본은 엔진의 `type_scale` 쪽에 있다(화질 브리프 §9).
**같은 규칙을 붙일지는 정하지 않았다** — 래스터와 다른 물건이라 함께 결정할 일이다.

### 6.4 못 잰 것

- **원본 물리 폭의 실제 분포.** 원장이 없어 못 쟀다. 그래서 받아들이는 범위
  (1mm ~ 210mm)는 **실측 문턱이 아니라 「물리적으로 가능한가」**만 본다.
  좁게 잡으면 진짜 작은 그림(치수 기호 같은 5mm 짜리)을 버리게 되므로,
  분포를 재기 전에 그럴듯한 문턱을 지어내지 않았다.
- **네이티브 추출 vs 200dpi 폴백 비율**(§5.2). 화질 브리프 §15 의 침묵하는 계수기 문제다.
- **실물 프린터 출력.** 절대 규칙 6 — 원장님 몫이다.
- **몇 건이 실제로 바뀌는가.** 지금은 **0건**이다(값이 없다). 값이 들어오면
  그림 문항 전량이 대상이 된다. 그 규모는 회수율이 정해져야 알 수 있다.

---

## 7. 검사

| 검사 | 결과 |
| --- | --- |
| `npm run test` | **135 파일 통과 · 1 건너뜀 / 2,165 테스트 통과 · 1 건너뜀** |
| `npm run type-check` | 통과 (`npx prisma generate` 선행 — 이 워크트리에 클라이언트가 없었다) |
| `npm run lint` | 오류 0 (경고 7 — 전부 이 트랙 밖의 기존 경고) |
| `npm run lint:affordance` | 통과 (D-30) |
| 변이 시험 | 20개 · 잡힘 18 · 동치 2 · **안 잡힘 0** |

새로 넣은 테스트: `figurePrintSize.test.ts`(28) ·
`printFigureHeight.test.ts`(+15) · `problemFigures.test.tsx`(+9).

**덤 — 남의 가드가 나를 잡았다.** `/dev/print-check` 에 항목을 더하자
`PrintCheck.test.tsx` 의 「항목 수가 바뀌면 알아차린다」가 18→19 로 빨개졌다.
「검수 잔고가 조용히 줄면 아무도 모른다」를 막는 가드다 — 숫자와 사유를 같이 고쳤다.

---

## 8. 다음 사람에게

1. **`그림벡터` 트랙 산출물**(`scripts/qa/reports/figure-rect-ledger.json`, 그림마다
   `width_mm`)을 DB 에 적재할 때 **`checkFigureSourceMm` 을 쓸 것.** 읽기와 달리
   한 자리만 손상돼도 배열째 막는다 — 공유 DB 에 굳기 전에 멈추는 쪽이 싸다.
2. 적재 전에 `/dev/figure-print-size` 를 다시 열면 **가정값이 실측으로 바뀐다**
   (원장 파일이 있으면 그걸 읽는다). 그 화면으로 원장님께 다시 보여 드릴 것.
3. `/dev/print-check` 의 `figure-print-size-mm` 항목은 **값이 들어오는 순간**
   실물 검수 대상이 된다. 그전에는 종이에 아무 변화가 없다.
4. 규칙을 고칠 일이 생기면 `scripts/qa/mutate-figure-print-size.mjs` 를 **먼저 돌려
   빨간지 확인**하고 고칠 것. 그리고 **겹친 가드는 묶어서** 빼 봐야 한다(§4).
