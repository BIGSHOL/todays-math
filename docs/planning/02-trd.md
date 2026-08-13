# TRD (기술 요구사항 정의서) — 오늘의수학

> 개발자/AI 코딩 파트너가 참조하는 기술 문서입니다.
> 기술 표현을 사용하되, "왜 이 선택인지"를 함께 설명합니다.

---

## MVP 캡슐

| # | 항목 | 내용 |
|---|------|------|
| 1 | 목표 | 진도만 입력하면 수학 일일/확인테스트가 5분 안에 완성되어, 매일 30분~1시간을 되찾는다 |
| 2 | 페르소나 | 반별·학생별 진도가 다른 동네 수학학원 원장/강사 |
| 3 | 핵심 기능 | FEAT-1: 진도 기반 자동 출제 |
| 4 | 성공 지표 (노스스타) | 주 5일 이상 실제 사용 |
| 5 | 입력 지표 | ① 진도 입력→인쇄까지 5분 이내 ② 무수정 사용률 80% |
| 6 | 비기능 요구 | 수식이 깨지지 않는 A4 인쇄 품질 |
| 7 | Out-of-scope | 학생용 앱, 자동 채점, 모바일 앱, 결제 |
| 8 | Top 리스크 | AI 생성 문제 품질로 인한 검수 부담 |
| 9 | 완화/실험 | 검수 화면 1클릭 교체 + 무수정 사용률 측정 |
| 10 | 다음 단계 | /tasks-generator로 TASKS.md 생성 → Phase 0 시작 |

---

## 1. 시스템 아키텍처

### 1.1 고수준 아키텍처

**Next.js 풀스택 단독** 구성입니다. 별도 백엔드 서버 없이 Next.js 하나가 화면과 API를 모두 담당합니다.

```
┌──────────────────────────────────────────────┐     ┌──────────────┐
│              Next.js (App Router)            │     │  PostgreSQL  │
│  ┌────────────────┐  ┌────────────────────┐  │────▶│  (Supabase   │
│  │  React 화면     │  │  Route Handlers    │  │     │   or Neon)   │
│  │  (RSC + Client)│─▶│  /app/api/*        │  │     └──────────────┘
│  └────────────────┘  └─────────┬──────────┘  │
│                                │             │     ┌──────────────┐
│   KaTeX 수식 렌더링 / 인쇄 CSS   └────────────┼────▶│  Claude API  │
└──────────────────────────────────────────────┘     │ (문제 생성/변형)│
                                                     └──────────────┘
```

### 1.2 컴포넌트 설명

