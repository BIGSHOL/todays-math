# Coding Convention & AI Collaboration Guide — 오늘의수학

> 고품질/유지보수/보안을 위한 인간-AI 협업 운영 지침서입니다.

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

## 1. 핵심 원칙

### 1.1 신뢰하되, 검증하라 (Don't Trust, Verify)

AI가 생성한 코드는 반드시 검증해야 합니다:

- [ ] 코드 리뷰: 생성된 코드 직접 확인
- [ ] 테스트 실행: 자동화 테스트 통과 확인
- [ ] 보안 검토: 민감 정보 노출 여부 확인
- [ ] 동작 확인: 실제로 실행하여 기대 동작 확인
- [ ] **인쇄 확인: 인쇄 관련 변경은 실물 출력까지 검증** (이 프로젝트 특수 규칙)

### 1.2 최종 책임은 인간에게

- AI는 도구이고, 최종 결정과 책임은 원장님에게 있습니다
- 이해하지 못하는 코드는 사용하지 않습니다
- 의심스러운 부분은 반드시 질문합니다
- **AI가 생성한 수학 문제도 코드와 같습니다 — 검수 없이 학생에게 내지 않습니다**

### 1.3 디자인 협업 규칙 (D-23)

- UI 구현 전, 해당 화면의 디자인이 `05-design-system.md`에서 `[확정]`인지 확인
- `[협의 필요]` 상태의 화면은 시안/선택지를 먼저 제시하고 원장님 확정을 받은 후 구현
- AI 공장식 스타일 금지 목록(05 문서 섹션 0)을 모든 UI 작업에서 준수

---

## 2. 프로젝트 구조

### 2.1 디렉토리 구조 (Next.js 풀스택 단독)

```
todays-math/
├── src/
│   ├── app/                      # App Router: 페이지 + API
│   │   ├── (auth)/               # 로그인/가입 라우트 그룹
│   │   ├── (main)/               # 메인 화면 라우트 그룹
│   │   │   ├── page.tsx          # S-03 메인 (오늘의 테스트)
│   │   │   ├── tests/            # S-04 출제 설정, S-05 검수, S-06 인쇄
│   │   │   ├── classes/          # S-07 반/학생 관리
│   │   │   └── problems/         # S-08 문제은행
│   │   └── api/                  # Route Handlers
│   ├── contracts/                # Zod 스키마 = API 계약 (SSOT)
│   ├── lib/
│   │   ├── db.ts                 # Prisma 클라이언트 싱글턴
│   │   ├── generator/            # 출제 엔진 (순수 함수 — 테스트 최우선 대상)
│   │   ├── ai/                   # Claude API 래퍼
│   │   │   └── prompts/          # 문제 생성/변형 프롬프트 (버전 관리)
│   │   └── utils/                # 유틸리티
│   ├── components/               # 직접 제작 컴포넌트 (기성 킷 금지)
│   ├── mocks/                    # MSW 핸들러 (Claude API 모킹 포함)
│   └── __tests__/                # 단위/API/컴포넌트 테스트
├── e2e/                          # Playwright
├── prisma/
│   ├── schema.prisma
│   └── seed.ts                   # UNIT(교육과정 단원) 시드
└── docs/planning/                # 기획 문서 (소크라테스 산출물)
```

### 2.2 네이밍 규칙

| 대상 | 규칙 | 예시 |
|------|------|------|
| 파일 (컴포넌트) | PascalCase | `ProblemCard.tsx` |
| 파일 (유틸/훅) | camelCase | `formatDate.ts`, `useProgress.ts` |
| 컴포넌트 | PascalCase | `TestPreview` |
| 함수/변수 | camelCase | `generateTest` |
| 상수 | UPPER_SNAKE | `DUPLICATE_EXCLUSION_DAYS` |
| DB 테이블/컬럼 (Prisma) | 모델 PascalCase / 컬럼 camelCase → DB는 snake_case 매핑 | `TestProblem` / `orderIndex` |
| API 경로 | kebab-case 복수형 | `/api/test-problems` |

### 2.3 도메인 용어 통일 (SSOT)

코드·문서·UI에서 같은 대상은 같은 이름으로:

