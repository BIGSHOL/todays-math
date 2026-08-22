# 09 — 도형 SVG 엔진 사용 지침 (testchanger figure engine)

> **작업 전 필독.** 2026-08-14 실제 사용에서 낸 오류를 전부 적어 둔다.
> 같은 실수를 반복하지 말 것. 새 오류를 만나면 §4에 추가한다.
> 초등(큐브) 그림은 **§2.1 · §4-6~4-13 · D-61**. 엔진이 정규화되지 않은 채로
> FigureSpec 일회성을 쌓지 말 것.

## 0. 위치와 진입점

엔진은 **저장소 안**에 있다 — `vendor/figure-engine/core/` (원장님 지시 2026-08-19
「엔진을 우리 프로젝트로 가져와. 계속 사용할거같으니까」). **이식하지 않고 그대로
호출**한다 — 「이식하지 않는다」는 **TypeScript 로 다시 쓰지 말라**는 뜻이고,
파이썬 원본을 저장소에 두는 것은 그 결정과 어긋나지 않는다.
SVG를 사전 생성해 문자열로 DB에 저장하는 방식이다.

가져온 것은 네 모듈뿐이다(`figure_svg` · `figure_scene` · `figure_solid` ·
`figure_quality`, 합 240KB). **제3자 의존이 없다** — 모듈 최상단은 표준 라이브러리만
쓰고, numpy·PIL 은 래스터 보조 함수 **안**에서만 불린다. `vendoredFigureEngine.test.ts`
가 그 성질을 잠근다(최상단에 올라오면 빨개진다).

⚠️ 경로 우선순위: `FIGURE_ENGINE_PATH`(있으면) → **저장소 안 vendor** → `F:\시험지변환기`.
원본 드라이브를 **마지막**에 두는 이유는 저장소가 정본이 되게 하려는 것이다 —
원본이 앞서면 두 벌이 갈라져도 아무도 모른다. 순서도 검사로 잠겨 있다.

⚠️ 종전에는 `F:\시험지변환기` 만 봤다. **그 드라이브가 없는 컴퓨터에서는 도형이
통째로 안 그려지는데, 실행해 봐야 드러났다.**

> ⚠️ **2026-08-19 정정.** 이 문서는 오래 `D:\시험지 한글화` 를 적어 두었으나 그 경로는
> **없다**(적대적 리뷰에서 드러남). 실제 위치는 위 경로다. 코드는 경로를 박지 않고
> `FIGURE_ENGINE_PATH` 환경변수를 먼저 본다 — 없으면 위 기본값.
> 「없다」를 적을 때는 무엇을 보고 없다고 했는지 함께 적을 것(CLAUDE.md 2026-08-18).

### 0.1 제품에서 부르는 길 (D-55, 2026-08-19)

AI 문제 변형이 도형을 **새로 그린다**. 사람이 파이썬을 직접 부르지 않는다.

```
AI(figureSpec v2 JSON)
  → src/lib/figure/renderFigureSpec.ts   (Node: 프로세스 하나 띄워 stdin/stdout)
  → scripts/figure/render_spec.py        (render_figure_spec + sanitize_svg)
  → Problem.figureSvg
```

**SVG 의 유일한 생산자는 서버다.** 미리보기에서 본 도형도 채택할 때는 **스펙으로**
되돌아와 서버가 다시 그린다 — 브라우저가 준 마크업을 저장하면 지면·화면에 남는
주입 통로가 된다. 스펙 검증은 **엔진이 정본**이고(허용 키 밖은 `FigureSpecError`)
TypeScript 쪽에서 다시 좁히지 않는다. 두 벌이 되면 갈라진다.

```python
import sys; sys.path.insert(0, r"F:\시험지변환기")
from core.figure_scene import compile_figure_spec   # 구조화 스펙 → 검증된 SVG
from core.figure_svg   import line, txt, circ, curve_path, arc, rangle, ...
from core.figure_solid import View                  # 3D 사방투영
```

