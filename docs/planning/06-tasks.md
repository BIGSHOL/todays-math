# TASKS: 오늘의수학 - AI 개발 파트너용 태스크 목록

> 이 문서는 오케스트레이터와 서브 에이전트가 사용하는 실행 계획입니다.
> Phase 0 = main 브랜치 직접 작업 / Phase 1+ = Git Worktree 필수 + TDD (RED→GREEN→REFACTOR)

---

## MVP 캡슐

1. 목표: 진도만 입력하면 수학 일일/확인테스트가 5분 안에 완성되어, 매일 30분~1시간을 되찾는다
2. 페르소나: 반별·학생별 진도가 다른 동네 수학학원 원장/강사
3. 핵심 기능: FEAT-1 진도 기반 자동 출제
4. 성공 지표 (노스스타): 주 5일 이상 실제 사용
5. 입력 지표: ① 진도 입력→인쇄까지 5분 이내 ② 무수정 사용률 80%
6. 비기능 요구: 수식이 깨지지 않는 A4 인쇄 품질
7. Out-of-scope: 학생용 앱, 자동 채점, 모바일 앱, 결제
8. Top 리스크: AI 생성 문제 품질로 인한 검수 부담
9. 완화/실험: 검수 화면 1클릭 교체 + 무수정 사용률 측정
10. 다음 단계: M0 프로젝트 셋업부터 순차 실행

---

## 기술 스택 (TRD 확정)

| 항목 | 선택 |
|------|------|
| 프레임워크 | Next.js 15+ (App Router) 풀스택 단독, TypeScript |
| 스타일링 | Tailwind CSS v4 — 기성 컴포넌트 킷 금지 (D-15) |
| DB/ORM | PostgreSQL (Supabase/Neon) + Prisma |
| 검증/계약 | Zod (`src/contracts/` = SSOT) |
| 인증 | Auth.js (NextAuth v5) — 이메일/구글 |
| AI | Claude API (`@anthropic-ai/sdk`) — 테스트에서는 항상 MSW 모킹 |
| 수식/인쇄 | KaTeX + 브라우저 인쇄 CSS |
| 테스트 | Vitest + RTL + MSW + Playwright |

**⚠️ UI 태스크 공통 게이트 (D-23)**: 화면 구현 전 `05-design-system.md`에서 해당 화면이
`[확정]`인지 확인. `[협의 필요]`면 시안 제시 → 원장님 확정 후 구현 착수.

---

## 마일스톤 개요

| 마일스톤 | Phase | 설명 | 주요 기능 |
|----------|-------|------|----------|
| M0 | Phase 0 | 프로젝트 셋업 | git init, Next.js, Prisma, 시드, 테스트 인프라 |
| M0.5 | Phase 0 | 계약 & 테스트 설계 | Zod 계약, MSW Mock, RED 테스트 |
| M1 | Phase 1 | FEAT-0 인증/온보딩 | 로그인, 가입, 온보딩 |
| M2 | Phase 2 | FEAT-4 반/학생/진도 관리 | CRUD + 진도 이력 |
| M3 | Phase 3 | FEAT-5 문제은행 | 등록, AI 생성/변형 |
| M4 | Phase 4 | FEAT-1+2 출제 엔진 (심장) | 자동 출제 + 난이도 균형 + 중복 방지 |
| M5 | Phase 5 | FEAT-3 시험지 인쇄 | 지면 디자인, 미리보기, 인쇄, 지표 기록 |
| M6 | Phase 6 | 통합 검증 | E2E, 실물 인쇄 검수, 배포 |

---

## M0: 프로젝트 셋업 (Phase 0 — main 직접 작업)

### [] Phase 0, T0.1: Git 저장소 + Next.js 프로젝트 초기화

**담당**: frontend-specialist

**작업 내용**:
- `git init` (현재 저장소 아님 — 최초 1회)
- Next.js 15+ 프로젝트 생성 (TypeScript, App Router, Tailwind CSS, ESLint)
- Prettier + husky + lint-staged 설정
- `.env.example` 작성 (DATABASE_URL, AUTH_SECRET, GOOGLE_CLIENT_ID/SECRET, ANTHROPIC_API_KEY)
- 디렉토리 골격 생성: `src/contracts/`, `src/lib/generator/`, `src/lib/ai/prompts/`, `src/components/`, `src/mocks/`, `src/__tests__/`, `e2e/`

