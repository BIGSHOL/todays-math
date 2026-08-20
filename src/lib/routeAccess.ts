/**
 * 역할 게이트 — 「검수 계정이 어디까지 갈 수 있나」를 **한 곳에서** 정한다.
 *
 * 대응 계약: src/contracts/problemReport.contract.ts (`userRoleSchema`)
 * 부르는 곳: src/middleware.ts (화면·API 를 통틀어 여기 하나로 지난다)
 *
 * 🔴 **허용 목록이다. 차단 목록이 아니다.**
 *    차단 목록으로 하면 새 라우트를 적는 걸 잊었을 때 검수 계정에게 **열린다** —
 *    잊는 쪽이 사고가 된다. 허용 목록은 잊으면 **닫힌다**: 검수 화면에서
 *    「권한 없음」이 바로 보이므로 그 자리에서 알아챈다.
 *    (손으로 적은 목록은 반드시 샌다. 샐 때 **안전한 쪽으로** 새게 둔다.)
 *
 * ⚠️ 역할의 «참»은 DB 의 `user.role` 이고, 이 함수는 **JWT 에 실린 사본**으로 판정한다.
 *    그래서 역할을 바꾸면 **다시 로그인해야** 반영된다. 지금은 계정이 둘뿐이라
 *    이걸로 충분하다 — 미들웨어에서 매 요청 DB 를 읽으면 모든 화면에 왕복이 하나 붙는다.
 */
import type { UserRole } from "@/contracts/problemReport.contract";

export type RouteAccess = "allow" | "deny";

type Rule = {
  /** `"*"` 면 메서드를 안 가린다. */
  methods: "*" | readonly string[];
  /**
   * 사람이 읽는 경로. `{id}` 는 **한 칸**(`/` 를 안 넘는다), 끝의 `/**` 는 그 아래 전부.
   * 정규식은 이 문자열에서 **만들어 쓴다** — 두 벌로 적으면 한쪽만 고쳐도 아무도 모른다.
   */
  path: string;
  why: string;
};

/**
 * 검수 계정이 **할 수 있는 것 전부**. 여기 없으면 못 한다.
 *
 * 「해설 생성」·「그림 다시 그리기」는 아직 라우트가 없다. 생기면 여기에 **추가해야**
 * 검수 화면에서 눌린다 — 안 적으면 닫힌 채로 있고, 그 편이 안전하다.
 */
const REVIEWER_RULES: readonly Rule[] = [
  { methods: "*", path: "/api/auth/**", why: "로그인·로그아웃" },
  { methods: ["GET"], path: "/api/problems", why: "문제은행 목록" },
  { methods: ["GET"], path: "/api/problems/{id}", why: "문항 하나" },
  { methods: ["POST"], path: "/api/problems/{id}/reports", why: "신고" },
  {
    methods: ["PATCH"],
    path: "/api/problems/{id}/review-status",
    why: "검수 판정 — 검수 콘솔의 본체다",
  },
  {
    methods: ["POST"],
    path: "/api/problems/{id}/review",
    why: "통과·판단 못 하겠다·신고 — 검수 콘솔의 본체다",
  },
  { methods: ["GET"], path: "/api/review/queue", why: "다음에 볼 문항" },
  { methods: ["GET"], path: "/api/units", why: "단원 이름" },
  { methods: ["GET"], path: "/review/**", why: "검수 화면" },
  { methods: ["GET"], path: "/login", why: "로그인 화면" },
];

/**
 * 검수 계정이 할 수 있는 일의 목록 — 테스트가 이것을 그대로 잠근다.
 * 하나라도 늘거나 넓어지면 빨개져서 리뷰에 보인다.
 */
export const REVIEWER_CAPABILITIES: readonly string[] = REVIEWER_RULES.map(
  (r) => `${r.methods === "*" ? "*" : r.methods.join("|")} ${r.path}`,
);

// 🔴 이 파일에는 역슬래시 문자를 **직접 적지 않는다.** 셸 heredoc·파이썬을 거쳐
//    파일을 쓸 때 역슬래시가 조용히 한 겹 벗겨져 정규식이 깨진 전례가 여러 번 있다.
const BSLASH = String.fromCharCode(92);
const RE_SPECIAL = ".*+?^${}()|[]" + BSLASH;

function escapeRe(s: string): string {
  let out = "";
  for (const c of s) out += RE_SPECIAL.includes(c) ? BSLASH + c : c;
  return out;
}

/** `/api/problems/{id}/reports` → `^/api/problems/[^/]+/reports$` */
function toPattern(path: string): RegExp {
  const suffix = "/**";
  let body: string;
  if (path.endsWith(suffix)) {
    // 그 경로 자신과 그 아래 전부.
    body = escapeRe(path.slice(0, -suffix.length)) + "(/.*)?";
  } else {
    body = escapeRe(path);
  }
  // `{id}` 는 한 칸이다 — `/` 를 넘으면 하위 경로가 딸려 열린다.
  body = body.split(escapeRe("{id}")).join("[^/]+");
  return new RegExp("^" + body + "$");
}

const COMPILED: readonly { methods: "*" | readonly string[]; re: RegExp }[] =
  REVIEWER_RULES.map((r) => ({ methods: r.methods, re: toPattern(r.path) }));

/** 끝의 `/` 는 같은 경로다. 안 지우면 `/review/` 가 닫힌다. */
function normalize(pathname: string): string {
  if (pathname.length > 1 && pathname.endsWith("/"))
    return pathname.slice(0, -1);
  return pathname;
}

export function routeAccessFor(
  role: UserRole,
  method: string,
  pathname: string,
): RouteAccess {
  // 원장은 이 서비스의 주인이다. 가릴 것이 없다.
  if (role === "director") return "allow";

  const path = normalize(pathname);
  const m = method.toUpperCase();
  for (const rule of COMPILED) {
    if (rule.methods !== "*" && !rule.methods.includes(m)) continue;
    if (rule.re.test(path)) return "allow";
  }
  return "deny";
}