| 모듈 | 역할 |
|---|---|
| `core/figure_scene.py` | **FigureSpec v2**(구조화 스펙) → 검증·렌더. LLM이 JSON만 내면 되는 안전 경로 |
| `core/figure_svg.py` | 2D 프리미티브(선·호·각도표시·치수선·곡선·라벨). 강력하지만 코드 작성 필요 |
| `core/figure_solid.py` | 공간도형(사방투영 `View`, 정투영 `Camera`, 평면·정사영) |
| `core/figure_quality.py` | 픽셀 린트 + `sanitize_svg`(보안 경계) |

## 1. 2계층 구조 — 어느 쪽을 쓸지 먼저 정한다

**계층 A — FigureSpec v2 (권장, LLM이 생성)**
평면도형·원 계열은 전부 여기서 해결된다. 스키마가 엄격해 잘못된 스펙은 **조용히 통과하지 않고 예외**가 난다.

허용 최상위 키: `version`(=2) · `theme` · `canvas` · `background` · `style` ·
`points` · `circles` · `segments` · `angles` · `dimensions` · `labels`

```python
spec = {
  "version": 2,
  "points": {"O": [0,0],
             "A": {"type":"on_circle","circle":"c","angle":60},
             "P": {"type":"intersection","segments":["AC","BD"]}},
  "circles": {"c": {"center":"O","radius":85}},
  "segments": {"AB": ["A","B"]},
  "angles": {"angA": {"vertex":"A","points":["B","D"],"label":"∠A"}},
  "dimensions": {"dimAB": {"points":["A","B"],"label":"10 cm","side":"auto"}},
  "labels": {"A":"A","B":"B"},
}
svg = compile_figure_spec(spec).render_svg()
```

**계층 B — 프리미티브 직접 조립**
FigureSpec v2에 **없는 것**: 곡선(함수 그래프)·입체도형·통계 그래프.
이때만 `figure_svg`/`figure_solid`로 f-string SVG를 조립한다.

```python
def wrap(w, h, body):
    return (f'<svg viewBox="0 0 {w} {h}" xmlns="http://www.w3.org/2000/svg">'
            f'<rect width="{w}" height="{h}" fill="#fff"/>{body}</svg>')
```

## 2. 실증 완료 — 중1~고1 전 범위 (2026-08-14 육안 검수)

| 계층 | 도형 |
|---|---|
| A (FigureSpec) | 맞꼭지각, 삼각형 작도(치수선), 정오각형 내각, 원·부채꼴 중심각, 이등변삼각형, 평행사변형, 사다리꼴, 피타고라스(직각기호), 삼각형 닮음, 삼각비, 원의 현, 원주각·중심각, 원에 내접하는 사각형, 원의 접선, 좌표평면·직선, 원의 방정식, 점과 직선 사이 거리, 도형의 이동, 수직선 |
| B (프리미티브) | 이차함수 포물선, 절댓값 그래프, 반비례 그래프, 일차함수, 히스토그램, 산점도, 상자그림 |
| B (`View` 사방투영) | 직육면체, 삼각기둥, 사각뿔, 정육면체 대각선, 원기둥, 원뿔, 구, 전개도 |

## 2.1 초등 그림 — `elem-1` (D-61, 2026-08-20~21 원장님 육안)

FigureSpec v2 에 **없는 것**: 수 모형, 수 카드, 연산 상자, 곱셈표, 분수 조각, 이름 붙은 도형 묶음.
큐브수학 초등 교재가 이 부류다.

### 어느 계층인가 — **먼저** 정한다

| 그림 | 계층 |
|---|---|
| 각·원·삼각형 **작도**(치수선, 꼭짓점 A·B) | 엔진 A · FigureSpec v2 |
| 초등 위젯(수 모형·표·시계·분수 색칠·가/나 묶음) | **`elem-1`** |
| 삽화·사진 | `figureUrls` 오림. SVG 로 만들지 않는다 |

**반복되면 kind 로 규칙화한다.** 문항마다 FigureSpec 좌표를 맞춰 라벨을 띄우면
다음 문항에서 같은 결함이 다시 난다(2026-08-21 무작위 3차: 가/나 라벨, 사다리꼴 대각선, 곱셈표 글자).
한 종류가 두 번 나오면 `scripts/figure/elementary.py` 에 kind 를 넣고 **불변식을 테스트로 잠근다.**

