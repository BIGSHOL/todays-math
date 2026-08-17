# 성능 수리 B — `rehype-katex` `output` 옵션 조사 (적용하지 않음)

- 대상: `src/components/math/MarkdownRenderer.tsx` 가 넘기는 `rehypeKatex` 옵션
- 기준 커밋: `54963d3f` (worktree `BIGSHOL/perf-render`)
- **제품 코드는 한 줄도 고치지 않았다.** 조사용 스크립트/임시 테스트는 측정 후 지웠다.
- 지시: "조사만 하고 적용하지 말 것."

**한 줄 요약: 지면·화면은 정말로 한 픽셀도 안 달라진다(문항 30건 전량 확인).
그런데 `output:"html"` 은 수식을 보조기술에서 통째로 사라지게 만든다 —
지금 상태로는 적용하면 안 된다.**

---

## 1. 지금 무엇이 일어나고 있나

`MarkdownRenderer` 는 `rehypeKatex` 에 옵션을 주지 않는다. KaTeX 기본값은
`output: "htmlAndMathml"` 이라 수식 하나마다 DOM 이 **두 벌** 생긴다.

```html
<span class="katex">
  <span class="katex-mathml"><math>…<annotation encoding="application/x-tex">\dfrac{7}{25}</annotation></math></span>
  <span class="katex-html" aria-hidden="true">… 실제로 눈에 보이는 조판 …</span>
</span>
```

- `.katex-html` — 화면에 보이는 것. `aria-hidden="true"` 라 보조기술은 못 읽는다.
- `.katex-mathml` — CSS 로 시각적으로 감춰져 있고, **보조기술이 읽는 유일한 통로**다.

`output: "html"` 로 바꾸면 `.katex-mathml` 이 사라진다.

## 2. 실측

### 2-1. 수식 단위 (KaTeX 직접 호출, katex 0.16)

| 수식 | 기본 | `output:"html"` | 바이트 | DOM 노드 | `.katex-html` |
|---|---:|---:|---:|---:|---|
| `\dfrac{7}{25}` | 1,262B / 33 | 980B / 26 | −22% | −21% | 동일 |
| `\sqrt{3}x-2<4` | 2,267B / 43 | 1,993B / 32 | −12% | −26% | 동일 |
| `a^{3}\times a^{2}\div a^{4}` | 2,262B / 60 | 1,936B / 47 | −14% | −22% | 동일 |
| `\triangle ABC` | 638B / 17 | 384B / 8 | −40% | −53% | 동일 |
| `\displaystyle\sum_{k=1}^{9}a_k=12` | 2,456B / 64 | 2,048B / 49 | −17% | −23% | 동일 |
| `\lim\limits_{n\to\infty}\dfrac{2n^2+1}{n^2-3}` | 3,461B / 98 | 2,904B / 75 | −16% | −23% | 동일 |
| **합계** | **12,346B / 315** | **10,245B / 237** | **−17%** | **−25%** | — |

### 2-2. 문항 단위 (앱의 실제 파이프라인 — 전처리 + remark-math + rehype-katex)

Mock 문항 30건을 두 설정으로 렌더해 비교했다.

- 합계 **57,123B → 39,452B (−31%)**
- **`.katex-html` 조판 부분은 30건 전량 바이트 단위로 동일** (다른 문항 0건)

즉 `katex.min.css` 가 로드돼 있는 한(`src/app/layout.tsx` 가 한 번 로드한다)
**문제은행·검수·인쇄 어디서도 보이는 그림은 달라지지 않는다.** 이건 확인됐다.

## 3. 그런데 적용하면 안 되는 이유

`.katex-html` 에는 `aria-hidden="true"` 가 **그대로 남는다.** 실제 출력:

```html
<span class="katex"><span class="katex-html" aria-hidden="true">…</span></span>
```

`.katex-mathml` 이 없어지면 `<span class="katex">` **전체가 보조기술에 아무것도
내주지 않는다.** 지금은 `<annotation encoding="application/x-tex">\dfrac{7}{25}</annotation>`
가 남아 있어 최소한 원문 LaTeX 이라도 노출되는데, 그게 사라진다.

