# 오늘의수학 (testautocreator)

수학학원 원장이 진도만 입력하면 일일/확인테스트가 자동 출제되는 서비스.
매일 30분~1시간의 출제 수작업 제거가 목표.

## 기획 문서 (SSOT — 작업 전 반드시 참조)

| 문서 | 내용 |
|------|------|
| `docs/planning/01-prd.md` | 요구사항, 페르소나, FEAT ID, 리스크 |
| `docs/planning/02-trd.md` | 아키텍처, 스택, Contract-First TDD 전략 |
| `docs/planning/03-user-flow.md` | 화면 흐름 (S-01~S-08) |
| `docs/planning/04-database-design.md` | ERD 9개 엔티티 |
| `docs/planning/05-design-system.md` | 디자인 — **`[협의 필요]` 항목은 미확정!** |
| `docs/planning/06-tasks.md` | 태스크 목록 (M0~M6, 21개) — `/orchestrate`가 사용 |
| `docs/planning/07-coding-convention.md` | 컨벤션, 도메인 용어 SSOT, Decision Log D-01~24 |

## 기술 스택

Next.js 15+ 풀스택 단독 (App Router, TypeScript) · Tailwind CSS v4 (기성 컴포넌트 킷 금지)
· Prisma + PostgreSQL (Supabase/Neon, 로컬은 docker-compose) · Zod (src/contracts/ = 계약 SSOT)
· Auth.js (이메일/구글) · Claude API (문제 생성/변형 — 테스트에서 항상 모킹) · KaTeX · Vitest/RTL/MSW/Playwright

## 절대 규칙

1. **디자인 게이트 (D-23)**: UI 구현 전 05-design-system.md에서 해당 화면 `[확정]` 확인.
   `[협의 필요]`면 시안 제시 → 원장님 확정 후 구현. **AI 공장식 스타일 금지** (05 §0 금지 목록).
2. **TDD**: Phase 1+ 태스크는 RED→GREEN→REFACTOR. 테스트 없이 구현 금지.
3. **Worktree**: Phase 1+는 `git worktree add ../testautocreator-phase{N}-{feature} -b phase/{N}-{feature}`.
4. **병합은 사용자 승인 후에만.**
5. **UI 문구는 간결·사무적** (D-08): "출제 완료", "인쇄하기" — 느낌표·이모지 없음.
6. **인쇄 관련 변경은 실물 프린터 출력 검수까지가 완료 조건.**
7. Claude API 키는 서버 환경변수로만. 테스트에서 실호출 금지.

## 명령어

```bash
npm run dev          # 개발 서버
npm run test         # Vitest
npm run lint         # ESLint
npm run type-check   # tsc --noEmit
npx playwright test  # E2E
docker compose up -d # 로컬 PostgreSQL
```

## 워크플로우

- `/orchestrate {태스크 ID 또는 요청}` — 06-tasks.md 기반으로 전문가 에이전트 호출
- `/integration-validator` — 병렬 작업 후 계약/타입 일관성 검증
- 에이전트 팀: backend / frontend / database / test specialist (.claude/agents/)

## Lessons Learned

(어려운 문제 해결 시 여기에 기록 — 형식은 .claude/agents/database-specialist.md 참조)

### [2026-08-13] Prisma 7 설치 시 스키마 검증 실패 (prisma, datasource, 버전 고정)
- **상황**: T0.2에서 `npm view prisma version`으로 최신 버전(7.9.1)을 설치하고
  `prisma/schema.prisma`에 04-database-design.md 스펙대로 `url = env("DATABASE_URL")` +
  `directUrl = env("DIRECT_URL")`를 작성함.
- **문제**: `npx prisma validate` 실행 시 `Error code: P1012 — The datasource property 'url' is
  no longer supported in schema files`로 검증 실패. 또한 `prisma init`이 `.claude/skills/`,
  `.windsurf/`, `.agents/` 하위에 심볼릭 링크로 "에이전트 스킬" 문서를 무단 설치함(금지된
  `.claude/` 디렉토리 변경).
- **원인**: Prisma 7부터 datasource의 `url`/`directUrl`을 schema.prisma에 직접 쓰는 방식이
  완전히 제거됨. 대신 `prisma.config.ts`(CLI/마이그레이션용)와 `PrismaClient` 생성자에 전달하는
  드라이버 어댑터(`@prisma/adapter-pg` 등)로 연결 정보를 이원화해야 하는 구조로 변경됨.
  이 구조는 `@auth/prisma-adapter` 등 생태계 패키지의 호환성이 아직 불확실하고, 프로젝트의
  "관리 포인트 최소화"(D-12) 원칙과 배치되며, TRD/TASKS 문서가 가정하는 표준 `@prisma/client`
  싱글턴 패턴과도 맞지 않음.
- **해결**: `prisma`/`@prisma/client`를 최신 안정 6.x(6.19.3)로 고정 설치. `generator client`의
  provider를 `prisma-client-js`로 되돌리고, `prisma.config.ts`는 삭제. datasource에
  `url = env("DATABASE_URL")` + `directUrl = env("DIRECT_URL")`를 그대로 사용해 문서 스펙을
  충족. `prisma init`이 만든 `.claude/skills/`, `.windsurf/`, `.agents/`, `skills-lock.json`은
  즉시 삭제해 원상 복구.
- **교훈**: Prisma처럼 메이저 버전이 빠르게 올라가는 도구는 `npm view <pkg> version`으로 무조건
  최신을 설치하지 말고, 프로젝트 문서(TRD/DB 설계)가 가정하는 패턴(예: schema 내 url/directUrl)이
  해당 메이저 버전에서 여전히 지원되는지 `prisma validate`로 먼저 확인한 뒤 필요 시 최신 안정
  **이전 메이저**로 의도적으로 고정할 것. 또한 `prisma init`류 스캐폴딩 명령은 `.claude/` 등
  금지 디렉토리에 부수 파일을 설치할 수 있으므로 실행 직후 `git status`로 diff를 반드시 검사.
