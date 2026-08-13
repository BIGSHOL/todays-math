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
