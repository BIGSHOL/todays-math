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
| `docs/planning/07-coding-convention.md` | 컨벤션, 도메인 용어 SSOT, Decision Log D-01~36 |
| `docs/planning/09-figure-engine-guide.md` | **도형 SVG 엔진 사용 지침** — testchanger 엔진 호출법,<br>2계층 구조, 실제로 낸 오류 재발 금지 목록. 도형 작업 전 필독 |
| `docs/planning/10-handoff.md` | **인수인계 — 다른 컴퓨터에서 이어할 때 여기부터.**<br>환경 준비·저장소 밖 의존물·다음 할 일·확인 대기 항목 (2026-08-15) |
| `docs/planning/11-score-predictor.md` | **기출 예상 점수 판독기 설계 SSOT** — 실측 근거·엔진 계층<br>·backtest 결과·배점 보정기(§10). '오늘의 시험' 작업 전 필독 |
| `docs/planning/12-discard-candidates.md` | 폐기 후보 문항 목록 (`build-discard-list.ts` 가 생성) |
| `docs/planning/08-import-ledger.md` | **문항 이관 원장 — N드라이브 기출 위치·중복 방지·토큰 절약 원칙.**<br>이관/검수 작업 전 필독. 같은 조사를 반복하지 말 것.<br>**§5.1 추출은 `(완료)` 표기 원본에서만 (D-37)** |

> ⚠️ **새 기획 문서 번호를 붙이기 전에 반드시 `ls docs/planning/` 로 확인하고,
> 원장님께 번호를 먼저 알린다.** 오르카 다중 세션이 동시에 문서를 만들면 번호가 겹친다
> (2026-08-16 실제 발생: 11번이 둘). 겹치면 **참조가 적은 쪽**을 옮기고,
> 스크립트가 생성하는 문서는 그 스크립트의 출력 경로 상수도 같이 고친다.

## 기술 스택

Next.js 15+ 풀스택 단독 (App Router, TypeScript) · Tailwind CSS v4 (기성 컴포넌트 킷 금지)
· Prisma + PostgreSQL (Supabase/Neon, 로컬은 docker-compose) · Zod (src/contracts/ = 계약 SSOT)
· Auth.js (이메일/비밀번호 **단일** — 소셜 로그인 없음) · DeepSeek API `deepseek-v4-pro`
(문제 생성/변형 — OpenAI 호환 SDK, 테스트에서 항상 모킹) · KaTeX · Vitest/RTL/MSW/Playwright

## 절대 규칙

1. **디자인 정체성 = 프로젝트 전체 관통 개념 (D-07, 원장님 직접 관여)**: 화면·시험지 지면·
   문구 톤·인터랙션·출력물 등 **형태를 결정하는 모든 작업**은 원장님 확정 없이 구현 착수 금지.
   목표는 "AI 티 회피"가 아니라 **오늘의수학만의 특색 있는 틀** (05 §0). UI 구현 전
   05-design-system.md에서 해당 항목 `[확정]` 확인 — `[협의 필요]`면 시안 제시 → 원장님 확정
   후 구현. AI 공장식 스타일 금지 (05 §0 금지 목록). 첫 UI 전에 '디자인 정체성 세션' 선행.
   **제시 방식: Wire 4~5안 → 선택 → Hi-fi 4~5안 → 선택 (05 §0-3). 세부 디테일은 항상 질문.**
2. **TDD**: Phase 1+ 태스크는 RED→GREEN→REFACTOR. 테스트 없이 구현 금지.
3. **Worktree**: Phase 1+는 `git worktree add ../testautocreator-phase{N}-{feature} -b phase/{N}-{feature}`.
4. **병합**: 오르카 다중 세션으로 끝난 작업은 검수 후 **main 병합이 기본**(아래 9번). 강제 푸시·공유 이력 파괴만 확인.
5. **UI 문구는 간결·사무적** (D-08): "출제 완료", "인쇄하기" — 느낌표·이모지 없음.
6. **인쇄 관련 변경은 실물 프린터 출력 검수까지가 완료 조건.**
7. AI API 키(`DEEPSEEK_API_KEY`)는 서버 환경변수로만. 테스트에서 실호출 금지.
   **로그인 수단은 이메일/비밀번호 하나뿐이다 — 구글/OAuth는 원장님 지시로 완전 제거(2026-08-14).
   다시 넣지 말 것.**
