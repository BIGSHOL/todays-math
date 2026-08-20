# 인수인계 — 그림 유실 회수 세션 (2026-08-20)

기준 커밋 **`31b829e9`** (main, **푸시 완료**) · 작업 트리 깨끗함
· 원장 [`16-figure-recovery-ledger.md`](../16-figure-recovery-ledger.md)

> **이 문서 하나만 읽고 이어할 수 있게 썼다.**
> §1 먼저 읽을 것 → §2 끝난 것 → §3 **바로 다음에 할 일** → §4 원장님 결정 대기
> → §5 이 세션이 실제로 낸 함정(되풀이 금지) → §6 명령 모음 → §7 겹치는 자리.

---

## 0. 한 줄

그림 유실 **272 → 103**. 이 세션이 맡은 다섯 가지 중 **셋을 끝냈고 둘이 원장님 결정
대기**다. 다음 한 걸음은 남은 RPM 70건 중 **「자기 상자」 잔여 34건의 검수 시트**다.

| 지금 값 | 건수 |
|---|---:|
| **그림 유실** | **103** (전량 `directUseAllowed=false` 로 잠김 — 지금 출제 가능 **0**) |
| └ RPM 교재본(`transformed`) | 70 |
| └ 기출(`past_exam`) | 31 |
| └ 자작(`manual`) | 2 |
| 본문 오염 (`[그림]` 자국) | 13 (**그중 지금 출제 가능 1건** — §3.ⓓ) |

확인 명령은 하나뿐이다.

```bash
npx tsx scripts/qa/report-missing-figures.ts          # 집계
npx tsx scripts/qa/report-missing-figures.ts --json   # scripts/qa/reports/missing-figures.json
```

---

## 1. 먼저 읽을 것

1. `CLAUDE.md` — 특히 절대 규칙 6(인쇄)·9(포커스)·10(오르카 다중 세션),
   그리고 **Lessons Learned 의 2026-08-16~20**. 이 세션이 낸 함정이 거기 있다.
2. `docs/planning/16-figure-recovery-ledger.md` — **그림 작업의 원장.**
   §1 확인 명령 · §3 회수 이력(§3.13~§3.18) · §3.18 아래 **남은 70건 쪼갬**.
3. `docs/planning/tracks/README.md` §공통 규칙 — 공유 DB 쓰기 게이트(D-31),
   원본 저장소 읽기 전용, 커밋은 자기 브랜치.
4. 이 세션이 쓴 보고서 셋: `tracks/reports/rpm-stem-split.md` ·
   `rpm-group-pair.md` · `rpm-furniture.md`.

### 저장소 밖 의존물

| 대상 | 경로 | 없으면 |
|---|---|---|
| RPM 교재 PDF | `.rpm-src/RPM 중학 {1-1,1-2,2-1,2-2,3-1,3-2} 학생용.pdf` (**6권**) | 오려내기 전부 불가 |
| 공유 DB | `.env` 의 `DATABASE_URL` (Supabase `jyaguxwuaxgdnovtulna`) | 집계·적용 불가 |

`.rpm-src/` 는 커밋되지 않는다. 없으면 `docs/planning/08-import-ledger.md` 의
N드라이브 경로에서 다시 받아라.

---

## 2. 끝난 것 (이 세션)

| # | 일 | 결과 | 커밋 |
|---|---|---|---|
| 1 | 넘침 판정 재조율 — **축이 틀렸다**(폭 규칙을 빼고 px 를 칸과 직접 견줌) | — | `f8c883a6` |
| 2 | 중복 35행 추가 삭제 · 중2 다항식 95행 단원 재배정 | — | `2bf2524b` `19efbbfa` |
| 3-a | RPM **무리 짝짓기** — 그림 하나를 여럿이 나눠 쓰는 부류 | 167 → **121** | `9ee00985` |
| 3-b | RPM **쪽 장식 제외** — 측면 색인 탭이 완비 검사를 막고 있었다 | 121 → **103** | `31b829e9` |

전부 main 에 있고 **푸시됐다.** `npm run check:figures` 초록(빠진 그림 없음).

---

## 3. 바로 다음에 할 일

### ⓐ 남은 RPM 70건 — **34건이 다음 한 걸음** ★최우선

`16-figure-recovery-ledger.md` §3.18 아래 표가 정본이다. 요약:

| 사유 | 건수 | 다음 수 |
|---|---:|---|
| **「자기 상자」 경로 잔여** | **34** | ← **여기부터.** §3.16 과 같은 **검수 시트** |
| └ 칸에 지면 글자·선택지·문장이 들어왔다 | 10 | 네모를 그리고 지면 글자를 지운다 |
| └ 완비 검사가 버렸다 | 9 | **무엇이 가로지르는지 먼저 봐라**(아래 명령) |
| └ 칸에 발문이 들어왔다 | 7 | 본문방향으로도 못 가른 부류 |
| └ 후보가 아예 없다 | 5 | 원본 지면을 떠서 봐라 |
| └ 그 밖(한 단보다 넓다·너무 작다·사람이 뺌) | 3 | 개별 판단 |
| 무리 표시 없는 지면 | 29 | 실측으로 추가 회수 **0** — 서식이 `[0004~0006]` 을 안 찍는다 |
| 띠 안에 덩어리 없음 | 3 | 원본 지면을 떠서 봐라 |
| 이관 이력 없음 | 4 | **불가** (`externalId` 없음) |

**「없다」를 적기 전에 반드시 이것부터 돌려라** — 진단기를 새로 만들지 마라.
제품 함수(`figure_rect`)를 `trace` 와 함께 부르는 도구가 이미 있다.

```bash
python scripts/figure/probe-rpm-nofig.py     # 왜 못 찾았나를 사유별로 가른다
```

바로 쓸 수 있는 길은 **§3.16 의 검수 시트**(`sheet-rpm-stem-split.py`)다.
지금 그 시트는 실패 사유에 `본문방향` 이 든 행만 대상으로 삼는다 —
**대상 선택을 넓히는 것이 첫 작업**이다
(`scripts/figure/sheet-rpm-stem-split.py` 의 `if "본문방향" not in f["이유"]: continue`).

> ⚠️ **넓힐 때 「반증하려고 넓힌 모집단」을 처리 대상으로 물려받지 마라.**
> 2026-08-18 에 43이 433이 된 자리다. `apply-rpm-furniture.py` 의 `narrow()` 가
> 그 가드의 본보기다 — **지금 유실인 행만** 남기고, 뺀 것을 세어 찍고,
> 분모가 안 맞으면 멈춘다.

### ⓑ 기출 31건 — **옆 세션에 먼저 물어라**

옆 트랙(`그림적용` 워크트리, `feat/figure-apply`)이 52 → 31 로 줄였다.
겹쳐서 돌리면 같은 컬럼(`figureUrls`·`directUseAllowed`)을 두 스크립트가 잠근다
— 16 §3 의 「같은 컬럼을 두 스크립트가 잠근다」 경고 참조.

### ⓒ 단원 오배정 — 중1 문항이 **공통수학2** 에 앉아 있다

```
HC20101-6XH4   오른쪽 그림에서 … 두 점 B, D 사이의 거리      ← RPM 중학 1-2 문항
HC20101-QDCK   오른쪽 그림에서 두 점 M, N 이 …
```

`problemCode` 가 `HC20101-`(공통수학2 3.도형의 방정식 > 두 점 사이의 거리)인
`source=transformed` 행이 **9건**이다. 전부 RPM **중학 1-2**(중1 5.기본도형 >
두 점 사이의 거리)에서 왔다. **소단원 이름이 같아서** 붙은 것으로 보인다 —
`19efbbfa`(J20108)와 같은 부류인데 방향이 반대다(중등 → 고등).

그림은 제 것이 맞으므로 **그림 트랙이 아니라 단원 재배정 트랙 소관**이다.

```sql
select problem_code, left(content, 60) from problem
 where problem_code like 'HC20101-%' and source = 'transformed';
```

### ⓓ 본문 오염 13건 중 **지금 출제 가능 1건**

집계에 `본문 오염 … 지금 출제 가능 1건` 이 떠 있다. 세션 시작 시점엔 0이었다 —
그 사이 다른 트랙이 잠금을 풀었거나 새 행이 들어왔다. **한 건이니 눈으로 보고
잠그거나 고쳐라.** `report-missing-figures.ts --list` 로 나온다.

### ⓔ 그림 유실 판정 규칙의 **사각지대** — 낱말로 못 보는 부류

규칙(`src/lib/figure/missingFigureRule.ts`)은 본문이 **그림을 지목하는가**로 가른다.
그런데 「아래는 … **조사하여 나타낸 것이다**」류는 그 낱말(그림·그래프·표)을
안 쓰면서도 **자료 없이는 못 푼다.** 실측 `1-2 p151` 의 `1003~1005` 가 그렇다 —
`figureUrls=[]` 이고 `directUseAllowed=true` 인데 공용 자료 상자 없이는 못 푼다.

> ⚠️ **낱말로 세면 319건이 나오는데 그 숫자를 「결함 319」로 읽지 마라.**
> 대부분은 표가 본문에 **글자로** 들어 있어 멀쩡하다 — 2026-08-18 에
> 「그림 1,499 vs 그래프 3,373」으로 이미 겪은 함정이다. 319는 **상한**이지
> 결함 수가 아니다. 가를 열쇠를 먼저 찾고(본문이 자료를 **가리키는가** vs
> 자료를 **담고 있는가**), 반드시 **반대쪽 모집단**에 대 봐라.