| 개념 | 코드 (영문) | UI (한글) | 금지 표기 |
|------|------------|----------|----------|
| 일일테스트 | `daily` | 일일테스트 | 데일리, 오늘테스트 |
| 확인테스트 | `review` | 확인테스트 | 복습테스트 |
| 진도 | `progress` | 진도 | 커리큘럼 |
| 소단원 | `unit` (section 레벨) | 소단원 | 챕터 |
| 문제은행 | `problem` | 문제은행 | 문항DB |
| 출제 | `generate` | 출제 | 생성(문제 생성과 구분) |

---

## 3. 아키텍처 원칙

### 3.1 뼈대 먼저 (Skeleton First)

1. 전체 구조를 먼저 잡고
2. 빈 함수/컴포넌트로 스켈레톤 생성
3. 하나씩 구현 채워나가기

### 3.2 작은 모듈로 분해

- 한 파일에 200줄 이하 권장
- 한 함수에 50줄 이하 권장
- 한 컴포넌트에 100줄 이하 권장

### 3.3 관심사 분리

| 레이어 | 역할 | 위치 |
|--------|------|------|
| UI | 화면 표시 | `components/`, `app/**/page.tsx` |
| API | 요청 처리 + Zod 검증 | `app/api/` |
| 도메인 로직 | **출제 엔진 (난이도 배분·중복 제외·범위 계산)** | `lib/generator/` — 순수 함수로 유지 |
| AI | Claude 호출 + 프롬프트 | `lib/ai/` — 도메인 로직과 격리 |
| 데이터 | Prisma 쿼리 | `lib/db.ts` + 각 API 내 |

**핵심 규칙**: 출제 엔진(`lib/generator/`)은 DB·AI에 직접 의존하지 않는 순수 함수로 작성.
→ 테스트가 쉽고, AI 없이도 로직 검증 가능.

---

## 4. AI 소통 원칙

### 4.1 하나의 채팅 = 하나의 작업

- 한 번에 하나의 명확한 작업만 요청
- 작업 완료 후 다음 작업 진행
- 컨텍스트가 길어지면 새 대화 시작

### 4.2 컨텍스트 명시

**좋은 예:**
> "TASKS 문서의 T2.1을 구현해주세요.
> Database Design의 PROBLEM 엔티티를 참조하고,
> TRD의 기술 스택(Prisma + Zod)을 따라주세요."

**나쁜 예:**
> "출제 기능 만들어줘"

### 4.3 기존 코드 재사용

- 새로 만들기 전에 기존 코드 확인 요청
- 중복 코드 방지
- 일관성 유지

### 4.4 프롬프트 템플릿

```
## 작업
{{무엇을 해야 하는지}}

## 참조 문서
- {{문서명}} 섹션 {{번호}}

## 제약 조건
- {{지켜야 할 것}}

## 예상 결과
- {{생성될 파일}}
- {{기대 동작}}
```

---

## 5. 보안 체크리스트

### 5.1 절대 금지

- [ ] 비밀정보 하드코딩 금지 (Claude API 키, DB 접속 정보, Auth 시크릿)
- [ ] .env 파일 커밋 금지
- [ ] SQL 직접 문자열 조합 금지 (Prisma 사용으로 원천 차단)
- [ ] 사용자 입력 그대로 출력 금지 (XSS — 특히 문제 본문 렌더링 시 주의)
- [ ] **Claude API 키를 클라이언트 코드에 노출 금지** — AI 호출은 반드시 서버(Route Handler)에서

### 5.2 필수 적용

- [ ] 모든 사용자 입력 서버 측 Zod 검증
- [ ] 이메일 가입 비밀번호 bcrypt 해싱
- [ ] HTTPS (Vercel 기본)
- [ ] 모든 API에서 세션 확인 + `user_id` 소유권 검증 (다른 강사 데이터 접근 차단)
- [ ] 학생 개인정보 최소 수집 (이름만) 유지

### 5.3 환경 변수 관리

```bash
# .env.example (커밋 O)
DATABASE_URL=postgresql://user:password@localhost:5432/todaysmath
AUTH_SECRET=your-secret-here
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
ANTHROPIC_API_KEY=your-api-key-here

# .env (커밋 X)
```

---

## 6. 테스트 워크플로우

### 6.1 즉시 실행 검증

코드 작성 후 바로 테스트:

```bash
npm run test           # Vitest 단위/API/컴포넌트
npm run test -- --coverage
npm run lint           # ESLint
npm run type-check     # tsc --noEmit
npx playwright test    # E2E
```