8. **마우스 어포던스 (D-30, 강제)**: 손가락 커서와 hover 배경은 실제로 누르는 컨트롤에만.
   카드·표 행·장식 표면에 `cursor-pointer` / 행 `hover:bg-*` / `<div onClick>` 금지.
   `npm run lint:affordance`와 ESLint가 막는다. 검사 우회 금지.
9. **오르카 다중 세션이 기본**: 독립적으로 나눌 수 있는 작업은 오르카 다중 세션(워크트리)으로
   병행하고, 완료되면 main에 병합한다. 혼자 순서대로 하는 것은 의존이 있어 나눌 수 없을 때만.

## 명령어

```bash
npm run dev          # 개발 서버
npm run test         # Vitest
npm run lint         # ESLint (D-30 어포던스 포함)
npm run lint:affordance  # 마우스 어포던스 전수 검사 (D-30)
npm run type-check   # tsc --noEmit
npx playwright test  # E2E
docker compose up -d # 로컬 PostgreSQL
```

## 워크플로우

- **기본**: 병렬 가능한 일은 오르카 다중 세션 → 완료 검수 → main 병합
- `/orchestrate {태스크 ID 또는 요청}` — 06-tasks.md 기반으로 전문가 에이전트 호출
- `/integration-validator` — 병렬 작업 후 계약/타입 일관성 검증
- 에이전트 팀: backend / frontend / database / test specialist (.claude/agents/)

## Lessons Learned

(어려운 문제 해결 시 여기에 기록 — 형식은 .claude/agents/database-specialist.md 참조)

### [2026-08-13] T0.3 진행 중 시드 소스 교체 + 대량 데이터 이관 안전화 (seed, 데이터 이관, 소스 전환)
- **상황**: T0.3(교육과정 단원 시드) 착수 시점엔 mathlab/math-report/math_test 3개 저장소를 조합하는
  방안으로 지시받아 이미 매핑 규칙·충돌 분석까지 마쳤으나, 작업 도중 오케스트레이터가 "eywa가 더
  신뢰도 높은 손검증 정본"이라며 단일 소스(`C:\Creative\eywa\...\curriculum.ts`, 1474줄)로 즉시
  전환하라는 지시를 보냄. 게다가 전환 지시문 자체가 고등 7과목 중 "미적분Ⅱ"를 순서 나열에서
  누락하는 등 완전하지 않았음.
- **문제**: (1) 735개 차시·117개 단원 규모의 TS 객체 리터럴을 수작업으로 옮겨 적으면 오탈자·누락
  위험이 큼. (2) 지시문의 고등 과목 순서 목록(6개)과 실제 소스 파일의 과목 수(7개, 미적분Ⅱ 포함)가
  불일치 — 그대로 따르면 실데이터(미적분Ⅱ 29개 차시)가 조용히 유실됨.
- **원인**: (1) 원본이 코드 파일(.ts)이라 JSON이 아니므로 단순 복붙은 신뢰할 수 없음. (2) 사람이
  작성한 자연어 지시문은 enumerable list를 요약하는 과정에서 누락이 생기기 쉬움.
