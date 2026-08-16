/**
 * 학교명 정규화 — 학생 입력("경명여중")과 기출 인덱스 표기("경명여자중학교")를 **같은 키**로 만든다.
 *
 * SSOT 이식: `C:\Creative\eywa\src\features\schools\school-name.ts` (읽기 전용, 손대지 않음).
 * eywa 는 학교알리미 공시명과 학원생 입력값을 잇는 데 썼고, 여기서는 '오늘의 시험' 예측 대상
 * (Student.schoolName)과 기출 인덱스(exams.school)를 잇는 데 그대로 쓴다 — 규칙은 동일하다.
 *
 * 🔴 치환 순서가 규칙이다. `여자중학교`를 `중학교`보다 **먼저** 지워야 한다 — 반대로 하면
 * "경명여자중학교"가 "경명여자"가 되어 "경명여중"과 영영 안 붙는다(eywa 실측: 여학교 6종
 * 23+12+6+4+1+1 = 47명이 통째로 매칭에서 빠졌던 원인).
 *
 * ⚠️ 지역 접두("대구")도 지운다 — 같은 학교가 "일중"과 "대구일중" 두 표기로 들어가 있으면
 * 점유율이 쪼개진다. 지우면 둘 다 "일중"으로 합쳐진다. 단, 지운 결과가 학교급만 남으면
 * (`대구중학교` → `중`) 지우지 않는다 — 급만 남은 이름에는 급만 뜻하는 쓰레기 입력이 붙는다.
 */

// 긴 것부터. 순서를 바꾸면 조용히 오매칭된다.
const SUFFIX_RULES: [RegExp, string][] = [
  [/여자상업고등학교$/, "여상"],
  [/여자정보고등학교$/, "여고"],
  [/여자중학교$/, "여중"],
  [/여자고등학교$/, "여고"],
  [/여자초등학교$/, "여초"],
  [/초등학교$/, "초"],
  [/중학교$/, "중"],
  [/고등학교$/, "고"],
  // "칠성초등"처럼 '학교'가 빠진 표기. '초등학교$'보다 뒤에 둬야 한다.
  [/초등$/, "초"],
  [/중등$/, "중"],
  [/고등$/, "고"],
];

/** 급만 남은 꼴 — 학교를 특정하지 못한다. 지역 접두를 지울지 판단할 때와, 소비처의 '기타' 판정에 쓴다. */
const BARE_KIND_RE = /^(초|중|고|여초|여중|여고|여상)$/;

/**
 * 학원장이 지정한 예외 별칭. **자동 추론이 아니라 사람이 확정한 매핑만** 넣는다.
 * "달산"은 급이 없어 원칙상 '기타'지만 대구에 달산초등학교가 실재하고 다른 후보가 없어 확정했다.
 * ⚠️ 여기에 추측을 넣지 말 것 — 애매한 건 정규화하지 않고 그대로 두는 편이 분포를 덜 왜곡한다.
 */
const ALIASES: Record<string, string> = { 달산: "달산초" };

function applySuffix(s: string): string {
  for (const [re, to] of SUFFIX_RULES) if (re.test(s)) return s.replace(re, to);
  return s;
}

/**
 * 🔴 지역 접두를 지웠더니 **학교급만 남는** 이름이 있다 — `대구초등학교`·`대구중학교`·`대구고등학교`·
 * `대구여자고등학교`가 각각 `초`·`중`·`고`·`여고`가 된다(전부 실재하는 대구 학교다).
 * 그 결과 급만 뜻하는 쓰레기 입력("초"·"중" 등)이 그 학교에 그대로 붙어버리므로,
 * 지운 뒤 급만 남으면 **안 지운다**(`대구초`로 남긴다).
 */
function stripRegionPrefix(s: string): string {
  const stripped = s.replace(/^대구광역시/, "").replace(/^대구/, "");
  if (stripped === s) return s;
  if (!stripped || BARE_KIND_RE.test(applySuffix(stripped))) return s;
  return stripped;
}

export function normalizeSchoolName(raw: string | null | undefined): string {
  let s = String(raw ?? "").replace(/\s+/g, "");
  if (!s) return "";
  // 괄호 주석("(분교)" 등)은 매칭에 방해만 된다.
  s = s.replace(/\（.*?\）|\(.*?\)/g, "");
  // 학년 꼬리("달성초1"·"종로초6") — 학교명은 숫자로 끝나지 않는다.
  s = s.replace(/\d+$/, "");
  s = stripRegionPrefix(s);
  s = applySuffix(s);
  return ALIASES[s] ?? s;
}

/** 정규화 키가 학교 이름 꼴인가(= 급으로 끝나고, 급만 있는 게 아닌가). */
export function isSchoolLikeKey(key: string): boolean {
  if (!key || BARE_KIND_RE.test(key)) return false;
  return /(초|중|고|여상)$/.test(key);
}