스펙은 `version: "elem-1"` + `kind`. 모르는 종류·허용 밖 키는 예외.
렌더는 `scripts/figure/elementary.py`. 호출은 같은 `render_spec.py` —
`sanitize_svg` 를 같이 통과한다. **v2 키에 초등 종류를 섞지 말 것**(엔진 A 가 즉시 거부한다).

| kind | 쓰는 곳 |
|---|---|
| `numberCards` | 숫자 카드 여러 장 |
| `placeValue` | 100·10·1 카드 묶음 |
| `base10` | 백·십·일 수 모형 |
| `opBox` | 위 수 → 연산 상자 → 빈칸. 숫자에 맞춘 폭 — 넓은 막대 금지 |
| `sumBox` | 두 칸 + 아래 빈 합 칸 |
| `opTree` | 가로 세 칸. 연산 타원이 칸과 칸 사이 위에 앉는다 |
| `boxChain` | 엑셀처럼 열 맞춘 계단 (`219 → +462 ↑ □ → +138 ↑ □`) |
| `columnOp` | 세로셈 (덧셈·곱셈). `highlight` 로 자릿값 칸 |
| `numberLine` | 수직선. `min`/`step`/`tick`/`blanks` 소수 눈금 |
| `clocks` | 아날로그 시계 한 개 이상 |
| `table` | 머리+행 표. **viewBox 폭 ≤240** — 칸만 줄인다 |
| `tape` | 길이 막대. 치수는 엔진 A `measured()`(점선 `6 4` + halo 라벨) |
| `dotGrid` | 점 배열 (묶음) |
| `boxedList` | ①②③ 목록 상자 |
| `pills` | 가로 알약 + 화살표 |
| `geoLine` | 양끝 화살표 직선 |
| `anglePick` | 각 찾기용 작은 도형 넷 |
| `timeAdd` | 시·분·초 세로셈 |
| `pointGrid` | 점격자. 찍힌 점에만 점·라벨. 격자 점선 `#c8d7e4` 0.7px |
| `divideTriangle` | 개수 상자 + 직각삼각형. 점선으로 나누기 힌트 |
| `fracPie` | 분수 원. 채움 `#e2b48a` · 나머지 `#f4efe6` · 흰 배경. 피자 오림 금지 |
| `triRow` | 삼각형을 한 줄로. `filled` 로 색칠 |
| `trapFour` | 이등변사다리꼴 = 합동인 직각삼각형 넷. 내부 점선 |
| `namedShapes` | 이름 붙인 도형 묶음. 라벨은 항상 도형 아래, 같은 행은 같은 높이 |
| `fracBars` | 분수×자연수 막대격자 |
| `barChart` | 막대그래프 |
| `lineChart` | 꺾은선그래프 |
| `pictograph` | 그림그래프. □ = N |
| `stripChart` | 띠그래프. pct 합 100 |
| `pieChart` | 원그래프. pct 합 100 |
| `protractor` | 각도기 눈금 읽기. 「재어 보세요」는 그리지 않는다 |
| `rotateFlip` | 돌리기·뒤집기 전후 쌍 |
| `symmetry` | 선대칭·점대칭 |
| `stackCubes` | 쌓기나무. voxels [x,y,z], views iso·top·front·side |
| `cuboid` | 직육면체 겨냥도. `View` 사방투영 |
| `prism` / `pyramid` | 각기둥·각뿔 |
| `cylinder` / `cone` / `sphere` | 원기둥·원뿔·구. 원뿔은 꼭대기→밑면 접선 + 보이는 호. 삼각형+타원 금지 |
| `netCuboid` / `netCylinder` | 전개도 읽기. 모눈에 그리기는 안 만든다. `netCylinder` 는 원이 직사각형 긴 변에 접한다 |
| `areaPoly` | 직사각·삼각·평행사변형·사다리꼴·마름모 넓이 |

### 불변식 (원장님 육안 2026-08-20~21 — 테스트가 지킴)