- **해결**: (1) Node `new Function("return (...)")`으로 원본 `.ts`의 객체 리터럴 텍스트만 브레이스
  매칭으로 정확히 추출해 안전하게 `eval`하고, 결과를 JSON으로 스냅샷 → 별도 스크립트로 최종
  `units.ts`를 **생성**(수작업 타이핑 없음). 생성 직후 원본 키 개수/이름을 원본과 교차 검증하는
  assert를 스크립트에 내장해 "누락된 학년/과목 키가 있으면 즉시 throw"하도록 함. (2) 지시문에서
  빠진 미적분Ⅱ는 임의로 버리지 않고, eywa 원본 정의 순서(및 동봉된 `curriculum.test.ts`의 검증
  목록)를 근거로 위치를 결정(맨 끝에 배치)한 뒤 `units.ts` 헤더 주석과 완료 보고서에 "왜 지시문과
  다른지" 근거를 명시해 원장님/오케스트레이터가 재검토할 수 있게 함.
- **교훈**: (1) 대량 코드성 데이터를 이관할 때는 절대 손으로 옮기지 말고, 원본을 프로그램적으로
  파싱→검증→생성하는 파이프라인을 스크래치 디렉토리에 만들어 재현 가능하게 할 것(리뷰도 쉬워짐).
  (2) 상위 지시문의 열거형 목록은 실제 소스 파일과 반드시 개수를 대조 검증하고, 불일치 시 데이터를
  임의로 누락시키지 말고 근거를 남기며 보수적으로(포함하는 쪽으로) 결정할 것.

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

### [2026-08-14] 출제 화면에서 AI pending 자동 승격 금지 (D-22, generate)
- **상황**: T6.1 여정 C를 GREEN 맞추려 출제 설정이 AI 생성 직후 review-status를 approved로 PATCH 했다.
- **문제**: D-22는 생성물 pending → 사람이 승격한 뒤에만 출제 풀 진입. 자동 승격은 검수 화면을 우회한다.
- **해결**: 생성은 pending만 남기고 문제은행 승격 안내. E2E는 helper로 승격 후 재출제.
- **교훈**: E2E GREEN을 위해 제품 정책을 풀지 말 것. 테스트가 승격 스텝을 밟게 할 것.

### [2026-08-14] 공용 풀(D-31) 적재 — classified 미작성 + PowerShell JSON 깨짐
- **상황**: 원장님이 "특별 지시 없으면 전부 공용 풀"로 확정. 기출/자작/RPM을 공유 Supabase에 넣어야 함.
- **문제**: (1) 로더가 `rpm-classified.json`을 읽는데 `extract-rpm.ts`는 리포트만 쓰고 classified를 안 씀 → 1차 적재가 기출+자작 4327만 들어감. (2) PowerShell `Out-File -Encoding utf8`로 자작 덤프를 저장하면 BOM/이스케이프로 JSON.parse가 실패.
- **해결**: extract가 classified를 ocr/manual과 같은 형태로 쓰게 고침. 덤프는 Python stdout을 UTF-8 파일로 직접 기록. 공유 DB INSERT는 기본 차단을 유지하고 `ALLOW_SHARED_IMPORT=1`일 때만 연다. 적재는 fingerprint로 멱등.
- **교훈**: 로더가 기대하는 산출물 파일명을 추출 스크립트가 실제로 쓰는지 교차 확인할 것. Windows에서 JSON은 PowerShell 리다이렉트 대신 원본 프로세스가 파일을 쓰게 할 것.

### [2026-08-14] T6.1 E2E는 실제 API+로컬 DB, 단원명/AI 승격은 통합에서만 드러난다 (e2e, playwright)
- **상황**: 여정 A/B/C를 Playwright로 돌리려면 가입·온보딩·출제·검수·인쇄가 실제 Route Handler와
  DB를 타야 한다. 이 worktree에는 `.env`가 없고 main `.env`는 공유 Supabase라 쓸 수 없다.
- **문제**: (1) 로컬 5432는 다른 컨테이너가 점유. (2) S-03 `unitSectionName`이 MSW mock UUID만
  알아 실제 시드 단원은 "—"로 나와 진도 갱신을 검증할 수 없음. (3) AI 생성물은 `pending`이라
  `findEligibleProblems`(approved만)에 안 잡혀 "AI 생성 → 재출제"가 다시 422. (4) Next 라우트
  안내 `role="alert"`가 부족 안내 alert와 충돌.