수학 시험지에서 수식이 사라지면 남는 건 "다음 중 옳은 것은?" 뿐이다.
화면 크기 −31% 와 바꿀 만한 것이 아니다.

## 4. 판단

**적용 보류.** 다음 중 하나가 갖춰지면 다시 볼 만하다.

1. `.katex-html` 의 `aria-hidden` 을 걷어내고 그 자리에 `aria-label` 로 원문
   LaTeX(또는 읽어 주는 문장)를 붙이는 후처리 rehype 플러그인을 두는 것 —
   **이건 화면 DOM 을 바꾸는 일이라 D-07 확정 절차가 먼저다.**
2. 애초에 화면 무게가 문제라면, 이 트랙에서 이미 한 memo·캐시 쪽이
   **DOM 을 안 건드리고** 같은 체감을 준다. 그쪽을 먼저 다 쓴 뒤에 볼 것.

## 5. 곁가지 — layout.tsx 와의 관계

브리핑이 짚은 대로 이 옵션은 `src/app/layout.tsx` 의 전역 `katex.min.css` 와 한 세트다
(`.katex-mathml` 을 감추는 것도, `.katex-html` 을 조판하는 것도 그 CSS다).
`layout.tsx` 는 번들 세션 소유라 이 워크트리에서 건드리지 않았다.
위 1번을 하게 되면 두 세션이 같이 움직여야 한다.

## 6. 재현 방법

조사 스크립트는 일회용이라 남기지 않았다. 다시 재려면:

```js
// 프로젝트 루트에서 node
import katex from "./node_modules/katex/dist/katex.mjs";
const tex = String.raw`\dfrac{7}{25}`;
const both = katex.renderToString(tex, { throwOnError: false });
const html = katex.renderToString(tex, { throwOnError: false, output: "html" });
// both 에서 <span class="katex-mathml">…</span> 만 걷어내면 html 과 같아진다.
```

문항 단위 비교는 `src/__tests__/unit/renderParity.test.tsx` 의 렌더 방식을 그대로 쓰되
`rehypePlugins` 를 `[[rehypeKatex, { output: "html" }]]` 로 바꿔 `.katex-html` 조각만
잘라 견주면 된다.

---

## 부록 — 이 옵션 없이 얻은 실측 효과 (성능 수리 B 전체)

`output` 옵션을 건드리지 않고도 아래만큼 줄었다. 위 2번의 −31% 와 견주라고 남긴다.

측정: jsdom + Testing Library, 같은 기계에서 `2c3c6d0d`(수리 전) 워크트리와
`97cd9b2a`(수리 후)를 번갈아 실행. 재렌더는 7회 중앙값.

| 상황 | 수리 전 | 수리 후 |
|---|---:|---:|
| 문제은행 20카드 — 카드와 무관한 상태 변화로 재렌더 | 142.2ms | **1.2ms** |
| 검수 30카드 — 카드와 무관한 상태 변화로 재렌더 | 403.5ms | **1.2ms** |
| 인쇄 미리보기 30문항 — 인쇄 버튼(지면은 그대로) | 133.7ms | **3.1ms** |
| 검수 30카드 — **최초** 렌더 (캐시가 못 끼도록 문항마다 본문·정답·해설을 유일하게) | 732ms | **285ms** |

- 앞의 셋은 `memo`/`useMemo` 효과다. 재렌더 비용이 사실상 사라진다.
- 마지막 하나는 접힌 `<details>` 의 답·해설을 조판하지 않게 한 효과다(약 2.5배).
- **인쇄 미리보기의 문제지↔정답지 전환은 242.2ms → 300.9ms 로 나아지지 않았다.**
  모드를 바꾸면 지면 컴포넌트 자체가 갈리므로(JaseupTemplate ↔ PrintAnswerKeyPage)
  조판이 진짜로 새로 필요하다 — `memo` 가 도울 수 있는 일이 아니다.
  숫자가 오히려 커진 건 실행 간 편차 범위다(최초 렌더 계열 수치는 jsdom 에서
  편차가 커서, 위 표의 최초 렌더는 3회 반복 중앙값으로 따로 쟀다).