### ⓕ 넘침 절대수 재측정 (대기)

`f8c883a6` 이 넘침 판정의 축을 고쳤다. 그런데 **절대 건수**는 지금 재면 안 된다 —
`그림벡터검수` 세션이 그림을 SVG 로 바꾸는 중이라 지면 높이가 흔들린다.
**그 세션이 끝난 뒤** 다시 재고 문서에 적어라.

---

## 4. 원장님 결정 대기 — 이 세션이 못 끝낸 둘

### ⓐ 고아 `hwppdf-*` 그림 파일 **6장** — 지울까?

`public/figures/**/hwppdf-*.png` 23장 중 **DB 가 안 가리키는 것 6장**이다.

```
/figures/2085/hwppdf-q15.png   /figures/3493/hwppdf-q15.png
/figures/3524/hwppdf-q13.png   /figures/3536/hwppdf-q16.png
/figures/4068/hwppdf-q18.png   /figures/5231/hwppdf-q02.png
```

**지우기 전에 다시 세어라** — 공유 DB 라 다른 세션이 그 사이 붙였을 수 있다.

```bash
npx tsx scripts/qa/report-orphan-figures.ts hwppdf-
```

크기가 작아 급하지 않다. **원장님 지시 없이 지우지 마라.**

### ⓑ 오르카 작업공간 옛 잔해 **7개**

`git worktree list` 에는 **안 잡힌다**(등록이 이미 풀렸다). 디렉터리만 남았다.

| 경로 (`~/orca/workspaces/testautocreator/`) | 파일 수 | node_modules 밖 |
|---|---:|---:|
| `adv-print` | 50,690 | **13,168** |
| `phase4-s03` | 35,521 | 168 |
| `T7.14-화면` · `그림벡터` · `그림인쇄` · `그림화질` · `기출검출` | 0 | 0 |

빈 것 5개는 그냥 지워도 된다. **앞의 둘은 `.git` 이 없어 git 으로는 「무엇이
바뀌었나」를 못 묻는다** — 지우기 전에 main 과 파일 단위로 대 봐서 **고유한 작업이
없는지** 확인해야 한다(§6). 지금 살아 있는 워크트리는 넷이다:

```
C:/Creative/testautocreator                     31b829e9 [main]
…/orca/workspaces/testautocreator/그림벡터검수   [feat/figure-svg-verify]
…/그림적용                                       [feat/figure-apply]
…/초등-교재-프로젝트                             [BIGSHOL/초등-교재-프로젝트]
```

---

## 5. 이 세션이 **실제로 낸** 함정 — 되풀이 금지

전부 **표본을 눈으로 보거나 변이를 돌려서** 나왔다. 문서·리뷰로 나온 것은 없다.

1. **「그림을 못 찾았다」는 한 문장에 두 가지다.** 「후보가 아예 없다」(7)와
   「완비 검사가 버렸다」(29)는 다음 수가 완전히 다른데 사유 문자열이 같다.
   → 제품 함수의 `trace` 로 갈라라. **진단기를 따로 쓰지 마라** — 2026-08-19 에
   따로 쓴 것이 `thin_pt` 를 몰라 틀린 집계를 브리프에 실었다.
2. **두 옵션이 짝일 수 있다.** `--thin-pt` 단독은 「얻는 것 0·좌표 52건 훼손」으로
   금지돼 있었는데, 그 측정이 **`--furniture` 가 꺼진 상태**였다. 둘을 같이 켜니
   잃은 것 0·새로 21칸이었다. **금지를 물려받을 때 그 측정의 조건을 먼저 봐라.**
3. **「이미있음」은 「같은 것이 이미 있다」가 아니다.** 오려내기가 파일이 있으면
   건너뛰고 **성공으로 센다.** 실측 3건이 지금 오릴 칸과 다른 그림이었다
   (하나는 예전 것이 오히려 성했다). → 결과에 `"이미있음": true` 를 남기게 고쳤다.
4. **변이 치환 문자열이 파일 안 두 곳에 있으면 거짓 초록이 난다.** 「반올림을 손으로
   적는다」 변이가 `furniture_keys` 안의 같은 줄까지 바꿔, 세는 쪽과 거르는 쪽이
   여전히 같은 수를 썼다. → `assert s.count(old) == 1` 을 붙여라.
5. **합성 픽스처가 조건을 안 만들면 가드가 초록으로 남는다.** 탭을 상자에서 멀리
   두면 애초에 후보로도 안 잡혀 완비 검사가 볼 일이 없다. **상자에 걸치고 `bleed`
   밖까지 뻗게** 놓아야 실제 지면과 같아진다. (짝짓기 트랙에서도 두 번 그랬다.)