- **해결**: Docker Postgres를 5433/`todaysmath_e2e`로 분리하고 globalSetup에서 migrate+시드.
  메인은 `/api/units` 목록으로 소단원명을 조회. 출제 보충 AI 문항은 검수 화면 진입 전에
  review-status를 approved로 승격. Claude는 `E2E_MOCK_AI=1`. 실물 인쇄는 `window.print` 스텁.
- **교훈**: 화면 단위 테스트의 mock id 카탈로그를 메인 조회에 남기면 E2E에서만 침묵 회귀한다.
  부족→AI→재출제 경로는 생성 API와 출제 풀 자격(D-22)이 맞는지 한 번에 검증할 것.

### [2026-08-14] KaTeX 0.16 unknown command 는 .katex-error 가 아니다 (katex, 렌더 안전망)
- **상황**: Mathgen `renderKatexSafe`는 실패 판정을 `html.includes("katex-error")`만 본다.
  같은 가드를 이식한 뒤 알 수 없는 명령(`\\notacommand`)을 넣었더니 테스트가 빨강 스타일을
  잡았다.
- **문제**: KaTeX 0.16은 `throwOnError: false`일 때 unknown command를
  `<span class="katex-error">`가 아니라 `style="color:#cc0000"`인 `.mord.text`로 그린다.
  클래스 가드만 있으면 학생 화면에 붉은 raw 명령이 그대로 나간다.
- **해결**: 실패 판정에 `#cc0000`을 포함. 1차 렌더가 붉으면 2차 aggressiveRepair, 그래도
  붉으면 `.math-raw` 중립 폴백. CSS는 sumaek처럼 루트 레이아웃에서 `katex.min.css`를
  한 번만 로드.
- **교훈**: 업스트림 "3단 방어"를 이식할 때도 현재 KaTeX 메이저의 실제 실패 DOM을
  픽스처로 한 번 찍어서 가드를 맞춰라. 클래스 이름만 믿으면 침묵 회귀가 난다.

### [2026-08-14] 반 카드 손가락 커서 거짓말 (cursor, 어포던스, D-30)
- **상황**: 메인 반 카드 전체에 `cursor-pointer`와 행 `hover:bg-white`가 걸려 원장이
  카드를 눌러도 아무 일도 없었다. 실제 동작은 「출제」링크와 패널 「반 선택」뿐이었다.
- **문제**: 문서/리뷰만으로는 같은 패턴이 표·문제 카드·비활성 버튼에 다시 들어온다.
- **해결**: 전역 CSS로 활성 컨트롤만 pointer, 비활성은 not-allowed. AST 스캐너
  (`src/lint/scanAffordance.mjs`)가 article/tr cursor-pointer, 행 hover, div onClick을
  ESLint·vitest·lint-staged에서 error로 막는다 (D-30).
- **교훈**: "클릭처럼 보이는 것"은 제품 버그다. 컨벤션 문장만 쓰지 말고 커밋이
  실패하게 만들 것. eslint-disable로 이 규칙을 끄지 말 것.

### [2026-08-14] 순환소수는 막대가 아니라 숫자 위 점 (katex, 중학 표기)
- **상황**: 문제은행 순환소수가 `0.\overline{3}` 막대로 그려져 원장이
  "숫자 위에 점이 찍혀야 한다"고 함. 중2 교과서는 순환마디 첫·끝에 점.
- **해결**: 전처리가 숫자 `\\overline`/`\\dot` 를 `.repeat-dot` CSS 점으로 그린다.
  KaTeX `\\dot` 은 12.5px 목록에서 거의 안 보여 은행/검수가 달라 보였다.
  선분 `\\overline{AB}` 는 유지.
- **교훈**: 서양 LaTeX 기본(overline)을 교과 표기로 단정하지 말 것.
   렌더된 것처럼 보여도 실제 가독성을 화면에서 확인할 것.
