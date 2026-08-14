# 핸드오프 — 다른 컴퓨터에서 이어 작업

작성: 2026-08-14  
저장소: [BIGSHOL/todays-math](https://github.com/BIGSHOL/todays-math)  
기준 커밋: `d252960` (`main`, D-31 공용 풀 적재)

이 문서만 읽고 새 머신에서 개발 서버까지 올릴 수 있게 쓴다. 기획 SSOT는 아래에 링크만 둔다.

---

## 1. 제품이 어디인가

동네 수학학원 원장이 **진도만 넣으면** 일일/확인테스트가 나오는 도구.  
코드명 폴더는 `testautocreator`, 앱 이름은 **오늘의수학**.

교사 전용. 학생 앱은 없음.

**지금 돌아가는 화면**

| 경로 | 화면 |
|------|------|
| `/login` `/signup` | 로그인/가입 |
| `/onboarding` | 반·학생·진도 첫 입력 |
| `/` | 메인 (오늘 작업 스택 / 전체 표 + 진도 패널) |
| `/classes` | 반·학생·단원 트리 |
| `/problems` | 문제은행 |
| `/tests/new` | 출제 설정 |
| `/tests/[id]` | 검수 (본문 클릭 → 답·해설) |
| `/tests/[id]/print` | 자습 H1 인쇄 미리보기 |

**아직 사람이 해야 하는 일**

1. **T5.2** 실물 프린터로 문제지/정답지 출력 검수 (코드는 있음)
2. **T6.2** Vercel 배포 + 프로덕션 env
3. Google OAuth 키 (없으면 「구글 계정으로 계속」은 눌러도 실패)
4. Claude API 키 (없으면 AI 생성/변형만 실패. 출제는 승인된 은행 문항으로 가능)
5. 미분류 기출 4618·그림 986·기하 단원 공란 — 자동 적재에서 빠짐. 손분류/작도는 별도

---

## 2. 새 컴퓨터 첫 30분

### 받을 것 (구 컴퓨터에서)

Git에 없는 것:

| 파일 | 이유 |
|------|------|
| `.env` | Supabase URL, `AUTH_SECRET`, (있으면) `ANTHROPIC_API_KEY` |
| 로컬에만 있는 대용량 import JSON | `scripts/import/reports/` 일부는 gitignore |

`.env`를 USB/비밀번호 관리자로 옮긴다. 채팅·커밋에 붙이지 말 것.

### 클론

```powershell
git clone https://github.com/BIGSHOL/todays-math.git
cd todays-math
git checkout main
git pull
```

폴더 이름은 무엇이든 된다. 이 문서의 경로 예는 `C:\Creative\testautocreator`.

### Node / Docker

- Node 20+ (이 세션은 24)
- `npm install`
- E2E를 돌릴 때만 Docker Desktop. **앱 런타임 DB는 Docker가 아니라 Supabase.**

### `.env`

`.env.example`을 복사한 뒤, 구 머신 `.env` 값을 그대로 넣는 것이 가장 안전하다.

필수:

```
DATABASE_URL=          # Supabase pooler (보통 6543)
DIRECT_URL=            # Supabase 직결 (5432) — 마이그레이션용
AUTH_SECRET=           # 없으면 로그인 Server error
AUTH_TRUST_HOST=true
AUTH_URL=http://localhost:3000
```

있으면:

```
ANTHROPIC_API_KEY=
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
```

`AUTH_SECRET`은 `openssl rand -base64 32`로 새로 만들어도 된다. **바꾸면 기존 세션 쿠키는 무효.** 같은 DB를 쓰면 계정은 그대로다.

### DB

앱은 **호스티드 Supabase** (서울 `ap-northeast-2`). 로컬 Docker `postgres_db`는 E2E 전용(포트 **5433**).

```powershell
npx prisma generate
npx prisma migrate deploy
npm run dev
```

브라우저: http://localhost:3000

마이그레이션이 빠져 있으면 출제 500이 난다. `direct_use_allowed`와 `pool` 컬럼이 모두 있어야 한다. `migrate deploy`가 답이다.

### 테스트 계정 (이미 Supabase에 있음)

| 역할 | 이메일 | 비밀번호 | 이름 |
|------|--------|----------|------|
| 선생 | `test_t@osu.com` | `1234@@@@` | 강선생 |
| 학생 | `test_s@osu.com` | `1234@@@@` | 김학생 |

선생으로 로그인하면 반 **테스트반**(중2), 학생 **김학생**, 진도 중2 수와 식 쪽.  
`test_s`로 로그인해도 학생 UI는 없다. 빈 선생 화면이 나온다.

은행은 **공용 풀(D-31)** 이다. 특별 지시가 없으면 신규·이관 문항은 전부 `pool=shared`.

| 구분 | 건수 |
|------|------|
| 전체 (전부 shared, approved) | 9197 |
| 출제 가능 (`directUseAllowed=true`) | 4335 (기출 3569 + 자작/기존 766) |
| RPM 잠금 (D-26, 변형 원본만) | 4862 |
| 단원 735 중 문항 있는 단원 | 307 (공란 428, 기하는 0) |

재집계: `npx tsx scripts/count-problems.mts`  
재적재(중복 지문 스킵): `$env:ALLOW_SHARED_IMPORT="1"; npx tsx scripts/import/load-classified.ts`

---

## 3. 매일 쓰는 명령

```powershell
npm run dev
npm run test
npm run lint
npm run lint:affordance
npm run type-check
npx playwright test          # Docker 5433 E2E
npx prisma migrate deploy
npx prisma studio
```

이전 감사/엔진:

```powershell
npm run transfer:audit
npm run transfer:verify-engine
npm run transfer:visual
```

---

## 4. 작업 규칙 (에이전트도 동일)

기획 SSOT: `docs/planning/01`~`07`. `Claude.md` 절대 규칙.

| 규칙 | 내용 |
|------|------|
| 오르카 기본 | 나눌 수 있으면 **다중 세션 → main 병합**. 순차는 의존 있을 때만 |
| TDD | Phase 1+ 테스트 없이 구현 금지 |
| Worktree | Phase 1+: `git worktree add ../todays-math-phase{N}-{feature} -b phase/{N}-{feature}` |
| 디자인 | `05-design-system.md` `[확정]`만 구현. `[협의 필요]`면 시안 |
| 문구 | 간결·사무적. 느낌표·이모지 없음 (D-08) |
| 커서 | 누르는 곳에만 손가락 (D-30). `npm run lint:affordance` |
| Claude | 서버 env만. 테스트에서 실호출 금지 |
| 인쇄 | 실물 출력까지가 T5.2 완료 |
| 원본 저장소 | Mathgen / 시험지변환기 / sumaek **수정 금지** |

---

## 5. 아키텍처 한 줄

Next.js 16 App Router 풀스택. Prisma 6.19.3 + PostgreSQL. Zod는 `src/contracts/`. Auth.js JWT + Credentials (+ Google 키가 있을 때만). Tailwind v4, 기성 킷 없음. KaTeX는 `src/lib/math/` 한 경로.

- 인증 가드: `src/proxy.ts` (미로그인 → `/login`, API는 통과)
- Prisma 7 쓰지 말 것 (schema 안 `url` 제거됨, 레슨 있음)

---

## 6. 최근 제품 결정 (화면)

- 헤더 글자 150% (로고 28.5px)
- 메인 진도: `< 차시이동 >`. **직접 선택**은 메인에 없음 → **반** 화면 트리
- 검수: 문N \| 본문 구분선. 본문 클릭 → 답·해설. 없으면 `해설 없음`
- 순환소수: `.repeat-dot` CSS 점 (KaTeX `\dot`은 작아서 안 보였음)
- 정답지 대분수: 다단 `overflow`에 분자 잘림 여백 수정
- 버튼 라벨 `whitespace-nowrap`
- D-22: AI 생성은 **pending만**. 출제 풀은 승인 후
- D-26: RPM 원본 `directUseAllowed=false`
- D-28: 인쇄는 자습 H1
- D-31: 특별 지시 없으면 전부 공용 풀 (`pool=shared`)

---

## 7. T3.0 / 시험지변환기 — 함정

`docs/transfer/AUDIT-2026-08-14.md` 결론:

- OCR 원본 9,173문항. 적재 가능 3,569 / 미분류 4,618 / 그림 보류 986
- **2026-08-14 D-31 이후**: 공유 Supabase `problem` 9,197건 전부 `pool=shared`·`approved`. 출제 가능 4,335. RPM 4,862는 잠금
- 미분류·그림 보류·기하 단원은 자동 적재 대상 아님
- 소스 경로 예: `F:\시험지변환기\db\ocr_pilot` — 새 PC에 그 디스크가 없으면 재분류 불가
- 재적재는 `ALLOW_SHARED_IMPORT=1`. PowerShell `Out-File`로 JSON 덤프하지 말 것 (BOM으로 parse 실패)

---

## 8. 다음에 하면 좋은 일

우선순위 제안 (오르카로 쪼갤 수 있으면 쪼갠다):

| ID | 일 | 담당 | 비고 |
|----|----|------|------|
| T5.2 | 실물 인쇄 | 원장님 | 코드 완료. 출력물 보면 됨 |
| T3.0 잔여 | 미분류 4618·그림 986·기하 | 원장님+에이전트 | 분류 완료분은 이미 공용 풀 |
| T6.2 | Vercel | 원장님+에이전트 | env: DB, AUTH_SECRET, AUTH_URL, Claude |
| — | Google OAuth | 원장님 | 콘솔 키만 |
| — | 해설 채우기 | 데이터 | 지금 시드 문항 다수 `해설 없음` |

작은 UI  interation은 이 세션에서 메인에 이미 들어갔다. 새 머신에서 `git pull`만 하면 된다.

---

## 9. 자주 깨지는 것

| 증상 | 원인 | 조치 |
|------|------|------|
| 로그인 Server error | `AUTH_SECRET` 없음 | `.env`에 넣고 서버 재시작 |
| `POST /api/tests/generate` 500 | `direct_use_allowed` 컬럼 없음 | `npx prisma migrate deploy` |
| 출제 부족 | 승인 문항 없음 / D-22 pending | 문제은행에서 승격 |
| 순환소수 점 안 보임 | 옛 빌드 | `main` 최신. `.repeat-dot` |
| E2E가 운영 DB를 침 | DATABASE_URL 혼동 | E2E는 localhost **5433**만 |
| Prisma 7 설치 | `url` 스키마 오류 | 6.19.x 유지 |

---

## 10. 오르카 / 워크트리

이 핸드오프 작성 시점: **실행 중 자식 세션 없음.**  
`audit-testchagner-transfer`는 `01dcef3`으로 main 병합 후 워크트리 제거됨. 브랜치 `BIGSHOL/audit-testchagner-transfer`는 로컬에 남을 수 있음.

끝난 오르카 세션은 병합·clean이면 워크트리 삭제. 브랜치는 기본 보존.

---

## 11. 문서 지도

| 문서 | 언제 |
|------|------|
| `Claude.md` | 에이전트 절대 규칙·레슨 |
| `docs/planning/01-prd.md` | 무엇을 만드나 |
| `docs/planning/02-trd.md` | 어떻게 만드나 |
| `docs/planning/05-design-system.md` | UI/인쇄. `[확정]` 확인 |
| `docs/planning/06-tasks.md` | 태스크 체크박스 |
| `docs/planning/07-coding-convention.md` | 용어·D-01~30 |
| `docs/transfer/*` | 시험지변환기 감사·엔진 |
