# eywa 연계 — 학생별 진도 → 확인테스트 자동 출제 (계획 SSOT · 2판)

2026-08-21 · 원장님 확정 + 실측 + **적대적 리뷰 3인(codex 27건 · antigravity 10건 ·
grok)** 반영. 1판과 달라진 곳은 `[개정]` 표시. **양쪽(우리·eywa) 작업이 이 문서의
계약을 본다.**

## 0. 원장님 확정 (전제)

1. **eywa 가 정본.** 진도·명단 모두. 우리 데이터는 demo — 충돌 시 eywa 로 덮는다.
2. **중·고등만 먼저.** 단, `[개정]` **관은 전 학년을 나른다** — 거르는 곳은 출제
   쪽이다(문항 수 게이트). 초등은 문항이 채워지는 대로 자동 합류(원장님 확정).
   관에서 거르면 초등 합류 때 관을 또 고쳐야 한다.
3. **eywa 수정 허용 + 전용 API 키.** 발급 완료: `TODAYS_MATH_API_KEY`
   (`tm_` 접두사, 양쪽 `.env` 에만 — 커밋 안 됨).
4. **eywa 작업도 워크트리.** `F:/eywa-worktrees/todays-math-api`
   (브랜치 `BIGSHOL/todays-math-api`) — 만들었음.

## 1. 이미 선 것

