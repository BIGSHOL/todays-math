# 트랙 인계 산출물 (커밋됨)

`scripts/qa/reports/` 는 통째로 gitignore 대상이라 **다른 워크트리로 못 넘긴다.**
(참고: `.gitignore` 의 `!scripts/qa/reports/topic-coverage.json` 예외는 실제로는
동작하지 않는다 — 부모 디렉터리가 제외되면 git 이 안으로 내려가지 않아 파일 단위
negation 이 무시된다. 그 파일은 규칙보다 먼저 추적돼서 남아 있는 것이다.)

그래서 **다른 트랙·다른 워크트리가 읽어야 하는 산출물만** 여기에 둔다.
본문은 싣지 않는다 — 행을 되짚을 열쇠와 판정 사유만 담는다(tracks/README §4).

| 파일 | 내용 | 만든 명령 |
|---|---|---|
| `hwp-verdict-list.json` | 트랙 D 본문 교체 판정 (교체 4,069 · 보류 316). **아직 DB 에 쓰지 않았다** | `npx tsx scripts/qa/export-verdict-list.ts` |
| `missing-cause.json` | 문항 결손 감사 — 사유별 분해와 진짜 유실의 하한 | `npx tsx scripts/qa/diagnose-missing-cause.ts` |