**산출물**:
- Next.js 프로젝트 루트 일식, `.env.example`, `.gitignore`

**완료 조건**:
- [ ] `npm run dev` 정상 구동
- [ ] `npm run lint` / `npm run type-check` 통과
- [ ] 최초 커밋 완료

### [] Phase 0, T0.2: Prisma 스키마 + DB 연결

**담당**: database-specialist

**작업 내용**:
- `04-database-design.md`의 9개 엔티티를 `prisma/schema.prisma`로 구현
  (User, Class, Student, Unit, Progress, Problem, Test, TestProblem + Auth.js 요구 테이블)
- 인덱스 정의 (특히 `(unit_id, difficulty, review_status)` 출제 조회 최적화)
- Supabase 또는 Neon 무료 인스턴스 연결, 첫 마이그레이션 실행

**산출물**:
- `prisma/schema.prisma`, 마이그레이션 파일

**완료 조건**:
- [ ] `npx prisma migrate dev` 성공
- [ ] `npx prisma studio`에서 전체 테이블 확인

### [] Phase 0, T0.3: UNIT 교육과정 시드 데이터

**담당**: database-specialist

**작업 내용**:
- 한국 수학 교육과정(중1~고3) 학년>대단원>소단원 트리를 `prisma/seed.ts`로 작성
- `order_index`는 교육과정 순서와 정확히 일치 (진도 "다음으로" 이동의 기준)
- 우선 원장님 수업 학년부터 (범위는 원장님 확인 필요 — 예: 중1~중3 먼저)

**산출물**:
- `prisma/seed.ts`

**완료 조건**:
- [ ] `npx prisma db seed` 성공
- [ ] 원장님이 단원 트리 표기(교재 용어와 일치 여부) 확인

### [] Phase 0, T0.4: 테스트 인프라 구축

**담당**: test-specialist

**작업 내용**:
- Vitest + React Testing Library 설정 (`vitest.config.ts`)
- MSW 설정 (`src/mocks/server.ts`)
- Playwright 설정 (`playwright.config.ts`)
- 테스트 전용 DB 스키마/환경 분리
- 커버리지 리포트 설정 (목표 80%)

**산출물**:
- `vitest.config.ts`, `playwright.config.ts`, `src/mocks/server.ts`, 샘플 테스트 1개

**완료 조건**:
- [ ] `npm run test` 샘플 테스트 통과
- [ ] `npx playwright test` 구동 확인

---

## M0.5: 계약 & 테스트 설계 (Phase 0 — main 직접 작업)

### [] Phase 0, T0.5.1: Zod 계약 정의 (API SSOT)

**담당**: backend-specialist

**작업 내용**:
- `src/contracts/auth.contract.ts` — 가입/로그인 요청·응답
- `src/contracts/class.contract.ts` — 반/학생/진도 CRUD
- `src/contracts/problem.contract.ts` — 문제 등록/조회/AI 생성/변형
- `src/contracts/test.contract.ts` — 출제 요청(대상/유형/문항수/난이도배분)·검수·교체·확정
- 공통 에러 응답 스키마 (`INSUFFICIENT_PROBLEMS` 등 에러 코드 포함)

**산출물**:
- `src/contracts/*.contract.ts` (Zod 스키마 + `z.infer` 타입 export)

**완료 조건**:
- [ ] `03-user-flow.md`의 8개 화면이 필요로 하는 API가 계약으로 모두 커버됨
- [ ] `npm run type-check` 통과

### [] Phase 0, T0.5.2: MSW Mock 핸들러 + Mock 데이터

**담당**: test-specialist

**작업 내용**:
- 계약 기반 MSW 핸들러: `src/mocks/handlers/{auth,class,problem,test}.ts`
- **Claude API Mock**: 문제 생성/변형 응답 고정 픽스처 (`src/mocks/data/aiProblems.ts`)
- Mock 데이터: 반 2개, 학생 5명, 문제 30개(난이도/유형 분포), 진도 기록

