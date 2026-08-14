/**
 * 완료본(원본) 판별 — D-37.
 *
 * 기출 추출 대상은 워드본을 PDF로 변환한 `(완료)` 표기 파일뿐이다.
 * 스캔 원본은 텍스트 레이어가 없어 OCR 훼손률이 5배, 정답 결손이 2배다
 * (2026-08-14 exam_index.db 9,173문항 전수 실측 — docs/planning/08-import-ledger.md §5.1).
 */

/** `(완료)` · `（완료）` · `(완료 )` 등 표기 변형을 모두 잡는다. */
const FINAL_MARK = /[(（]\s*완\s*료\s*[)）]/;

/**
 * 완료본 원본에서 온 문항인가.
 *
 * 경로를 모르면(`null`/`undefined`) **참으로 본다** — 2026-08-14 이전 이관분에는
 * 파일 단위 기록이 없다. 여기서 막으면 기존 데이터 재적재가 통째로 깨진다.
 */
export function isFinalSource(sourceFile: string | null | undefined): boolean {
  if (!sourceFile) return true;
  return FINAL_MARK.test(sourceFile);
}

/**
 * 비완료 원본을 예외적으로 허용하는가.
 *
 * 완료본이 아예 없는 시험지에 한해 `ALLOW_NON_FINAL_SOURCE=1` 로 명시적으로 연다.
 * 상시로 켜 두지 말 것 — 그 순간 D-37은 사문이 된다.
 */
export function allowNonFinalSource(): boolean {
  return process.env.ALLOW_NON_FINAL_SOURCE === "1";
}