### 6.2 이 프로젝트의 특수 검증

| 대상 | 검증 방법 |
|------|----------|
| 출제 엔진 | 단위 테스트 (난이도 배분·중복 제외·범위 계산) — 커버리지 80% 필수 |
| Claude API 연동 | MSW 모킹 테스트 + 수동 스모크 테스트 (실제 호출은 비용 발생) |
| 인쇄 레이아웃 | E2E 미리보기 스크린샷 + **실물 프린터 출력 검수** |
| 수식 렌더링 | 대표 수식 케이스(분수·루트·지수·도형 기호) 렌더링 테스트 |

### 6.3 오류 로그 공유 규칙

오류 발생 시 AI에게 전달할 정보:

1. 전체 에러 메시지
2. 관련 코드 스니펫
3. 재현 단계
4. 이미 시도한 해결책

---

## 7. Git 워크플로우

### 7.1 브랜치 전략

```
main          # 프로덕션 (Vercel 자동 배포)
├── develop   # 개발 통합
│   ├── feature/feat-1-generator    # 출제 엔진
│   ├── feature/feat-3-print        # 인쇄
│   ├── feature/feat-4-progress     # 진도 관리
│   ├── feature/feat-5-problems     # 문제은행
│   ├── feature/feat-0-auth         # 인증
│   └── fix/{{버그설명}}
```

### 7.2 커밋 메시지

```
<type>(<scope>): <subject>

<body>
```

**타입:** `feat` / `fix` / `refactor` / `docs` / `test` / `chore`

**예시:**
```
feat(generator): 난이도 배분 알고리즘 구현

- 반별 difficulty_ratio 기반 문항 선정
- 최근 14일 출제 문제 제외 (D-20)
- TRD 섹션 7.3 단위 테스트 통과
```

---

## 8. 코드 품질 도구

### 8.1 필수 설정

| 도구 | 용도 |
|------|------|
| ESLint | 린트 (next/core-web-vitals 프리셋) |
| Prettier | 포매터 |
| TypeScript (strict) | 타입 체크 |

### 8.2 Pre-commit 훅 (husky + lint-staged)

```json
// package.json
{
  "lint-staged": {
    "*.{ts,tsx}": ["eslint --fix", "prettier --write"]
  }
}
```

---

## Decision Log 전체 (D-01 ~ D-24)

| ID | 항목 | 선택 |
|----|------|------|
| D-01 | 프로젝트명 | 오늘의수학 |
| D-02 | 페르소나 | 동네 수학학원 원장/강사 (본인) |
| D-03 | MVP 핵심 | FEAT-1: 진도 기반 자동 출제 |
| D-04 | 문제 출처 | AI 생성 + 직접 등록(자작·기출) + 시중 문제집 변형 |
| D-05 | 사용 환경 | PC 웹 (프린터 연결 데스크탑) |
| D-06 | 데이터 저장 | 클라우드 |
| D-07 | 디자인 방향 | 토스 느낌 + AI 공장식 배제 + 사용자 주도 협업 |
| D-08 | 톤 | 간결하고 사무적 |
| D-09 | 노스스타 | 주 5일 이상 실사용 |
| D-10 | 수익화 | 일단 우리 학원용, 판매는 열어둠 |
| D-11 | 검증 | 본인 + 동료 강사 1~2명 실사용 |
| D-12 | 프레임워크 | Next.js 풀스택 단독 |
| D-13 | 인증 | Auth.js — 이메일/구글 |
| D-14 | DB | PostgreSQL (Supabase/Neon) |
| D-15 | 스타일링 | Tailwind CSS, 컴포넌트 직접 제작 |
| D-16 | 수식/인쇄 | KaTeX + 브라우저 인쇄 CSS (품질 미달 시 교체) |
| D-17 | ORM/검증 | Prisma + Zod |
| D-18 | AI | Claude API |
| D-19 | 진도 입력 UX | 수업 직후 10초 내 완료 |
| D-20 | 중복 방지 | 최근 14일 출제 문제 자동 제외 |
| D-21 | 진도 모델 | 이력 누적 + 반/개별 이중 구조 |
| D-22 | AI 생성물 검수 | pending→approved 승격 후 출제 |
| D-23 | 디자인 프로세스 | 제안→피드백→확정 후 구현 |
| D-24 | 최우선 디자인 | 시험지 지면 (인쇄물) |
