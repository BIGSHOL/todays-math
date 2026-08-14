# 09 — 도형 SVG 엔진 사용 지침 (testchanger figure engine)

> **작업 전 필독.** 2026-08-14 실제 사용에서 낸 오류를 전부 적어 둔다.
> 같은 실수를 반복하지 말 것. 새 오류를 만나면 §4에 추가한다.

## 0. 위치와 진입점

엔진 원본: `D:\시험지 한글화` (testchanger, Python). **이식하지 않고 그대로 호출**한다.
SVG를 사전 생성해 문자열로 DB에 저장하는 방식이다.

```python
import sys; sys.path.insert(0, r"D:\시험지 한글화")
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

## 5. 작업 순서 (권장)

1. 문제 본문에서 **어떤 도형인지 분류** → 계층 A/B 결정
2. 계층 A면 LLM에게 **FigureSpec JSON만** 생성시킨다(§1 예시 + §4-2 접두사 규칙을 프롬프트에 포함)
3. `compile_figure_spec(spec).render_svg()` 로 컴파일 — 예외가 나면 그 메시지를 그대로 LLM에 되먹여 재시도
4. 계층 B면 Python 조립 코드를 생성시키고 실행 결과를 육안 검수
5. **SVG 문자열을 DB에 저장**하고 앱은 inline 렌더

## 6. 한계와 대안

- FigureSpec v2에 곡선·입체·통계가 없다 → 계층 B로 처리(실증 완료)
- 사진·실물 이미지가 필요한 문항은 SVG로 만들 수 없다
  → **codex/grok 등 이미지 생성·보정 도구로 원본을 정리해 사용**(Claude는 이미지 생성 불가)
