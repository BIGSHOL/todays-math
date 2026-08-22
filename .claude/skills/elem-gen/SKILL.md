---
name: elem-gen
description: 자체 초등 엔진(초3~초6, AI 아님)과 난이도 4단(D-71)으로 초등 문항 세트를 생성·검수한다. 원장님이 초등 문항 생성·샘플·난이도별 출제를 요청할 때 사용.
---

# 초등 출제 (elem-gen)

자체 초등 출제 엔진(`src/lib/elementary/`)을 세션에서 바로 부르는 스킬이다.
**AI 생성이 아니다** — 순수 엔진이라 씨앗이 같으면 결과가 같고, 정답은 생성기가
같은 숫자로 계산한다. 그림은 FigureSpec(elem-1)으로 나와 도형 엔진이 그린다.

## 명령

```bash
# ① 커버리지 — 어느 소단원을 낼 수 있고 난이도 갈래가 어디 등록됐나
npx tsx scripts/elem/gen-cli.ts --list [--grade 초4]

# ② 세트 생성 (JSON + 검수용 HTML)
npx tsx scripts/elem/gen-cli.ts --grade 초4 --section 1-5-1 --count 6 \
  --seed 20260823 --out set.json --html preview.html

# ③ 난이도 지정 — 갈래 하나(--tier) 또는 반 프리셋(--preset, D-71 안A)
npx tsx scripts/elem/gen-cli.ts --grade 초3 --section 1-1-2 --count 8 \
  --preset 중위반 --seed 20260823 --html preview.html
```

- 갈래: `연산·기본·응용·심화` (D-71). 프리셋: `하위반 40/40/20/0 · 중위반 15/40/30/15 ·
  상위반 0/25/40/35` (%). 배분은 최대 잔여법, 동률은 선언 순서.
- 씨앗을 바꾸면 다른 세트다. **보고할 때 씨앗을 함께 적어야** 재현된다.
- 세트 안 중복(발문+정답)은 자동으로 피하고, 변형 공간이 좁으면 **던진다.**

## 규칙 (어기면 안 되는 것)

1. **커버리지를 손으로 단정하지 말 것** — 항상 `--list` 로 묻는다. 갈래 없는 소단원에
   `--tier`/`--preset` 을 주면 엔진이 던진다(조용히 기본 문항을 내지 않는다).
2. **DB 에 넣지 않는다.** 이 스킬은 생성·검수까지다. 공유 DB 적재는 별도 절차이고
   `ALLOW_SHARED_IMPORT=1` 없이는 막혀 있다 (D-22·D-31). 우회 금지.
3. **HTML 은 검수용 미리보기다** — 시험지 지면이 아니다. 인쇄물이 필요하면 제품
   화면(`/dev/elem-engine` 또는 출제 흐름)으로 간다. 새 지면을 만들려면 D-07
   (원장님 확정) + 절대 규칙 6 (실물 인쇄 검수).
4. **그림이 실패하면 그 문항의 좌표를 고치지 말 것** — 엔진 상한이 말하는 것이다.
   `docs/planning/09-figure-engine-guide.md` §4 (재발 금지) 를 먼저 읽고, 고칠 것이
   있으면 elem-1 kind(스키마) 쪽을 고친다. 그림 실패 시 CLI 는 종료 코드 1 로 알린다.
5. 유형 재료가 필요하면 `docs/planning/tracks/cube-concept-catalog.md` (큐브 24권
   대단원별 유형 색인), 진행 상태는 `docs/planning/10-handoff.md` §10.2.

## 구조

- `scripts/elem/gen-core.ts` — 커버리지·배분·세트 생성 (시험: `src/__tests__/unit/elemGenCore.test.ts`)
- `scripts/elem/gen-cli.ts` — 인자 처리 + JSON/HTML 출력 (수식은 제품 렌더러
  `renderMathHtml`, 그림은 `renderFigureSpec` — 지면과 같은 것을 본다)
