# 10 — 작업 인수인계 (다른 컴퓨터에서 이어하기)

작성: **2026-08-15** · 기준 커밋: `9a4f688` (main, 푸시 완료) · 작업 트리 깨끗함

> **다른 컴퓨터에서 이 문서 하나만 읽고 이어할 수 있게 쓴 문서다.**
> 순서: §1 환경 준비 → §2 지금까지 한 일 → §3 **바로 다음에 할 일** → §4 확인 대기 항목.
> 이관 세부는 `08-import-ledger.md`, 도형은 `09-figure-engine-guide.md`.

---

## 0. 한 줄 요약

기출 이관을 **완료본(원본) 한정**으로 못박고(D-37), 로컬 인덱스에서 30편 파일럿을
적재해 검증까지 끝냈다. **다음 할 일은 나머지 328편을 같은 방법으로 마저 넣는 것**인데,
그 전에 원장님 확인 2건(§4)이 남아 있다.

---

## 1. 새 컴퓨터에서 준비할 것

### 1.1 저장소

```bash
git clone https://github.com/BIGSHOL/todays-math
cd todays-math && npm install
```

현재 `main` = `9a4f688`. 작업 트리에 미커밋 변경 없음.

### 1.2 ⚠️ 저장소 밖 의존물 — 이게 없으면 이관 작업을 못 한다

| 대상 | 경로 | 크기 | 용도 |
|---|---|---|---|
| **testchanger(시험지 한글화) 저장소** | `D:\시험지 한글화` | — | 추출 엔진 |
| └ `db/exam_index.db` | 같은 곳 | **16MB** | **이미 추출된 9,173문항 · 시험지 5,925편 인덱스** |
| └ `db/textlayer.py` | 같은 곳 | — | PDF 텍스트레이어 → 문항 (PUA 되돌리기) |
| └ `db/pua_table.json` | 같은 곳 | — | HWP 수식폰트 코드표 |
| └ `scripts/hwp_extract.py` | 같은 곳 | — | 완료 HWP → 정답·해설 |
| N드라이브 | `N:` (네이버 MYBOX) | — | 원본 시험지. **§3 단계에선 불필요** |

**경로가 다르면** 아래 스크립트의 상수를 고친다 (모두 `D:\시험지 한글화` 하드코딩):
`scripts/qa/*.py` 의 `IDX` / `TC` 상수.

### 1.3 .env (커밋 안 됨 — 원장님께 받아야 함)

```
DATABASE_URL / DIRECT_URL     공유 Supabase (프로젝트 jyaguxwuaxgdnovtulna, Seoul)
AUTH_SECRET / AUTH_TRUST_HOST / AUTH_URL
DEEPSEEK_API_KEY              문제 생성·변형용
POSTGRES_*                    로컬 docker 되돌릴 때만
```

### 1.4 파이썬 · 기타

- Python 3.11+ · `PyMuPDF(fitz)` · `fontTools` (설치돼 있었음)
- **한컴오피스**(HWP COM) — `hwp_extract.py` 가 `.hwp`→`.hwpx` 변환에 쓴다.
  §3 A단계(로컬 인덱스 이관)에는 **필요 없다**. B단계(N드라이브 신규 추출)에만 필요.
- 파이썬 출력은 항상 `PYTHONIOENCODING=utf-8` 로 실행할 것(한글 깨짐).

### 1.5 재생성해야 하는 산출물 (gitignore 됨)

`scripts/qa/reports/*.json` 은 커밋되지 않는다. 새 컴퓨터에서 아래로 다시 만든다.
**전부 로컬 계산이라 토큰 0**이다.

```bash
python scripts/qa/select-final-sources.py     # → extract-queue.json  (N: 불필요)
python scripts/qa/pair-final-sources.py       # → final-pairs.json    (N: 불필요)
```

`scripts/qa/*.txt`(원장)와 `nfile-inventory.txt.gz` 는 **커밋돼 있으니 다시 만들지 말 것.**

---

## 2. 지금까지 한 일 (2026-08-14 ~ 15)

### 2.1 현재 DB 상태 (공유 Supabase, 2026-08-15 기준)

| | 값 |
|---|---|
| 전체 문항 | **9,552** |
| └ transformed / past_exam / manual | 4,862 / 3,924 / 766 |
| 정답 보유 (출제 가능) | **6,261** |
| 원본 역추적 가능(`externalId`) | **2,637** |
| 도형 SVG(`figureSvg`) | 0 — 아직 시작 안 함 |

### 2.2 커밋 이력 (이번 작업 구간)