- `src/lib/eywa/resolveProgress.ts` — 판정기. 실측: 학생 195/195 위치 확보,
  미분류 7.9%, 변이 7/7 빨강. `[개정]` **«195/195» 는 처리율이지 정확도가
  아니다**(codex #23). 정확도는 §7 완료 조건의 육안 표본이 잰다.
- `src/lib/eywa/client.ts` — DB 직결 읽기 전용 통로(과도기용).
- 마이그레이션 적용됨: `Student.eywaStudentId`(unique) ·
  `Class.eywaClassId`(unique) · `Progress.eywaReportId` + unique(report, unit).

## 2. 기반 실측 (전부 운영 DB 에서 잰 값)

| 사실 | 값 | 계획에 미치는 것 |
| --- | --- | --- |
| eywa 정본 체크아웃 | `F:/eywa` (=origin/main). `C:/Creative/eywa` 는 **277커밋 뒤** | eywa 작업은 워크트리에서만 |
| 보고서:학생 | **1:1** (id 19,388 = 행 19,388) | `lesson_reports.id` 가 멱등 키로 성립 (codex #4 해소) |
| 🔴 늦게 쓴 보고서 | **85.6%** 가 수업일 이틀 뒤 이후 작성(최악 253일) · `updated_at` 컬럼 없음 | **증분(since)은 어떤 기준으로도 샌다 → 전량 재동기화** (codex #3·agy #2) |
| 전량 규모 | 진도 있는 보고서 16,390행 | 500행 페이지 33번 — 밤마다 돌려도 싸다 |
| 🔴 다중 수학반 | 활성 수학반 재원생 193명 중 **133명(69%)이 두 반 이상** | 우리 `Student.classId` 단일 FK 로 그대로 못 받음 → §3.3 주반 규칙 (codex #25 적중) |
| 진도는 있는데 수학반 밖 | 5명 | 건너뛰되 **세어서 찍는다** (codex #6) |
| `subject` 컬럼 | 대부분 null (math 1,878 · null 14,512) | 필터로 못 씀 — 판정기가 거른다(미분류 7.9% 에 이미 포함) |
| 수학반 판별 | `classes.subject='math'` enum (91반, 활성 68) | 이름 매칭 아님 (agy #8 해소) |
| 학년 표기 | 재원생 341명 전원 `초1`~`고3` 꼴 | 그래도 수신측 zod 로 검증, 못 읽으면 미분류로 찍음 |

## 3. 계약 (SSOT — 개정판)

### 3.1 공통

- 인증: `Authorization: Bearer $TODAYS_MATH_API_KEY`. 불일치 401 본문 없음.
- `[개정]` 키는 **테넌트에 결속**: eywa env `TODAYS_MATH_TENANT_ID` 가 정하고,
  모든 질의의 **모든 테이블**에 tenant 필터(admin 클라이언트는 RLS 우회라
  한 조인만 새도 전 학원 유출 — codex #8·agy #6). 교차 테넌트 시험 필수.
- `[개정]` 두 라우트 다 `export const dynamic = "force-dynamic"` +
  `Cache-Control: private, no-store` (codex #11·agy #9).
- `[개정]` 응답은 수신측이 **zod 로 전량 검증** — 스키마 어긋나면 그 실행을
  버리고 이전 데이터 유지 (codex #20).

### 3.2 GET /api/integrations/todays-math/roster

```
→ 200 {
    generatedAt: string(ISO),
    total: number,                    // [개정] 수신측이 «받은 수 == total» 검증 (codex #15)
    students: [{
      id, name, grade, school,
      status: "enrolled",
      classes: [{ id, name, startDate }]   // 활성 수학반 전부 (여럿일 수 있다 — 실측 69%)
    }]
  }
```

- 내부는 `fetchAllPaged` — B2(1000행 절단) 방지 (agy #7). 응답은 한 문서
  (341명 규모, 문제 없음).
- `school` 은 남긴다 — '오늘의 시험'(문서 11)이 학교명으로 기출을 고른다.
  연락처·성적·상담·수납은 **안 준다**.

### 3.3 GET /api/integrations/todays-math/progress?cursor=<opaque>

```
→ 200 {
    total: number,                    // [개정] 스냅샷 시점 전체 행 수
    rows: [{ id, studentId, reportDate, createdAt, progress }],
    nextCursor: string | null         // [개정] 불투명 — base64(reportDate|createdAt|id)
  }
```

- `[개정]` **`since` 없음 — 항상 전량.** 늦은 작성 85.6% + `updated_at` 부재라
  증분 기준이 없다. 시간대 경계 문제(codex #16)도 함께 사라진다.
- `[개정]` 커서는 **불투명 토큰**(uuid 하나로는 위치가 안 선다 — codex #1·agy #1).
  구현은 고정 정렬 + offset 내장: keyset 은 timestamptz 동률 직렬화가 한 자리만
  어긋나도 행을 조용히 건너뛴다(성공적으로 렌더되는 오답 부류). 표류는 전량
  재실행 + 멱등 upsert 가 수렴시킨다. 토큰이 불투명하므로 나중에 keyset 으로
  바꿔도 계약은 안 바뀐다.
- `[개정]` 정렬은 `(report_date, created_at, id) ASC` 고정 — 수신측이 순서대로
  적용하면 «그날의 마지막 진도»가 결정적이 된다 (codex #5·agy #4).
- 페이지 500행. 대상: **그 시점 재원생**의 진도 있는 보고서 전부(과목 무관 —
  §2 subject 실측). roster 와 같은 스냅샷 기준 (codex #6).
- 페이지 넘기는 사이에 낀 삽입·삭제는 이번 실행에서 어긋날 수 있다 —
  **다음 전량 실행이 스스로 고친다.** `받은 수 < total` 이면 경고만 찍고
  적용은 한다(다음 실행이 수렴).

### 3.4 계약을 지키는 자리

- eywa 쪽: 라우트 단위 테스트(인증 401 · 테넌트 격리 · 커서 왕복 · 페이지 경계).
- `[개정]` 우리 쪽: **소비자 계약 테스트** — 저장된 응답 픽스처를 zod 스키마에
  물려서, eywa 가 응답을 바꾸면 우리 쪽이 빨개진다 (codex #19).
- `[개정]` 전환 게이트: **그림자 실행** — DB 직결과 API 를 같은 시점에 돌려
  결과 diff 100% 일치 확인 후에만 API 로 넘어간다 (codex #19·agy #10).

## 4. 우리 쪽 동기화 규칙 (개정판)

1. `[개정]` **전송은 명시 스위치**: `EYWA_TRANSPORT=db|api`. 자동 폴백 금지 —
   키 하나 빠졌다고 조용히 전권 DB 로 내려가는 것은 fail-open 이다 (codex #12).
   API 전환 뒤 `EYWA_DATABASE_URL` 은 env 와 코드에서 **둘 다** 제거.
2. **명단**: eywa 학생 → `Student` upsert(키 `eywaStudentId`).
   `[개정]` **주반 규칙**: 여러 수학반이면 `startDate` 최신 반이 주반(동률이면
   반 이름 사전순 — 결정적). 전체 소속은 동기화 보고에 찍어 2단계(D-07)가 본다.
   `[개정]` **대사(reconciliation)**: `받은 수 == total` 검증에 성공한 실행만,
   roster 에 없는 `eywaStudentId IS NOT NULL` 학생을 `eywaWithdrawnAt` 으로
   표시(삭제 아님 — 시험 이력이 딸려 있다). 되돌아오면 NULL 로 푼다 (codex #7·agy #3).
3. **진도**: 보고서를 `(reportDate, createdAt, id)` 순으로 판정 →
   `Progress` upsert(키 `(eywaReportId, unitId)`).
   `[개정]` **삭제 대사**: 전량 실행이 성공하면, 이번 실행에 없는
   `eywaReportId` 의 진도 행은 지운다(eywa 에서 보고서가 삭제된 것) — 원장 먼저.
4. `[개정]` **원자성**: 한 실행 = ① 전 페이지 수집·검증(메모리) → ② 되돌리기
   원장 append(runId 포함) → ③ **한 트랜잭션**으로 적용. 중간에 죽으면 다음
   실행이 처음부터 — 부분 적용이 없다 (codex #13).
5. `[개정]` **동시 실행 금지**: `pg_advisory_xact_lock` — cron 과 수동이 겹치면
   뒤가 즉시 종료 (codex #14).
6. **가드**: dry-run 기본, 실쓰기 `ALLOW_EYWA_SYNC=1`. roster `total==0` 이면
   중단. 미분류·애매·수학반 밖 5명은 **건수+원문**으로 보고서에 찍는다.
7. `[개정]` **HTTP 정책**(api 전송일 때): 타임아웃 60s · 429/5xx 만 3회 지수
   백오프 · redirect 금지 · 응답 zod 검증 (codex #20).
8. `[개정]` **신선도**: 실행마다 `lastSyncedAt` 기록. 48시간 넘으면 2단계
   화면이 경고 배지(codex #21 — 차단은 과하다: 원장님이 보는 물건이다).

## 5. eywa 쪽 구현 노트 (트랙 A)

- 위치: `src/app/api/integrations/todays-math/{roster,progress}/route.ts`.
- `createAdminClient()` + **모든 테이블 tenant 필터** + `TODAYS_MATH_TENANT_ID`.
- eywa 규칙 준수: 파일 200줄 · B1(헤더 한글 금지 — 응답 본문은 무관) ·
  B2(`fetchAllPaged`) · B3. `maxDuration = 60`.
- Next 16.2.6 — **`node_modules/next/dist/docs/` 먼저 읽기**(eywa CLAUDE.md 첫 줄).
- 키 회전 절차를 라우트 주석에 남긴다: 양쪽 env 교체 → 재시작. 키ID·해시·중첩
  키 인프라는 **일부러 안 한다** — 소비자 하나·테넌트 하나에 과하다 (codex #9
  는 규모에 안 맞아 축소 채택, 사유 명기).
- **배포는 안 한다.** 브랜치 푸시까지. 병합·배포는 원장님 (main 푸시 = 배포).

## 6. 접어 둔 것 (일부러 — 사유와 함께)

| 리뷰 지적 | 처분 |
| --- | --- |
| 서명 커서·snapshotId (codex #2) | 전량 동기화가 자기 수렴이라 스냅샷 고정까지 불필요. `total` 검증 + 다음 실행 수렴으로 갈음 |
| 키 수명주기 인프라 (codex #9) | 소비자 1·테넌트 1 — 문서화된 수동 회전으로 충분 |
| 진도 텍스트 PII 감사 (codex #10) | 표본 확인: 커리큘럼 드롭다운 문자열 위주. 자유 메모 유입은 미분류로 떨어져 보고서에 보인다 |
| 호출 빈도 제한 (codex #27) | 페이지 상한 500 + `maxDuration` 으로 갈음. 호출자가 우리 하나 |
| 출제 차단 SLA (codex #21) | 차단 대신 경고 배지 — 원장님 판단이 우선 |
| cron (codex #22) | **이 단계 목표는 «수동 실행으로 검증된 동기화»로 한정**한다고 명시. cron 은 상태가 보이는 화면(2단계)과 함께 |

## 6.5 grok 리뷰가 추가로 바꾼 것 (14건 — 셋 중 가장 깊었다)

grok 은 계획서만 읽지 않고 **양쪽 저장소와 운영 DB alpha 까지 대조**했다.

1. 🔴 **`lesson_reports.class_id`·`makeup_class_id` 는 운영 DB 에만 있다**
   (0134a·0171a — drizzle schema.ts 에 없음). 내 「4테이블 컬럼 동일」 확인은
   **파생물 둘을 비교한 것**이었다. information_schema 로 확인: 존재. 진도 있는
   보고서 16,390 중 1,494(9%)만 값 있음. → 계약 rows 에 `classId`·`makeupClassId`
   포함(nullable). null 이면 주반 귀속.
2. **`students.is_test`(테스트 학생 7명)** — roster·progress 둘 다 제외.
3. **키 미설정 503 ≠ 키 불일치 401** — 상담 반출(`/api/exports/consultations`)
   선례. cron(401 단일)이 아니라 그쪽을 따른다.
4. **«빈 응답 가드»의 축**: 「첫 페이지 0행 + 커서 없음」일 때만 중단.
   뒤 페이지 0행 + nextCursor null 은 정상 종료. 비-200 은 빈 게 아니라 실패.
   명단 → 진도 순서 고정(진도가 먼저면 FK 없는 행이 생긴다).
5. **nearOrderIndex 이음을 동기화도 물려받는다** — 학생별 (report_date,
   created_at, id) 오름차순으로 적용하고 직전 판정의 furthest 를 다음 행에
   넘긴다. 이걸 끊는 변이가 빨개지는 시험 필수 (grok #7).
6. **분모 셋을 따로 센다**: 수학 재원(193) / 진도 있는 재원 / 출제 가능.
   demo·is_test 는 대사 범위 밖 (grok #6).
7. **원문이 바뀐 보고서**: 같은 eywaReportId 에서 이번에 안 나온 unit 행은
   지운다 — 안 지우면 진도 단원 목록이 가짜로 넓어진다 (grok #9).
8. **수동 진도와의 공존**: 연계 학생(`eywaStudentId` 있음)의 같은 날짜에
   eywa 행과 수동 행이 겹치면 eywa 가 이긴다(원장님 확정 「eywa 가 정본」).
   수동 행을 지우진 않는다 — 지우면 «왜 달랐나»가 사라진다 (grok #13).
9. **`Class.grade`(NOT NULL)·`Class.userId` 귀속**: eywa 반에는 학년이 없다.
   grade 는 반 학생 학년의 최빈값(동률이면 낮은 쪽), userId 는 **동기화 실행
   계정**(원장님 계정 하나 — env `EYWA_SYNC_OWNER_EMAIL` 로 지정) (grok #10).
10. 미리보기 배포에 연계 env 를 넣지 않는다 — 공개 URL 이 같은 키를 먹는다
    (grok #8). 원장님 배포 체크리스트에 명기.

## 7. 완료 조건 — **전부 완료** (2026-08-21)

- [x] eywa: 라우트 2 + 테스트 10, 브랜치 푸시 → **원장님 지시로 main 병합·배포**
      (`d3546b9c`, eywa-alpha.vercel.app). 운영 스모크: 401·400·no-store·193명 ✅
- [x] 우리: 동기화(dry-run + 실쓰기 3회 — db 2회·api 1회, 전부 멱등 수렴)
- [x] 실쓰기 검산: 연계 학생 193 == eywa 활성 수학반 재원생 193 ✅
- [x] 정확도 표본 30명(seed 21): **30/30 규칙 일치** (`sample-eywa-accuracy.ts`)
- [x] `default-range` 함수에 동기화 실데이터 — 실학생 3명 범위 확인 ✅
- [x] 그림자 실행: roster 193=193 · progress 12,293=12,293 · **내용 다름 0 ·
      한쪽만 0** (`shadow-eywa-transport.ts`)
- [x] `EYWA_TRANSPORT=api` 고정 + `EYWA_DATABASE_URL`·`EYWA_TENANT_ID` **env 제거**.
      db 전송 강제 시 `EywaNotConfiguredError` 로 시끄럽게 실패(fail-closed 확인)

### §4.1 에서 한 가지 의도적 이탈

계획은 「`EYWA_DATABASE_URL` 을 env 와 **코드**에서 둘 다 제거」라 했다.
**자격증명(env)은 지웠고 코드(`fetchViaDb`·`client.ts`)는 남겼다** — 그림자
diff·읽기 전용 probe 가 그 코드다. 위험한 것은 코드가 아니라 **자격증명**이고,
`requiredTransport` 가 폴백을 막으며, 자격증명 없이 db 전송을 켜면 위처럼
즉시 던진다. 다시 쓰려면 env 를 명시적으로 되넣어야 한다.

### 남은 것 (2단계로)

- cron + 「지금 가져오기」 — 상태가 보이는 화면과 함께 (D-07 Wire 부터)
- eywa Vercel env 는 **Production 에만** 있다. 미리보기 배포에 넣지 말 것
- 같은 날 두 갈래(정규+특강) 학생의 진도 분리 — 계약의 `classId` 로 2단계가 가른다

---

## §8 2단계 — 학생별 일일 확인테스트 화면 (2026-08-21, D-07 절차 완료)

### 확정 이력 (전부 원장님, 2026-08-21)

| 물음 | 확정 | 근거 시안 |
|---|---|---|
| 화면 골격 | **D 예외 우선** (5안 중) | `/dev/eywa-daily-wire` — 실데이터 두 날 |
| 첫 회 범위 | **현재 대단원만** → D-63 | 실측: 현행 73갈래·최대 368단원 ↔ 대단원 51갈래 |
| 시험기간 학생 | **표시만, 자동 제외** → D-64 | 8/20 실측 78명 중 39명 |
| 시각 처리 | **① 계기판** (4안 중) | `/dev/eywa-daily-hifi` |
| 위치 | **메인 상단 합치기** → D-65 | — |

### 들어간 것

- `resolveDefaultReviewRange` D-63(`chapter-start`) · `planDailyReview` 순수 계획
- `GET /api/tests/daily-review` — 자동/부족/시험기간/범위없음 + `todayTests`(중복 방지)
  + `EywaSyncRun` 스트립. 풀 세기는 출제와 같은 where(`eligibleProblemsWhere`)
- `DailyReviewSection` — 메인 상단 계기판. 「모두 출제」는 기존 generate 를 학생별로
- 동기화: 학생 `eywaLastReportDate/Text`(D-64) + `EywaSyncRun`(성공한 실행만) 기록

### 남은 것 (다음 트랙)

1. ~~「지금 가져오기」 + POST /api/eywa-sync~~ ✅ **끝 (2026-08-21)** — 본체를
   `src/lib/eywa/runSync.ts` 로 옮겨 CLI 와 라우트가 **같은 함수**를 쓴다.
   서버 원장은 `EywaSyncLedger` 표(최근 14회, 동률은 runId 사전순 = 시간순).
   실물: 로그인 세션으로 POST → **14.5초**에 전체 동기화(13,577행) — 화면
   「지금 가져오기」 버튼이 이걸 부르고 끝나면 섹션을 새로 읽는다.
2. ~~cron~~ ✅ 코드는 끝 — `vercel.json` cron(매일 22:30 UTC = 한국 07:30) →
   `GET /api/eywa-sync/cron`(CRON_SECRET 문지기, 시크릿 없으면 503 잠김).
   ⚠️ **운영에 켜려면 todays-math Vercel 프로젝트에 env 5개가 필요하다**(아직 안 넣음
   — Vercel CLI 가 chrismathone 계정에 로그인돼 있어 이 세션에서 못 넣었다):
   `EYWA_TRANSPORT=api` · `EYWA_API_URL` · `EYWA_API_KEY` · `EYWA_SYNC_OWNER_EMAIL=test_t@osu.com`
   · `CRON_SECRET`(새로 생성). 넣기 전까지 운영의 버튼·cron 은 명확한 사유로 실패한다
   (fail-closed). 로컬은 .env 로 이미 동작.
3. ~~eywa 반 62개 소유 이관~~ ✅ **끝 (2026-08-21)** — 원장님 확정: 로그인 계정은
   `test_t@osu.com` 그대로. 반 62개 이관 완료(원장:
   `scripts/sync/ledgers/class-owner-transfer-2026-08-21.json`), env
   `EYWA_SYNC_OWNER_EMAIL` 도 같은 계정으로(앞으로 생기는 반도 이 소유).
   실물 스모크: 이관 후 학생별 출제 **201**(곽경찬 8/20 범위, 초안 8문항) →
   `todayTests` 로 잡혀 「모두 출제」가 그 학생을 건너뛰는 것까지 확인.
4. 이중 트랙(정규+특강) 분리 — 계약의 `classId`.
5. 초등 문항 부족(대단원 범위 기준 8/10 실측 14갈래) — 문항 보충이 본질.
   화면은 「부족 — 자동에서 뺌」으로 정직하게 보여 준다.