- **`table`**: viewBox 폭 ≤240 (`TABLE_VIEWBOX_MAX`). 열이 많으면 칸만 줄인다. 폭을 키우면 `[&>svg]:w-full` 때문에 숫자가 본문보다 작아진다.
- **`namedShapes`**: 라벨 y = 도형 아래 고정. 같은 행은 같은 높이. FigureSpec `labels` 는 점 옆에 붙어 높이가 제각각이다 — 쓰지 않는다.
- **`trapFour`**: 아랫변 3칸·윗변 1칸, 칸 한 변 = 높이. 조각 0 왼쪽 · 1 가운데 위 · 2 가운데 아래 · 3 오른쪽. 정점 6개(윗 2·아랫 4). **두 대각선 분할 금지**(위·아래 넓이 다름 → 분수 불가). **산 모양 이등변 넷을 나란히 놓지도 않는다**(원본은 한 도형).
- **`tape`**: `_length_mark` → `core.figure_svg.measured`. 손 곡선 금지.
- **`pointGrid`**: 격자 `#c8d7e4` 0.7px. `#7aa0c4` 1.05px 는 발문을 이긴다.
- **`fracPie`**: 교재 피자를 **오리지 않는다**(쪽 배경이 남는다).
- **`netCylinder`**: 밑면 원 둘은 옆면 직사각형의 **긴 변(둘레)** 에 접한다. 떠 있는 원 금지. 짧은 변(높이)에 붙이면 접을 수 없다. `layout` 은 `opp`·`oppFlip`·`oppMid`·`sameTop`·`sameBot`·`ends`.
- **`cone`**: 꼭대기에서 투영 밑면(타원)에 그은 두 접선이 모선. 보이는 호를 따라 옆면을 채운다. 숨은 호는 점선. 밑면 타원 채우기 + 세 점 삼각형 금지.
- **화면 폭**: 위젯 140px(viewBox ≤160), 중간 240px(≤320), 큰 도형 360px — `figureSvgFrame.ts`.

상수는 `elementary.py` 한 곳: `INK` `#111111` · `PAPER` `#ffffff` · `GRID` `#c8d7e4` · `GRID_SW` 0.7 · `TABLE_VIEWBOX_MAX` 240.


## 3. 호출 규약 — **틀리기 쉬운 시그니처**

```python
line(p, q, w=2, dash=None)     # ← 점 "튜플" 2개.  line((x1,y1),(x2,y2), w=1.8)
txt(x, y, t, fs=15, anc="middle", it=False)
circ(cx, cy, r, w=2)
curve_path(points, w=2, dash=None, close=False, fill="none")   # 점 리스트 → 곡선
View(depth_ratio=0.5, depth_deg=45, scale=60, origin=(200,200))  # 호출가능 객체
    view((x, y, z)) -> (sx, sy) ;  view.many([...]) -> [...]
```

## 4. 실제로 낸 오류 (재발 금지 목록)

### 4-1. `line()` 에 좌표를 4개로 펼쳐 넘김 ❌
```
TypeError: line() got multiple values for argument 'w'
```
`line(x1, y1, x2, y2, w=1.4)` 로 불렀다. **`line()`은 점 튜플 2개를 받는다.**
→ `line((x1, y1), (x2, y2), w=1.4)`

### 4-2. FigureSpec 이름 충돌 ❌
```
FigureSpecError: duplicate geometry name 'B': new angle conflicts with point
FigureSpecError: duplicate geometry name 'AB': new dimension conflicts with segment
FigureSpecError: duplicate geometry name 'A': new angle conflicts with point
```
`angles`/`dimensions`의 **키**를 점 이름(`A`,`B`)이나 변 이름(`AB`)과 똑같이 지었다.
**모든 기하 객체의 이름은 한 네임스페이스를 공유한다.**
→ 각은 `angA`, 치수는 `dimAB` 처럼 **접두사**를 붙인다. (엔진이 막아 준 것이지 결함이 아니다)

### 4-3. 입체도형을 손으로 오프셋 계산 ❌
직접 `cab(x,y,z)` 오프셋을 만들어 겨냥도를 그렸더니 **직육면체·삼각기둥이 뭉개졌다.**
→ 반드시 `figure_solid.View`(사방투영)에 **3D 좌표**를 넘긴다. `View`는 호출 가능 객체다.