| 컴포넌트 | 역할 | 왜 이 선택? |
|----------|------|-------------|
| Next.js (App Router) | 화면 + API 서버 통합 | 프로젝트 1개·언어 1개·배포 1번 — 1인 개발 관리 포인트 최소화 (D-12) |
| PostgreSQL (Supabase/Neon) | 문제·진도·출제이력 저장 | 관계가 많은 데이터에 표준적, 무료 시작, 판매 확장 대응 (D-14) |
| Claude API | 문제 생성·변형 | 수학 문제 생성/숫자 변형에 LLM 활용 (D-04) |
| KaTeX | 수식 렌더링 | 서버 렌더링 가능, 빠르고 가벼움, 인쇄 품질 안정적 |
| 브라우저 인쇄 (@media print CSS) | 시험지 출력 | MVP는 브라우저 인쇄로 시작 — 별도 PDF 엔진 없이 가장 단순. 품질 미달 시 교체 (리스크 #2) |

---

## 2. 권장 기술 스택

### 2.1 프레임워크 & 화면

| 항목 | 선택 | 이유 | 벤더 락인 리스크 |
|------|------|------|-----------------|
| 프레임워크 | Next.js 15+ (App Router) | 풀스택 단독 구성, Vercel 배포 간단 | 낮음 |
| 언어 | TypeScript | 타입 안전 — AI 코딩 파트너와 협업 시 오류 조기 발견 | - |
| 스타일링 | Tailwind CSS v4 (컴포넌트 라이브러리 없음) | 기성 UI 킷 배제 — AI 공장식 스타일 회피, 디자인 자유도 확보 (D-07) | 낮음 |
| 수식 렌더링 | KaTeX | 문제 본문의 LaTeX 수식 표시·인쇄 | 낮음 |
| 상태관리 | React 내장 (useState/Context) → 필요 시 Zustand | MVP 규모에서는 내장으로 충분 | 낮음 |
| 데이터 페칭 | 서버 컴포넌트 + fetch / Server Actions | Next.js 표준 방식, 별도 라이브러리 불필요 | 낮음 |

### 2.2 서버 (Next.js 내장)

| 항목 | 선택 | 이유 | 벤더 락인 리스크 |
|------|------|------|-----------------|
| API | Route Handlers (`app/api/*`) | Next.js 내장 — 별도 서버 불필요 | 낮음 |
| ORM | Prisma | 초보자 친화적 스키마 정의, 마이그레이션 자동화, TypeScript 타입 자동 생성 | 낮음 |
| 검증 | Zod | 요청/응답 스키마 검증 + TypeScript 타입 공유 (계약의 SSOT) | 낮음 |
| 인증 | Auth.js (NextAuth v5) | 이메일/구글 로그인 (D-13), Next.js 표준 | 낮음 |
| AI 연동 | Anthropic SDK (`@anthropic-ai/sdk`) | 문제 생성·변형 프롬프트 호출 | 중간 (프롬프트는 추상화 계층 뒤에 격리) |

### 2.3 데이터베이스

| 항목 | 선택 | 이유 |
|------|------|------|
| 메인 DB | PostgreSQL (Supabase 또는 Neon 관리형) | 클라우드 저장(D-06), 관계형 데이터에 적합, 무료 플랜 |
| 캐시 | 없음 (MVP) | 사용자 2~3명 규모에서 불필요 |

### 2.4 인프라

| 항목 | 선택 | 이유 |
|------|------|------|
| 호스팅 | Vercel | Next.js 제작사 — 배포가 git push 한 번, 무료 플랜 |
| DB 호스팅 | Supabase 또는 Neon 무료 플랜 | 관리형 PostgreSQL, 백업 자동 |
| 로컬 개발 | `npm run dev` + 클라우드 DB 직결 (또는 로컬 Docker PostgreSQL) | 1인 개발 최소 구성 |

---

## 3. 비기능 요구사항

### 3.1 성능

| 항목 | 요구사항 | 측정 방법 |
|------|----------|----------|
| 자동 출제 생성 | 문제은행 기반 < 3s, AI 생성 포함 < 30s (진행 표시 필수) | 서버 로그 |
| 페이지 로딩 | < 2s (학원 PC 기준) | Lighthouse |
| 인쇄 렌더링 | 수식 포함 A4 2페이지 미리보기 < 3s | 실측 |

### 3.2 인쇄 품질 (이 프로젝트의 1순위 비기능 요구)

| 항목 | 요구사항 |
|------|----------|
| 수식 | KaTeX 렌더링 — 인쇄 시 깨짐·잘림 없음 |
| 레이아웃 | A4 세로, 문제 잘림 방지(page-break 제어), 학원명/날짜/이름 칸 포함 |
| 답안지 | 문제지와 분리 출력 (정답 + 풀이) |
| 검증 | 실제 프린터 출력물 검수를 인쇄 기능의 완료 조건(DoD)에 포함 |

### 3.3 보안

| 항목 | 요구사항 |
|------|----------|
| 인증 | Auth.js 세션 (JWT 전략) |
| 비밀번호 | 이메일 가입 시 bcrypt 해싱 (구글 로그인은 비밀번호 없음) |
| HTTPS | 필수 (Vercel 기본 제공) |
| 입력 검증 | 모든 Route Handler에서 Zod 서버 측 검증 |
| API 키 | Claude API 키는 서버 환경변수로만 — 클라이언트 노출 금지 |
| 학생 개인정보 | 이름만 수집 (최소 수집 원칙 — 연락처·학교 등 수집 안 함) |

### 3.4 확장성

| 항목 | 현재 (MVP) | 목표 (판매 시) |
|------|------|------|
| 동시 사용자 | 2~3명 (원장 + 동료 강사) | ~100명 학원 단위 |
| 데이터 격리 | user_id 기반 소유권 (모든 테이블) | 학원(테넌트) 단위 격리로 승격 가능한 구조 |
| 문제은행 | 수백~수천 문항 | 수만 문항 (인덱스 전략 유지) |

---

## 4. 외부 API 연동

### 4.1 인증

| 서비스 | 용도 | 필수/선택 | 연동 방식 |
|--------|------|----------|----------|
| Google OAuth | 소셜 로그인 | 선택 (이메일 가입과 병행) | Auth.js Google Provider |

### 4.2 기타 서비스

| 서비스 | 용도 | 필수/선택 | 비고 |
|--------|------|----------|------|
| Claude API (Anthropic) | 문제 생성·숫자/조건 변형·난이도 태깅 보조 | 필수 | 프롬프트는 `lib/ai/prompts/`에 버전 관리, 생성물은 반드시 검수 대상 |

---

## 5. 접근제어·권한 모델

### 5.1 역할 정의

| 역할 | 설명 | 권한 |
|------|------|------|
| Guest | 비로그인 | 로그인 페이지만 접근 |
| Teacher | 강사 (원장·동료) | 본인 소유 데이터 전체 CRUD |
| Admin | 원장 (운영자) | v2 — MVP에서는 Teacher와 동일 |

### 5.2 권한 매트릭스

| 리소스 | Guest | Teacher | 비고 |
|--------|-------|---------|------|
| 반/학생 관리 | - | O (본인 소유) | user_id로 격리 |
| 진도 입력/조회 | - | O (본인 반) | |
| 자동 출제/검수 | - | O | |
| 시험지 인쇄 | - | O | |
| 문제은행 등록/변형 | - | O | 문제 공유는 v2에서 결정 |

---

## 6. 데이터 생명주기

### 6.1 원칙

- **최소 수집**: 학생은 이름(+반 소속)만. 연락처·주소·학교 수집 안 함
- **명시적 동의**: 계정 가입 시 서비스 이용 동의
- **보존 기한**: 목적 달성 후 삭제

### 6.2 데이터 흐름

| 데이터 유형 | 보존 기간 | 삭제/익명화 |
|------------|----------|------------|
| 계정 정보 | 탈퇴 후 30일 | 완전 삭제 |
| 학생 이름/진도 | 학생 삭제 시 즉시 | 완전 삭제 (cascade) |
| 문제은행 | 영구 (사용자 자산) | 계정 삭제 시 함께 삭제 |
| 출제 이력 | 2년 | 완전 삭제 |
| 사용 로그 (노스스타 측정용) | 1년 | 익명화 |

---

## 7. 테스트 전략 (Contract-First TDD)

### 7.1 개발 방식: Contract-First Development

풀스택 단독 구성이므로 "BE/FE 분리 계약" 대신 **Zod 스키마가 계약의 SSOT**입니다.
화면과 API가 같은 스키마를 공유하므로 타입 불일치가 원천 차단됩니다.

```
┌─────────────────────────────────────────────────────────────┐
│              Contract-First 흐름 (Next.js 단독)              │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  1. 계약 정의 (Phase 0)                                     │
│     └─ Zod 스키마: src/contracts/*.ts                       │
│        (요청/응답 형태 + TypeScript 타입 자동 도출)           │
│                                                             │
│  2. 테스트 선행 작성 (🔴 RED)                               │
│     ├─ API 테스트: src/__tests__/api/*.test.ts              │
│     ├─ 출제 로직 단위 테스트: src/__tests__/unit/*.test.ts   │
│     └─ 모든 테스트가 실패하는 상태 (정상!)                   │
│                                                             │
│  3. Mock 생성 (화면 독립 개발용)                             │
│     └─ MSW 핸들러: src/mocks/handlers/*.ts                  │
│                                                             │
│  4. 구현 (🔴→🟢)                                            │
│     ├─ API: Route Handler 구현, 테스트 통과 목표             │
│     └─ 화면: Mock API로 개발 → 실제 API 연결                │
│                                                             │
│  5. 통합 검증                                               │
│     └─ Mock 제거 → Playwright E2E (핵심 여정)               │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

### 7.2 테스트 피라미드

| 레벨 | 도구 | 커버리지 목표 | 위치 |
|------|------|-------------|------|
| Unit (출제 로직·균형 알고리즘) | Vitest | ≥ 80% | `src/__tests__/unit/` |
| API (Route Handlers) | Vitest + testing 헬퍼 | Critical paths | `src/__tests__/api/` |
| Component | Vitest + React Testing Library | 핵심 화면 | `src/__tests__/components/` |
| E2E | Playwright | 핵심 여정 (진도 입력→출제→인쇄 미리보기) | `e2e/` |

### 7.3 테스트 도구

| 도구 | 용도 |
|------|------|
| Vitest | 테스트 실행 (단위/API/컴포넌트) |
| React Testing Library | 컴포넌트 테스트 |
| MSW (Mock Service Worker) | API 모킹 — Claude API 모킹 포함 (AI 호출 없이 테스트) |
| Playwright | E2E 테스트 |
| Prisma test 환경 | 테스트 전용 DB 스키마 |

**AI 관련 테스트 원칙:**
- Claude API 호출은 테스트에서 항상 모킹 (비용·비결정성 차단)
- 출제 균형 알고리즘(난이도 배분·중복 제외)은 AI와 무관한 순수 함수로 분리하여 단위 테스트

### 7.4 계약 파일 구조

```
todays-math/                      # 프로젝트 루트 (Next.js 단독)
├── src/
│   ├── app/                      # 페이지 + API
│   │   ├── (auth)/               # 로그인/가입
│   │   ├── (main)/               # 메인 화면들
│   │   └── api/                  # Route Handlers
│   ├── contracts/                # ★ Zod 스키마 = API 계약 (SSOT)
│   │   ├── auth.contract.ts
│   │   ├── class.contract.ts     # 반/학생/진도
│   │   ├── problem.contract.ts   # 문제은행
│   │   └── test.contract.ts      # 출제/시험지
│   ├── lib/
│   │   ├── db.ts                 # Prisma 클라이언트
│   │   ├── generator/            # ★ 출제 엔진 (순수 로직)
│   │   └── ai/                   # Claude API 래퍼 + 프롬프트
│   ├── components/               # 직접 제작 컴포넌트
│   ├── mocks/                    # MSW 핸들러
│   └── __tests__/
├── e2e/                          # Playwright
├── prisma/
│   └── schema.prisma
└── docs/planning/                # 이 문서들
```

### 7.5 TDD 사이클

```
🔴 RED    → 실패하는 테스트 먼저 작성 (Phase 0에서 완료)
🟢 GREEN  → 테스트를 통과하는 최소한의 코드 구현
🔵 REFACTOR → 테스트 통과 유지하며 코드 개선
```

### 7.6 품질 게이트

**병합 전 필수 통과:**
- [ ] 모든 단위 테스트 통과
- [ ] 커버리지 ≥ 80% (출제 엔진은 필수)
- [ ] 린트 통과 (ESLint)
- [ ] 타입 체크 통과 (tsc)
- [ ] E2E 테스트 통과 (해당 기능)
- [ ] 인쇄 기능 변경 시: 실물 인쇄 검수

**검증 명령어:**
```bash
npm run test -- --coverage
npm run lint
npm run type-check
npx playwright test
```

---

## 8. API 설계 원칙

### 8.1 RESTful 규칙 (Route Handlers)

| 메서드 | 용도 | 예시 |
|--------|------|------|
| GET | 조회 | GET /api/classes/{id} |
| POST | 생성 | POST /api/tests/generate (자동 출제 실행) |
| PATCH | 부분 수정 | PATCH /api/progress/{id} (진도 갱신) |
| PUT | 교체 | PUT /api/tests/{id}/problems/{seq} (문제 교체) |
| DELETE | 삭제 | DELETE /api/students/{id} |

### 8.2 응답 형식

**성공 응답:**
```json
{
  "data": { ... },
  "meta": { "page": 1, "total": 100 }
}
```

**에러 응답:**
```json
{
  "error": {
    "code": "INSUFFICIENT_PROBLEMS",
    "message": "이 단원의 문제가 부족합니다. AI 생성을 실행하거나 문제를 등록해주세요.",
    "details": [ { "field": "unitId", "message": "가용 문제 3개 / 필요 8개" } ]
  }
}
```

### 8.3 API 버저닝

MVP는 단일 사용자군이므로 버저닝 없이 `/api/*`로 시작. 판매 확장 시 `/api/v1/*` 도입.

---

## 9. 병렬 개발 지원 (Git Worktree)

### 9.1 개요

풀스택 단독이지만, 독립적인 기능(예: 문제은행 vs 진도 관리)을 병렬 개발할 때 Git Worktree를 사용합니다.

### 9.2 Worktree 구조

```
C:\Creative\
├── testautocreator/              # 메인 (main 브랜치)
├── testautocreator-generator/    # Worktree: feature/feat-1-generator
├── testautocreator-print/        # Worktree: feature/feat-3-print
└── testautocreator-progress/     # Worktree: feature/feat-4-progress
```

### 9.3 명령어

```bash
# Worktree 생성
git worktree add ../testautocreator-generator -b feature/feat-1-generator

# 독립 작업 후 테스트
cd ../testautocreator-generator && npm run test

# 테스트 통과 후 병합
git checkout main
git merge --no-ff feature/feat-1-generator

# Worktree 정리
git worktree remove ../testautocreator-generator
```

### 9.4 병합 규칙

| 조건 | 병합 가능 |
|------|----------|
| 단위 테스트 통과 (🟢) | 필수 |
| 커버리지 ≥ 80% | 필수 |
| 린트/타입 체크 통과 | 필수 |
| E2E 테스트 통과 | 권장 |

---

## Decision Log 참조 (기술 관련)

| ID | 항목 | 선택 | 근거 |
|----|------|------|------|
| D-12 | 프레임워크 | Next.js 풀스택 단독 | 프로젝트 1개·언어 1개·배포 1번 — 1인 개발 최적 |
| D-13 | 인증 | Auth.js — 이메일/구글 | 간단한 로그인만 (Q12) |
| D-14 | DB | PostgreSQL (Supabase/Neon) | 관계 많은 데이터 + 클라우드 + 무료 시작 |
| D-15 | 스타일링 | Tailwind CSS, 컴포넌트 직접 제작 | AI 공장식 스타일 배제 (D-07 연계) |
| D-16 | 수식/인쇄 | KaTeX + 브라우저 인쇄 CSS | MVP 최단 경로, 품질 미달 시 PDF 엔진 교체 |
| D-17 | ORM/검증 | Prisma + Zod | 타입 자동 생성 + 계약 SSOT |
| D-18 | AI | Claude API | 문제 생성·변형·태깅 보조 |