**산출물**:
- `src/mocks/handlers/*.ts`, `src/mocks/data/*.ts`

**완료 조건**:
- [ ] 모든 핸들러 응답이 Zod 계약 파싱 통과
- [ ] 화면 개발이 실제 API 없이 가능한 상태

### [] Phase 0, T0.5.3: RED 테스트 선행 작성

**담당**: test-specialist

**작업 내용**:
- API 테스트 뼈대: `src/__tests__/api/{auth,class,problem,test}.test.ts` — 계약 기반, 전부 실패(RED) 상태
- 출제 엔진 단위 테스트: `src/__tests__/unit/generator.test.ts`
  - 난이도 배분 (예: 8문항 = easy 3 / mid 4 / hard 1)
  - 최근 14일 중복 제외 (D-20)
  - 확인테스트 범위 계산 (order_index 기반)
  - 문제 부족 시 폴백 (INSUFFICIENT_PROBLEMS)
- 수식 렌더링 테스트 케이스: 분수·루트·지수·도형 기호

**산출물**:
- `src/__tests__/api/*.test.ts`, `src/__tests__/unit/generator.test.ts` (모두 RED)

**완료 조건**:
- [ ] `npm run test` 실행 시 전부 FAILED (RED 정상 확인)
- [ ] 각 테스트가 참조하는 계약과 1:1 매칭

---

## M1: FEAT-0 인증/온보딩 (Phase 1 — Worktree 필수)

### [] Phase 1, T1.1: Auth.js 인증 API RED→GREEN

