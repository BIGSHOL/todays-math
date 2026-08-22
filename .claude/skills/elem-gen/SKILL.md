---
name: elem-gen
description: 자체 초등 엔진(초3~초6, AI 아님)과 난이도 4단(D-71)으로 초등 문항 세트를 생성·검수한다. 원장님이 초등 문항 생성·샘플·난이도별 출제를 요청할 때 사용. 바로 생성하지 말고 질문으로 세부를 확정한 뒤 생성한다.
---

# 초등 출제 (elem-gen)

자체 초등 출제 엔진(`src/lib/elementary/`)을 세션에서 바로 부르는 스킬이다.
**AI 생성이 아니다** — 순수 엔진이라 씨앗이 같으면 결과가 같고, 정답은 생성기가
같은 숫자로 계산한다. 그림은 FigureSpec(elem-1)으로 나와 도형 엔진이 그린다.

## 절차 — **바로 생성하지 않는다** (원장님 지시 2026-08-23)

요청을 받으면 반드시 이 순서로 간다:

**① 커버리지부터 확인한다.** 질문의 선택지는 추측이 아니라 실제 목록에서 나와야 한다.

```bash
npx tsx scripts/elem/gen-cli.ts --list --grade 초4   # 학년별 소단원·갈래 등록 현황
```

**② AskUserQuestion 으로 세부를 확정한다.** 원장님이 **이미 말한 것은 다시 묻지 않는다**
(「초4 1-5-1 6문항」이라 했으면 범위·수는 확정된 것). 빠진 것만 묻되, 1차로 이 네 가지:

1. **범위** — 학년과 소단원. 원장님이 주제로 말하면(「막대그래프」) 커버리지에서 맞는
   소단원들을 찾아 선택지로 낸다 (교재 유형 참고: `docs/planning/tracks/cube-concept-catalog.md`).
2. **문항 수** — 4 / 6 / 8 / 12 같은 선택지.
3. **난이도 방식** — ㉠ 표준(갈래 없이) ㉡ 갈래 하나(연산·기본·응용·심화) ㉢ 반 프리셋
   (하위반 40/40/20/0 · 중위반 15/40/30/15 · 상위반 0/25/40/35, D-71 안A)
   ㉣ **직접 배분**(갈래별 개수를 손으로 — 예: 연산1·기본3·응용2).
   ⚠️ 갈래 등록이 안 된 소단원이면 ㉡㉢㉣ 을 선택지로 내지 말 것 — `--list` 가 알려 준다.
4. **출력** — HTML 미리보기(기본) / JSON / 둘 다.

난이도에서 ㉡/㉣ 을 골랐으면 2차 질문으로 갈래(또는 배분)를 받는다. 재출제 요청이면
지난 씨앗을 쓸지(같은 세트 재현) 새 씨앗을 쓸지도 묻는다.

**③ 확정 내용을 한 줄로 요약해 보여 주고 생성한다.** 씨앗은 그날 날짜 기반(예: 20260823)
으로 새로 정하되 **반드시 보고에 남긴다** — 씨앗이 있어야 같은 세트를 다시 만든다.

**④ HTML 을 SendUserFile 로 보낸다** (render). 그림 실패(종료 코드 1)가 있으면 숨기지
말고 어느 문항이 왜 실패했는지 그대로 보고한다.

## 명령

```bash
# 커버리지
npx tsx scripts/elem/gen-cli.ts --list [--grade 초4]

# 표준 세트 (JSON + 검수용 HTML)
npx tsx scripts/elem/gen-cli.ts --grade 초4 --section 1-5-1 --count 6 \
  --seed 20260823 --out set.json --html preview.html

# 갈래 하나 / 반 프리셋
npx tsx scripts/elem/gen-cli.ts --grade 초3 --section 1-1-2 --count 8 \
  --preset 중위반 --seed 20260823 --html preview.html

# 직접 배분 — 합이 곧 개수라 --count 는 생략
npx tsx scripts/elem/gen-cli.ts --grade 초3 --section 1-1-2 \
  --mix "연산:1,기본:3,응용:2" --seed 20260823 --html preview.html
```

- 세트 안 중복(발문+정답)은 자동으로 피하고, 변형 공간이 좁으면 **던진다.**
- 여러 소단원에 걸친 세트는 소단원마다 한 번씩 부른다 (범위 혼합은 아직 CLI 밖).

## 규칙 (어기면 안 되는 것)

1. **커버리지를 손으로 단정하지 말 것** — 항상 `--list` 로 묻는다. 갈래 없는 소단원에
   `--tier`/`--preset`/`--mix` 를 주면 엔진이 던진다(조용히 기본 문항을 내지 않는다).
2. **DB 에 넣지 않는다.** 이 스킬은 생성·검수까지다. 공유 DB 적재는 별도 절차이고
   `ALLOW_SHARED_IMPORT=1` 없이는 막혀 있다 (D-22·D-31). 우회 금지.
3. **HTML 은 검수용 미리보기다** — 시험지 지면이 아니다. 인쇄물이 필요하면 제품
   화면(`/dev/elem-engine` 또는 출제 흐름)으로 간다. 새 지면을 만들려면 D-07
   (원장님 확정) + 절대 규칙 6 (실물 인쇄 검수).
4. **그림이 실패하면 그 문항의 좌표를 고치지 말 것** — 엔진 상한이 말하는 것이다.
   `docs/planning/09-figure-engine-guide.md` §4 (재발 금지) 를 먼저 읽고, 고칠 것이
   있으면 elem-1 kind(스키마) 쪽을 고친다.
5. 유형 재료가 필요하면 `docs/planning/tracks/cube-concept-catalog.md` (큐브 24권
   대단원별 유형 색인), 진행 상태는 `docs/planning/10-handoff.md` §10.2.

## 구조

- `scripts/elem/gen-core.ts` — 커버리지·배분·세트 생성 (시험: `src/__tests__/unit/elemGenCore.test.ts`)
- `scripts/elem/gen-cli.ts` — 인자 처리 + JSON/HTML 출력 (수식은 제품 렌더러
  `renderMathHtml`, 그림은 `renderFigureSpec` — 지면과 같은 것을 본다)