| 커밋 | 내용 |
|---|---|
| `bd162b8` | 정답 AI 백필 2,409건 + 이관 원장·전수검사 도구 |
| `8c6b9b1` | `figureSvg` 컬럼 + 도형 엔진 지침(09) |
| `c48b4c7` | 정답 백필 전량 완료 |
| `1ed51df` | 역추적 메타데이터 적재 + `externalId` 중복 차단 |
| `24a2462` | 원본 역추적 스크립트(exam_index 대조) |
| `dfb3772` | **D-37 — 기출 추출 완료본 한정** |
| `abc293f` | 완료본 추출 경로 검증(비용 0 확인) |
| `9a4f688` | **파일럿 30편 적재(신규 355건)** ← 현재 |

### 2.3 확정된 방침

- **D-37**: 기출 추출은 `(완료)` 표기 원본에서만. `toLoadRows` 가 코드로 막는다.
  예외는 `ALLOW_NON_FINAL_SOURCE=1`.
- **D-31**: 특별 지시 없으면 전부 `pool=shared`, `reviewStatus=approved`.
- **정답 없는 문항은 출제 제외** — `findEligibleProblems` 가 센티널 `(정답 없음)` 을 뺀다.

### 2.4 이번에 알아낸 사실 (재조사 금지 — 08 §5.1.x 에 상세)

1. **로컬 `exam_index.db` 에 이미 추출된 9,173문항이 있다**(시험지 358편).
   소단원 86.1% · 정답 84.1%. 우리 DB 에 들어온 건 2,301건뿐이었다.
   **N드라이브를 뒤지기 전에 이걸 먼저 비운다.**
2. 완료본 PDF 는 **100% born-digital** — OCR API 불필요, 토큰 0.
3. 수식은 HWP 수식폰트의 **PUA(U+E0xx)** 로 박혀 있다. `textlayer.py` + `pua_table.json`
   이 이미 해결해 뒀다. **직접 만들지 말 것.**
4. **정답은 완료 PDF 에 없다.** 완료 **HWP** 에 있다(§3 B단계에서 짝지어 추출).
5. N드라이브 미추출 완료본 페어 **2,257편**(약 4.3만 문항 예상), 1편당 3.9초 → 약 2.4시간.

---

## 3. 바로 다음에 할 일

### ▶ A단계 (권장 시작점) — 로컬 인덱스 나머지 328편 이관

**N드라이브 불필요 · 한컴 불필요 · 토큰 0.** 파일럿과 완전히 같은 절차다.

```bash
cd D:/todays-math

# 1) 완료본 시험지 전체(358편)를 이관 형태로 내보낸다.
#    파일럿에서 이미 넣은 30편도 포함되지만 적재 단계에서 externalId 로 걸러진다.
PYTHONIOENCODING=utf-8 python scripts/qa/export-index-batch.py --limit 358

# 2) 드라이런 — 단원 매핑률과 정답 보유를 먼저 눈으로 확인
FINAL_BATCH_DIR=scripts/qa/reports/index-batch npx tsx scripts/import/final-batch.ts

# 3) 실제 적재 (공유 풀에 씀 — 원장님 승인 하에)
ALLOW_SHARED_IMPORT=1 FINAL_BATCH_DIR=scripts/qa/reports/index-batch \
  npx tsx scripts/import/final-batch.ts --apply

# 4) 원장 갱신
node scripts/qa/build-import-ledger.mjs
```

**예상**: 완료본 358편의 총 문항은 **7,966건**(A버킷 2,996 + B버킷 4,970).
파일럿이 그중 681건을 처리했으니 **남은 것은 약 7,285건**.
파일럿 비율(681문항 → 신규 355건 = 52%)로 추정하면 **신규 약 3,800건**.
나머지는 중복(이미 DB에 있음)·그림 제외·단원 미분류로 빠진다.

⚠️ 적재 전 `--apply` 없이 드라이런을 먼저 돌려 매핑률이 파일럿(77.4%)과
비슷한지 확인할 것. 크게 다르면 멈추고 원인을 볼 것.

### ▶ B단계 — N드라이브 신규 추출 (A단계 끝난 뒤)

**N드라이브 연결 + 한컴오피스 필요.**

```bash
python scripts/qa/pair-final-sources.py                    # 페어 2,257편 산출
PYTHONIOENCODING=utf-8 python scripts/qa/extract-final-batch.py --limit 30   # 먼저 30편
FINAL_BATCH_DIR=scripts/qa/reports/final-batch npx tsx scripts/import/final-batch.ts
```

- N드라이브는 **작업 중 끊긴다**(실제 발생). 스크립트가 최대 10분 재연결을 기다리고,
  이미 만든 산출물은 건너뛰므로 **같은 명령 재실행이 곧 이어달리기**다.
- 전량은 `--limit 2257`, 단일 프로세스 약 2.4시간.

### ▶ C단계 — 도형(그림 참조 문항)

착수 안 함. 워크트리 `D:/todays-math-figures`(`phase/figures`) 와 `figureSvg` 컬럼,
`09-figure-engine-guide.md` 준비 완료. 그림 참조 약 2,155건.
SVG 로 불가능한 그림은 원장님 지시대로 **grok/codex** 로 처리.

---