**담당**: backend-specialist

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase1-auth -b phase/1-auth
cd ../testautocreator-phase1-auth
# 작업 완료 후 병합 (사용자 승인 필요)
# git checkout main && git merge phase/1-auth
# git worktree remove ../testautocreator-phase1-auth
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/auth.test.ts` 확인
   ```bash
   npm run test -- src/__tests__/api/auth.test.ts   # Expected: FAILED
   ```
2. **GREEN**: Auth.js 설정 + 이메일 가입(bcrypt) + 구글 Provider
   - 구현: `src/app/api/auth/[...nextauth]/route.ts`, `src/lib/auth.ts`
   ```bash
   npm run test -- src/__tests__/api/auth.test.ts   # Expected: PASSED
   ```
3. **REFACTOR**: 세션 헬퍼(`getSessionUser`) 추출 — 이후 모든 API의 소유권 검증에 재사용

**산출물**:
- `src/lib/auth.ts`, `src/app/api/auth/**` (구현) / `src/__tests__/api/auth.test.ts` (테스트)

**인수 조건**:
- [ ] 테스트 먼저 작성됨 (RED 확인)
- [ ] 모든 테스트 통과 (GREEN)
- [ ] 커버리지 ≥ 80%
- [ ] API 키/시크릿이 코드에 하드코딩되지 않음

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 1, T1.2: 로그인/가입 화면 (S-01) RED→GREEN

**담당**: frontend-specialist
**의존성**: T1.1 — **MSW auth 핸들러로 독립 개발 가능**
**⚠️ 디자인 게이트**: 시안 제시 → 원장님 확정 후 구현 (D-23)

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase1-auth-ui -b phase/1-auth-ui
cd ../testautocreator-phase1-auth-ui
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/LoginForm.test.tsx` 작성
   ```bash
   npm run test -- src/__tests__/components/LoginForm.test.tsx   # FAILED
   ```
2. **GREEN**: `src/app/(auth)/login/page.tsx`, `src/components/auth/LoginForm.tsx`
   ```bash
   npm run test -- src/__tests__/components/LoginForm.test.tsx   # PASSED
   ```
3. **REFACTOR**: 공용 Input/Button 컴포넌트 추출 (`src/components/ui/` — 직접 제작)

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN 확인, 커버리지 ≥ 80%
- [ ] 톤 규칙 준수 — 간결·사무적 문구 (D-08)
- [ ] AI 공장식 금지 목록 위반 없음 (05 문서 섹션 0)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 1, T1.3: 온보딩 플로우 (S-02) RED→GREEN

**담당**: frontend-specialist
**의존성**: T2.1(반/학생 API) — **MSW class 핸들러로 독립 개발 가능**
**⚠️ 디자인 게이트**: 시안 확정 후 구현

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase1-onboarding -b phase/1-onboarding
cd ../testautocreator-phase1-onboarding
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/Onboarding.test.tsx` — 반 생성→학생 등록→진도 지정 3단계 흐름
2. **GREEN**: `src/app/(auth)/onboarding/page.tsx`, `src/components/onboarding/*`
3. **REFACTOR**: 진도 트리 선택기를 `src/components/progress/UnitTreePicker.tsx`로 분리 (S-07에서 재사용)

**테스트 명령어**: `npm run test -- src/__tests__/components/Onboarding.test.tsx`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN 확인, 커버리지 ≥ 80%
- [ ] 온보딩 완료 시 메인(S-03) 진입 가능 상태

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## M2: FEAT-4 반/학생/진도 관리 (Phase 2 — Worktree 필수)

### [] Phase 2, T2.1: 반/학생 CRUD API RED→GREEN

**담당**: backend-specialist

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase2-class -b phase/2-class
cd ../testautocreator-phase2-class
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/class.test.ts`
   ```bash
   npm run test -- src/__tests__/api/class.test.ts   # FAILED
   ```
2. **GREEN**: `src/app/api/classes/**`, `src/app/api/students/**` — Zod 검증 + user_id 소유권 검증
3. **REFACTOR**: 소유권 검증 미들웨어 패턴 통일

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] 타 사용자 데이터 접근 시 403 테스트 포함
- [ ] 학생은 이름만 수집 (최소 수집 원칙)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 2, T2.2: 진도 기록/조회 API RED→GREEN

**담당**: backend-specialist

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase2-progress -b phase/2-progress
cd ../testautocreator-phase2-progress
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/progress.test.ts`
   - 반 진도 기록/최신 조회, 개별 진도 우선 적용(use_individual_progress), 이력 누적
2. **GREEN**: `src/app/api/progress/**`, `src/lib/progressResolver.ts` (반/개별 이중 구조 해석 — 순수 함수)
3. **REFACTOR**: 출제 엔진(T4.1)이 쓸 `getCurrentProgress()` 인터페이스 확정

**테스트 명령어**: `npm run test -- src/__tests__/api/progress.test.ts`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] "다음 소단원 1클릭 진행"용 API (order_index 기반) 포함 (D-19)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 2, T2.3: 반/학생 관리 화면 (S-07) RED→GREEN

**담당**: frontend-specialist
**의존성**: T2.1, T2.2 — **MSW 핸들러로 독립 개발 가능**
**⚠️ 디자인 게이트**: 진도 트리 선택기 UX는 `[협의 필요]` — 시안 확정 후 구현 (10초 입력 목표, D-19)

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase2-class-ui -b phase/2-class-ui
cd ../testautocreator-phase2-class-ui
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/ClassManage.test.tsx`, `UnitTreePicker.test.tsx`
2. **GREEN**: `src/app/(main)/classes/page.tsx`, `src/components/progress/UnitTreePicker.tsx`
3. **REFACTOR**: 트리 데이터 로딩 훅 분리

**테스트 명령어**: `npm run test -- src/__tests__/components/ClassManage.test.tsx`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] 진도 갱신이 3클릭 이내(1클릭 진행 기본)로 완료

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## M3: FEAT-5 문제은행 (Phase 3 — Worktree 필수)

### [] Phase 3, T3.1: 문제 CRUD API RED→GREEN

**담당**: backend-specialist

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase3-problem -b phase/3-problem
cd ../testautocreator-phase3-problem
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/problem.test.ts`
   - 등록(source: manual/past_exam), 단원/난이도/유형 필터 조회, review_status 승격
2. **GREEN**: `src/app/api/problems/**`
3. **REFACTOR**: 출제 엔진용 조회 쿼리(`findEligibleProblems`) 분리

**테스트 명령어**: `npm run test -- src/__tests__/api/problem.test.ts`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] LaTeX 포함 본문 저장/조회 무손실

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 3, T3.2: Claude API 래퍼 — 문제 생성/변형 RED→GREEN

**담당**: backend-specialist
**의존성**: 없음 (Claude API는 **MSW/vi.mock으로 모킹** — 실호출 없이 테스트)

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase3-ai -b phase/3-ai
cd ../testautocreator-phase3-ai
```

**Mock 설정**:
```typescript
// 테스트에서 Anthropic SDK 모킹 — 고정 픽스처 응답 (src/mocks/data/aiProblems.ts)
vi.mock('@anthropic-ai/sdk');
```

**TDD 사이클**:
1. **RED**: `src/__tests__/unit/aiGenerator.test.ts`
   - 생성: 단원+난이도 → 계약 스키마에 맞는 문제 JSON (파싱 실패 시 재시도 1회)
   - 변형: 원본 문제 → 숫자/조건 변경, `origin_problem_id` 연결, source='transformed'
   - 생성물은 항상 `review_status='pending'`
2. **GREEN**: `src/lib/ai/client.ts`, `src/lib/ai/prompts/{generate,transform}.ts`, `src/app/api/problems/generate/route.ts`
3. **REFACTOR**: 프롬프트 버전 주석 + 응답 Zod 검증 일원화

**테스트 명령어**: `npm run test -- src/__tests__/unit/aiGenerator.test.ts`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80% (모킹 기준)
- [ ] API 키 서버 전용 (클라이언트 노출 없음)
- [ ] 실제 Claude 호출 스모크 테스트 1회 수동 수행 및 결과 기록

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 3, T3.3: 문제은행 화면 (S-08) RED→GREEN

**담당**: frontend-specialist
**의존성**: T3.1, T3.2 — **MSW 핸들러로 독립 개발 가능**
**⚠️ 디자인 게이트**: 문제 카드(수식 렌더링 포함) 시안 확정 후 구현

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase3-problem-ui -b phase/3-problem-ui
cd ../testautocreator-phase3-problem-ui
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/ProblemBank.test.tsx`, `ProblemCard.test.tsx`
   - KaTeX 렌더링 케이스: 분수·루트·지수·도형 기호
2. **GREEN**: `src/app/(main)/problems/page.tsx`, `src/components/problem/ProblemCard.tsx` (KaTeX)
3. **REFACTOR**: KaTeX 렌더러를 `src/components/math/MathText.tsx`로 분리 (검수·인쇄에서 재사용)

**테스트 명령어**: `npm run test -- src/__tests__/components/ProblemBank.test.tsx`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] 대표 수식 4종 렌더링 테스트 통과

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## M4: FEAT-1+2 출제 엔진 (Phase 4 — Worktree 필수) ★ 심장

### [] Phase 4, T4.1: 출제 엔진 순수 함수 RED→GREEN

**담당**: backend-specialist
**의존성**: 없음 — **순수 함수 (DB/AI 미의존), 인메모리 픽스처로 테스트**

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase4-generator -b phase/4-generator
cd ../testautocreator-phase4-generator
```

**TDD 사이클**:
1. **RED**: `src/__tests__/unit/generator.test.ts` (T0.5.3에서 작성됨 — 보강)
   - 난이도 배분: difficulty_ratio 준수, 문제 부족 시 인접 난이도 대체 규칙
   - 유형 배분: 같은 유형 연속 배치 방지
   - 중복 제외: 최근 14일 출제 problem_id 제외 (D-20)
   - 범위 계산: daily = 현재 진도 소단원 / review = start~end order_index 구간
   - 부족 판정: 가용 < 필요 시 INSUFFICIENT_PROBLEMS 사유 반환
   ```bash
   npm run test -- src/__tests__/unit/generator.test.ts   # FAILED
   ```
2. **GREEN**: `src/lib/generator/{selectProblems,balanceDifficulty,excludeRecent,resolveRange}.ts`
   ```bash
   npm run test -- src/__tests__/unit/generator.test.ts   # PASSED
   ```
3. **REFACTOR**: 결정적(deterministic) 셔플 — 시드 주입으로 테스트 재현성 확보

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN
- [ ] **커버리지 ≥ 80% 필수 (프로젝트 핵심 로직)**
- [ ] 모든 함수 순수 함수 (DB/AI import 없음)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 4, T4.2: 자동 출제 API RED→GREEN

**담당**: backend-specialist
**의존성**: T4.1(엔진), T2.2(진도), T3.1(문제) — **엔진은 직접 import, 진도/문제 조회는 테스트 DB 픽스처로 독립 실행**

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase4-generate-api -b phase/4-generate-api
cd ../testautocreator-phase4-generate-api
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/test.test.ts`
   - POST `/api/tests/generate` (대상/유형/문항수/배분) → draft TEST + TEST_PROBLEM 생성
   - PUT `/api/tests/{id}/problems/{seq}` 문제 교체 (중복 제외 유지, modified=true, replaced=true)
   - POST `/api/tests/{id}/confirm` 확정
   - 문제 부족 시 INSUFFICIENT_PROBLEMS 에러 응답 (가용/필요 수 포함)
2. **GREEN**: `src/app/api/tests/**`
3. **REFACTOR**: 트랜잭션 처리 정리 (출제 원자성)

**테스트 명령어**: `npm run test -- src/__tests__/api/test.test.ts`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] 문제은행 기반 출제 응답 < 3s (테스트 픽스처 기준 성능 확인)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 4, T4.3: 메인 + 출제 설정 + 검수 화면 (S-03, S-04, S-05) RED→GREEN

**담당**: frontend-specialist
**의존성**: T4.2 — **MSW test 핸들러로 독립 개발 가능**
**⚠️ 디자인 게이트**: 검수용 문제 카드 + [교체] 버튼 UX는 `[협의 필요]` — 시안 확정 후 구현

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase4-test-ui -b phase/4-test-ui
cd ../testautocreator-phase4-test-ui
```

**Mock 설정**:
```typescript
// src/mocks/handlers/test.ts (T0.5.2에서 작성) — 출제/교체/확정 시나리오 커버
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/{Main,GenerateSetup,TestReview}.test.tsx`
   - 메인: 준비된 테스트 목록 + 진도 갱신 진입
   - 검수: 문제 목록 렌더링(KaTeX), [교체] 1클릭 동작, 확정 버튼
2. **GREEN**: `src/app/(main)/page.tsx`, `src/app/(main)/tests/**`, `src/components/test/**`
3. **REFACTOR**: 검수 상태 관리 훅 분리

**테스트 명령어**: `npm run test -- src/__tests__/components/TestReview.test.tsx`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] 교체는 1클릭 (확인 모달 없음 — 도구다움)
- [ ] 톤(D-08)·금지 목록(05 §0) 준수

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## M5: FEAT-3 시험지 인쇄 (Phase 5 — Worktree 필수)

### [] Phase 5, T5.1: 시험지 지면 디자인 확정 (협의 태스크 — 코드 없음)

**담당**: 원장님 + AI (협의)
**⚠️ D-24: 최우선 디자인 작업 — T5.2의 선행 게이트**

**작업 내용**:
- 학원명/날짜/이름칸/문항 배치/폰트(명조 vs 고딕 실물 비교)/여백 등 A4 지면 시안 2~3안 제시
- 원장님 피드백 → 확정 → `05-design-system.md`의 해당 항목 `[확정]`으로 갱신

**산출물**:
- 확정된 지면 스펙 (05 문서 갱신 + 시안 파일)

**완료 조건**:
- [ ] 원장님 확정 승인
- [ ] 문제지/답안지 레이아웃 스펙 문서화

### [] Phase 5, T5.2: 인쇄 미리보기 + 인쇄 CSS (S-06) RED→GREEN

**담당**: frontend-specialist
**의존성**: T5.1(지면 확정 — **필수 게이트**), T4.3 — 데이터는 MSW로 독립

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase5-print -b phase/5-print
cd ../testautocreator-phase5-print
```

**TDD 사이클**:
1. **RED**: `src/__tests__/components/TestPrint.test.tsx` + `e2e/print-preview.spec.ts`
   - A4 레이아웃 구성 요소(학원명/날짜/이름칸) 렌더링
   - 문항 페이지 나눔 (`break-inside: avoid`) 적용 확인
   - 답안지 분리 출력 모드
2. **GREEN**: `src/app/(main)/tests/[id]/print/page.tsx`, `src/components/print/**`, 인쇄 전용 CSS (`@media print`)
3. **REFACTOR**: 지면 스펙을 상수화 (`src/lib/print/layout.ts`)

**테스트 명령어**: `npm run test -- src/__tests__/components/TestPrint.test.tsx`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] Playwright 인쇄 미리보기 스크린샷 확인
- [ ] **실물 프린터 출력 검수 통과 (수식·잘림·여백)** — 이 항목 없이는 완료 아님

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 5, T5.3: 사용 지표 기록 API RED→GREEN

**담당**: backend-specialist
**의존성**: T4.2 — 테스트 DB 픽스처로 독립 실행

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase5-metrics -b phase/5-metrics
cd ../testautocreator-phase5-metrics
```

**TDD 사이클**:
1. **RED**: `src/__tests__/api/metrics.test.ts`
   - 인쇄 시 `printed_at` 기록 (노스스타: 주 5일 사용)
   - 교체 발생 시 `modified=true` (무수정 사용률)
   - 주간 요약 조회 API (사용 일수, 무수정 비율)
2. **GREEN**: `src/app/api/tests/[id]/print/route.ts`, `src/app/api/metrics/route.ts`
3. **REFACTOR**: 지표 계산 순수 함수 분리

**테스트 명령어**: `npm run test -- src/__tests__/api/metrics.test.ts`

**산출물**: 위 테스트/구현 파일

**인수 조건**:
- [ ] RED→GREEN, 커버리지 ≥ 80%
- [ ] PRD 4장의 지표 3종이 모두 측정 가능

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## M6: 통합 검증 (Phase 6 — Worktree 필수)

### [] Phase 6, T6.1: E2E 핵심 여정 RED→GREEN

**담당**: test-specialist
**의존성**: M1~M5 병합 완료 — **Mock 제거, 실제 API 연동 검증**

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase6-e2e -b phase/6-e2e
cd ../testautocreator-phase6-e2e
```

**TDD 사이클**:
1. **RED**: `e2e/core-journey.spec.ts`
   - 여정 A (신규): 가입 → 온보딩(반/학생/진도) → 출제 → 검수 → 인쇄 미리보기
   - 여정 B (일상): 로그인 → 준비된 테스트 → 교체 1회 → 확정 → 인쇄 → 진도 갱신
   - 여정 C (예외): 문제 부족 → AI 생성 (모킹) → 출제 완료
   ```bash
   npx playwright test e2e/core-journey.spec.ts   # FAILED
   ```
2. **GREEN**: 통합 과정에서 발견되는 연동 버그 수정
3. **REFACTOR**: 테스트 픽스처 정리

**산출물**: `e2e/core-journey.spec.ts`

**인수 조건**:
- [ ] 3개 여정 모두 통과
- [ ] MSW 없이 실제 API로 동작

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

### [] Phase 6, T6.2: 배포 + 실사용 준비

**담당**: frontend-specialist
**의존성**: T6.1

**Git Worktree 설정**:
```bash
git worktree add ../testautocreator-phase6-deploy -b phase/6-deploy
cd ../testautocreator-phase6-deploy
```

**작업 내용**:
- Vercel 배포 (환경변수 설정: DB, Auth, Claude API)
- 프로덕션 DB (Supabase/Neon) 마이그레이션 + UNIT 시드
- 원장님 계정 + 동료 강사 계정 생성
- 실물 인쇄 최종 검수 (프로덕션 환경)
- 2주 실사용 실험 시작 (PRD 7.2 실험 루프)

**산출물**:
- 프로덕션 URL, 배포 문서 (`docs/deploy.md`)

**인수 조건**:
- [ ] 프로덕션에서 여정 B(일상 루프) 수동 검증 통과
- [ ] 실물 인쇄 검수 통과
- [ ] 노스스타 측정 시작 (printed_at 기록 확인)

**완료 시**:
- [ ] 사용자 승인 후 main 병합, worktree 정리

---

## 의존성 그래프

```mermaid
graph TD
    subgraph "Phase 0 (main)"
        T01[T0.1 프로젝트 초기화] --> T02[T0.2 Prisma 스키마]
        T02 --> T03[T0.3 UNIT 시드]
        T01 --> T04[T0.4 테스트 인프라]
        T04 --> T051[T0.5.1 Zod 계약]
        T051 --> T052[T0.5.2 MSW Mock]
        T051 --> T053[T0.5.3 RED 테스트]
    end

    subgraph "Phase 1 인증"
        T052 --> T11[T1.1 Auth API]
        T052 --> T12[T1.2 로그인 화면]
        T052 --> T13[T1.3 온보딩]
    end

    subgraph "Phase 2 진도"
        T053 --> T21[T2.1 반/학생 API]
        T21 --> T22[T2.2 진도 API]
        T052 --> T23[T2.3 관리 화면]
    end

    subgraph "Phase 3 문제은행"
        T053 --> T31[T3.1 문제 API]
        T053 --> T32[T3.2 AI 래퍼]
        T052 --> T33[T3.3 문제은행 화면]
    end

    subgraph "Phase 4 출제 엔진 ★"
        T053 --> T41[T4.1 출제 엔진 순수함수]
        T41 --> T42[T4.2 출제 API]
        T22 -.실연동.-> T42
        T31 -.실연동.-> T42
        T052 --> T43[T4.3 검수 화면]
    end

    subgraph "Phase 5 인쇄"
        T51[T5.1 지면 디자인 확정 ★게이트] --> T52[T5.2 인쇄 미리보기]
        T42 --> T53[T5.3 지표 기록]
        T43 -.-> T52
    end

    subgraph "Phase 6 통합"
        T11 & T42 & T52 & T53 --> T61[T6.1 E2E]
        T61 --> T62[T6.2 배포]
    end
```

---

## 병렬 실행 가능 태스크

| 시점 | 병렬 그룹 | 비고 |
|------|----------|------|
| M0 완료 후 | T0.5.1 → (T0.5.2 ∥ T0.5.3) | 계약 확정 후 Mock/RED 동시 작성 |
| M0.5 완료 후 | **T1.1 ∥ T2.1 ∥ T3.1 ∥ T3.2 ∥ T4.1** | API/엔진 5개 — 계약 기반 완전 독립, 각자 worktree |
| 동시에 | **T1.2 ∥ T2.3 ∥ T3.3 ∥ T4.3** | 화면 4개 — MSW로 API 없이 개발. 단, **각 화면 디자인 게이트 통과 필수** |
| T5.1은 언제든 | **T5.1 (지면 협의)** | 코딩과 무관 — M0 직후부터 진행 권장 (최우선 디자인) |
| M4 완료 후 | T4.2 실연동 ∥ T5.3 | |
| 전체 병합 후 | T6.1 → T6.2 | 순차 필수 |

**권장 실행 순서 (1인 + AI 협업 기준)**:
1. M0 → M0.5 순차 (기반)
2. **T5.1 지면 디자인 협의를 병행 시작** (원장님 시간 확보)
3. T4.1(엔진) 최우선 — 프로젝트의 심장, 순수 함수라 즉시 착수 가능
4. 이후 API 그룹 → 화면 그룹 → 인쇄 → 통합

---

## 완료 정의 (전체 DoD)

- [ ] 모든 태스크 인수 조건 통과
- [ ] `npm run test -- --coverage` ≥ 80% (출제 엔진 필수)
- [ ] `npm run lint` / `npm run type-check` 클린
- [ ] E2E 3개 여정 통과
- [ ] 실물 인쇄 검수 통과
- [ ] 프로덕션 배포 + 2주 실사용 실험 개시 (노스스타: 주 5일 사용 측정)