### 4-4. 숨은 모서리를 점선 처리하지 않음 ❌
모든 모서리를 실선으로 그리면 선이 교차해 **입체로 보이지 않는다**(삼각기둥 실패).
→ 관찰자 반대편 꼭짓점에 닿는 모서리를 골라 `dash="5,4"` 로 먼저 그린다.
```python
tri_edges  = [(0,1),(1,2),(2,0),(4,5),(1,4),(2,5)]   # 실선
tri_hidden = [(3,4),(5,3),(0,3)]                      # 뒤쪽 꼭짓점 D(3)에 닿는 모서리
```

### 4-5. Python `%` 포맷과 CSS `%` 충돌 ❌ (엔진과 무관하나 반복해서 당함)
```
ValueError: unsupported format character ';' (0x3b)
```
HTML 템플릿에 CSS(`max-width:100%`)가 있는데 `"..." % (a, b)` 로 포맷했다.
→ `.format()`/`.replace()` 를 쓰거나, 애초에 **셸 heredoc 대신 파일로 작성**한다.
   (한글 경로 + 셸 이스케이프가 겹치면 디버깅 비용이 크다)

### 4-6. 사다리꼴을 두 대각선으로 나눠 분수에 씀 ❌ (2026-08-21)
이등변사다리꼴의 두 대각선은 서로를 이등분하지 않는다. 위 삼각형이 작고 아래가 크다.
원장님: 「색칠/미색칠 크기가 달라 분수 문제로 적절하지 않다.」
→ `trapFour`: 합동인 직각삼각형 넷. 정점 6개, 넓이는 shoelace. `elementaryFigure.test.ts`.

### 4-7. 가/나 도형 라벨을 FigureSpec `labels` 로 붙임 ❌ (2026-08-21)
`labels` 는 점 옆에 앉는다. 도형 높이가 다르면 라벨 y 가 제각각.
→ `namedShapes`. 라벨은 도형 아래, 같은 행 같은 높이. 무작위 20 의 가/나·가~바는 이 kind 가 아니면 빨강.

### 4-8. 열이 많은 표의 viewBox 를 키움 ❌ (2026-08-21)
곱셈표 7열 viewBox 504 → 화면에서 숫자가 본문보다 작아짐.
→ 칸 폭만 줄인다. viewBox 폭 ≤240, 글자 12~13.

### 4-9. 피자 그림을 PDF 에서 오림 ❌ (2026-08-21)
쪽 배경(보라)이 남는다. 분수 원과 안 닮는다.
→ `fracPie`. 오림은 삽화만.

### 4-10. 길이 치수 곡선을 손으로 그림 ❌ (2026-08-21)
붕 뜨고, 점선·halo 가 엔진 A 와 갈린다.
→ `_length_mark` → `measured()`. dash 는 `"6 4"`.

### 4-11. 점격자 점선이 실선만큼 진함 ❌ (2026-08-21)
`#7aa0c4` 1.05px 는 발문을 이긴다.
→ `#c8d7e4` 0.7px. 휘도는 테스트가 지킨다.

### 4-12. 원기둥 전개도에서 원이 직사각형 위에 떠 있음 ❌ (2026-08-22)
밑면 원 둘을 옆면 위에 간격을 두고 그렸다. 전개도는 원이 직사각형 **긴 변에 접해야** 접힌다.
→ `_net_cylinder`. 접점은 긴 변(둘레)만. `layout` 으로 맞은편·같은 변·어긋남을 고른다. 짧은 변에 붙이지 않는다.

### 4-13. 원뿔을 밑면 타원 + 세 점 삼각형으로 그림 ❌ (2026-08-22)
투영 밑면의 왼쪽·오른쪽 끝은 꼭대기에서 본 접점이 아니다. 타원을 채우고 그 위에 삼각형을 얹으면 피자 조각처럼 보인다.
→ 꼭대기에서 타원에 접하는 두 모선. 가까운 호를 따라 옆면을 채우고, 먼 호는 점선.

## 5. 작업 순서 (권장)