6. **파괴적 단계 앞에 D-20 을 반드시 돌려라.** 오려내기 결과 87건 중 **69건이 이미
   그림이 붙은 행**이었고 붙이는 쪽은 경고만 하고 덮어쓴다. 집계가 그걸 잡았다.
7. **되돌리기·판정 파일이 커밋되는지 확인하라.** `scripts/qa/reports/` 는 통째로
   무시되므로 `.gitignore` 에 `!` 예외를 넣어야 한다. 확인은 한 줄이다 —
   `git check-ignore -q <파일>` 이 **1을 내야** 커밋된다.

---

## 6. 명령 모음

### 지금 상태

```bash
npx tsx scripts/qa/report-missing-figures.ts            # 유실 집계
npx tsx scripts/qa/report-missing-figures.ts --list     # 대상 전량
npx tsx scripts/qa/report-orphan-figures.ts             # DB 가 안 가리키는 그림 파일
npm run check:figures                                   # 배포본에 그림이 다 있나
git worktree list
```

### RPM 회수 파이프라인 (§3.18 이 쓴 것 그대로)

```bash
python scripts/figure/probe-rpm-nofig.py                              # ① 왜 못 찾았나
python scripts/figure/crop-rpm-from-pdf.py --plan scripts/qa/reports/rpm-crop-plan-gated.json \
       --out scripts/qa/reports/rpm-crop-result-furn-gated.json \
       --widen-fallback --stem-split --furniture --thin-pt 0.5        # ② 오려내기
python scripts/figure/apply-rpm-furniture.py --emit                   # ③ 붙일 것만 좁힌다
npx tsx scripts/qa/report-rpm-figure-attach-impact.ts \
       --result scripts/qa/reports/rpm-crop-result-furn.json          # ④ D-20 손실
ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/recover-rpm-figures-from-pdf.ts --attach \
       --result scripts/qa/reports/rpm-crop-result-furn.json          # ⑤ 붙인다
ALLOW_SHARED_IMPORT=1 npx tsx scripts/qa/backfill-figure-dimensions.ts --apply
ALLOW_UNIT_FIX=1     npx tsx scripts/qa/apply-missing-figure-lock.ts --revert --recovered
```

### 검수 시트 (사람이 네모를 그리는 자리)

```bash
python scripts/figure/sheet-rpm-stem-split.py                  # §3.16 — 발문과 붙은 부류
python scripts/figure/sheet-rpm-stem-split.py --recut <id> x0 y0 x1 y1 [--keep]
python scripts/figure/sheet-rpm-group-pair.py                  # §3.17 — 무리 짝짓기
python scripts/figure/sheet-rpm-group-pair.py --probe <무리키>
```

### 시험·변이 (고쳤으면 반드시)

```bash
python scripts/qa/test-rpm-furniture.py    && bash scripts/qa/mutate-rpm-furniture.sh
python scripts/qa/test-rpm-group-pair.py   && bash scripts/qa/mutate-rpm-group-pair.sh
npm run type-check && npm run lint && npm run test
```

### 오르카 잔해에 고유 작업이 있나 (`.git` 이 없어 git 으로는 못 묻는다)

```bash
diff -rq --exclude=node_modules --exclude=.next --exclude=.git \
     C:/Users/user/orca/workspaces/testautocreator/adv-print C:/Creative/testautocreator | head -40
```

---

## 7. 다른 세션과 겹치는 자리

| 컬럼·파일 | 누가 쓰나 | 규칙 |
|---|---|---|
| `figureUrls` · `figureSource` | 이 트랙 · `그림적용` · `그림벡터검수` | **붙이기 전 D-20 집계를 돌려라.** 붙이는 쪽은 경고만 하고 덮어쓴다 |
| `directUseAllowed` | 그림 유실 잠금 · 보기그림 잠금 **둘** | 상대 원장에 이미 있는 행은 안 잠근다. 되돌릴 때는 **지금 값이 자기가 쓴 값일 때만** |
| `figureDims` | `backfill-figure-dimensions.ts` | 붙인 뒤 반드시 돌린다 |
| `scripts/figure/crop-rpm-from-pdf.py` | 이 트랙이 소유 | `crop-pdf-by-stem.py` 가 이 모듈을 통째로 import 한다 — **공통 규칙은 여기 한 곳에** |

**그림 파일은 밀어야 배포본에 간다.** 공유 DB 는 즉시 최신인데 파일은 git 이다 —
붙이고 안 밀면 production 만 조용히 깨진다(2026-08-20 실제 발생).
`.husky/pre-push` 가 막아 주지만, **미는 것까지가 완료 조건**이다.