## 4. ⚠️ 원장님 확인 대기 (A단계 진행 전에 물어볼 것)

### 4.1 단원 힌트 매칭 방식 변경

파일럿에서 **22.6%(111건)가 단원 미분류**였다. 소단원명 표기가 우리 트리와 다르다.

| 시험지 소단원 | 우리 트리 | 건수 |
|---|---|---|
| 나머지정리와 인수정리 | 나머지와 인수정리(1)/(2) | 29 |
| 이차함수와 직선의 위치관계 | 같은 이름 없음 | 11 |
| 미정계수법 | 같은 이름 없음 | 10 |
| 조립제법 | 같은 이름 없음 | 5 |

`src/lib/import/mapUnit.ts` 의 `mapUnitHint` 는 **부분문자열 포함**만 본다.
**단어 겹침 점수**로 바꾸면 상당수가 붙지만, 공용 분류 로직이라 다른 이관(RPM·자작)에도
영향이 간다. → **손대도 되는지 확인 필요.**

### 4.2 고등 과목명 → 교육과정 라벨 대응

`scripts/qa/final_meta.py` 의 `HIGH_SUBJECT`. 2022 개정 명칭으로 옮겼다.

| 시험지 표기 | 우리 트리 | 확인 |
|---|---|---|
| 수상 · 공수1 | 공통수학1 | 자명 |
| 수하 · 공수2 | 공통수학2 | 자명 |
| 수1 | **대수** | ⚠️ |
| 수2 | **미적분1** | ⚠️ |
| 미적분 | **미적분2** | ⚠️ |
| 확통 | 확률과 통계 | 자명 |
| 기하 · 기벡 | 기하 | 자명 |

⚠️ 세 줄이 과거 명칭→현행 대응이라 확인이 필요하다.

---

## 5. 함정 모음 (같은 실수 반복 금지)

- **N드라이브는 도중에 끊긴다.** 배치 30편이 통째로 `FileNotFoundError` 로 탔다.
- **`pg_advisory_xact_lock` 은 `$executeRaw` 로 부른다.** `$queryRaw` 면 void 반환을
  역직렬화하다 Prisma 6 가 죽는다. 테스트가 모킹해 침묵하던 버그 — 지금은 회귀 테스트 있음.
- **공유 DB 적재는 기본 차단.** `ALLOW_SHARED_IMPORT=1` 을 명시해야 쓴다.
  새 적재 스크립트를 만들면 이 관문을 **반드시 같이 넣을 것**(한 번 우회한 적 있음).
- **파이썬 `-c` 에 백슬래시 경로를 넣지 말 것.** `'N:\'` 가 문자열을 먹어 SyntaxError.
  스크립트 파일이나 heredoc 을 쓴다.
- **파일명에 하이픈이 있으면 import 불가.** 공용 유틸은 `final_meta.py` 처럼 밑줄로.
- **`problemFingerprint` 로 중복 판별 금지** — 정답 백필로 지문이 바뀌었다.
  `externalId` → 본문 해시 순으로 본다.
- **토큰 절약**: 스캔·집계는 스크립트가 하고 화면에는 요약만. 문항 본문을 대화에 올리지 말 것.

---

## 6. 스크립트 지도 (`scripts/qa/`)

| 파일 | 하는 일 | N: 필요 |
|---|---|---|
| `export-index-batch.py` | **exam_index → 이관 형태 내보내기** (A단계 핵심) | ✕ |
| `select-final-sources.py` | 완료본 추출 대기열 산출 | ✕ |
| `pair-final-sources.py` | 완료본 PDF↔HWP 페어링 | ✕ |
| `extract-final-batch.py` | **N드라이브 실추출** (B단계 핵심) | ○ |
| `survey-final-only.py` | D-37 근거표 재현 | ✕ |
| `probe-text-layer.py` | PDF 텍스트레이어 유무 표본 조사 | ○ |
| `verify-queue-files.py` | 대기열 파일 실재 확인 | ○ |
| `textlayer-pilot.py` · `peek-pdf-text.py` | 추출 품질 눈으로 보기 | ○ |
| `time-extract.py` | 1편당 소요 측정 | ○ |
| `ocr-audit.mjs` | OCR 결함 전수검사(원장으로 재검사 방지) | ✕ |
| `build-import-ledger.mjs` | 본문 해시 원장 갱신 | ✕ |
| `trace-source.py` · `enrich-source-meta.py` · `backfill-source-meta.mjs` | 원본 역추적·메타 백필 | ✕ |
| `compare-answers.mjs` | 원본 정답 ↔ 현재 정답 대조 | ✕ |

적재: `scripts/import/final-batch.ts` (변환 → 단원분류 → 적재, 드라이런 기본)

---

## 7. 검증 명령

```bash
npm run test          # 440개 통과 상태
npm run type-check
npm run lint          # 경고 1건(기존, lint-staged.config.mjs)은 정상
```