0. **초등이면 §2.1 로 A / elem-1 / 오림을 먼저 가른다.** 같은 그림이 두 번이면 kind.
1. 중등·고등 작도면 계층 A/B 결정
2. 계층 A면 LLM에게 **FigureSpec JSON만** 생성시킨다(§1 예시 + §4-2 접두사 규칙을 프롬프트에 포함)
3. `compile_figure_spec(spec).render_svg()` 로 컴파일 — 예외가 나면 그 메시지를 그대로 LLM에 되먹여 재시도
4. `elem-1` 이면 `elementary.py` 의 kind 만. 새 불변식은 테스트와 이 절 표에 같이 적는다
5. 계층 B면 Python 조립 코드를 생성시키고 실행 결과를 육안 검수
6. **SVG 문자열을 DB에 저장**하고 앱은 inline 렌더. 큐브 QA 는 `/dev/cube-scrape` — 공유 DB 금지

## 6. 한계와 대안

- FigureSpec v2에 곡선·입체·통계가 없다 → 계층 B로 처리(실증 완료)
- 사진·실물 이미지가 필요한 문항은 SVG로 만들 수 없다
  → **codex/grok 등 이미지 생성·보정 도구로 원본을 정리해 사용**(Claude는 이미지 생성 불가)

---

## 5. 완료본 그림은 **재작도가 아니라 원본 오려오기** (2026-08-15 확정)

조사 결과 계획이 크게 단순해졌다. **엔진으로 다시 그릴 필요가 없다.**

| 확인한 것 | 결과 |
|---|---|
| 완료본 PDF 의 그림 형태 | **임베드 래스터 이미지** (표본 30편 전부) |
| 품질 | 약 118dpi 선화. 포물선·반원·전개도·히스토그램 모두 선명, 라벨(A,B,8cm,30°)까지 정확 |
| 추출 규모 | 359편 → **305편 939문항 1,149파일 21MB**, 93초, 토큰 0 |
| 문항 매칭 재현율 | **99.0%** (완료본 40편, 그림 언급 문항 98 중 97) |

- 추출: `python scripts/figure/extract-all-figures.py` → `public/figures/<examId>/qNN.<ext>`
- 적재: `node scripts/figure/load-figures.mjs --apply` → `Problem.figureUrls`
- 원본 이미지가 안 잡히면(폼 XObject·벡터) 그 영역을 200dpi 로 렌더해 메꾼다.
  이 폴백 전에는 18%가 비었다.

**testchanger `page_figures()` 는 `get_images()` 만 본다** — 그래서 벡터로 그린 그림은
놓친다. 우리 추출기는 클립 렌더로 그 경우를 덮는다.

### 5.1 ⚠️ 적재가 그림 문항을 기본 제외한다 — 재적재 필요

`classifyDrafts` 는 `hasFigure` 인 문항을 `skipped_figure` 로 **버린다**(그림이 없던
시절의 안전장치). 그래서 대장의 939문항 중 DB 에 들어와 있는 건 162건뿐이다.

**이제 그림이 있으므로 `--figures` 로 재적재해야 한다:**

```bash
FINAL_BATCH_DIR=scripts/qa/reports/index-batch \
  npx tsx scripts/import/final-batch.ts --figures            # 드라이런
ALLOW_SHARED_IMPORT=1 FINAL_BATCH_DIR=scripts/qa/reports/index-batch \
  npx tsx scripts/import/final-batch.ts --figures --apply
node scripts/figure/load-figures.mjs --apply                 # 그림 연결
```

`externalId` 중복 차단이 있으므로 이미 들어간 문항은 다시 안 들어간다.

### 5.2 알려진 한계

- **공통 지문 그림** — 한 그림이 뒤따르는 여러 문항의 지문일 때 앞 문항에 붙는다
  (실측 5333: 최대공약수 관계도가 2·3번의 '수 A/수 B' 를 정의하는데 1번에 붙음).
  뒤 문항이 '그림' 이라는 낱말을 안 쓰면 규칙으로 못 잡는다 → 검수 화면에서 사람이 옮길 것.
- **선택지가 그림인 문항** — 한 문항에 그림이 최대 6장 붙는다. `figureUrls` 는 배열이고
  순서는 지면 순서다. 화면에서 선택지별로 배치하려면 별도 처리가 필요하다.
