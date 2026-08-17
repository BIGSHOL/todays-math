import withBundleAnalyzer from "@next/bundle-analyzer";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 개발 서버(next dev)에서 LAN IP(192.168.101.32:3000)로 접속할 때 클라이언트 번들·HMR·폰트 등
  // /_next 리소스 요청이 cross-origin으로 차단돼 하이드레이션이 되지 않는 문제를 푼다.
  // (차단 시 로그인 폼이 JS 없이 네이티브 GET으로 제출됨.) dev 전용 설정이라 프로덕션엔 영향 없음.
  allowedDevOrigins: ["192.168.101.32"],

  experimental: {
    // 배럴(barrel) 재수출 패키지를 실제 참조하는 하위 모듈로 바꿔 준다.
    //
    // ⚠️ **실측하니 이 저장소에서는 효과가 0 이다** (2026-08-17, Next 16 + Turbopack).
    //    빈 배열 / 아래 목록 / next-auth·katex·@prisma/client 까지 넣은 목록,
    //    셋 다 라우트별 first-load JS 와 static chunks 총량이 **바이트 단위로 동일**했다
    //    (전체 1482.6KB 불변). Turbopack 이 이미 같은 일을 하는 것으로 보인다.
    //
    //    남겨 두는 이유는 「지금 뭔가를 줄이고 있어서」가 아니라, 나중에 배럴 import 가
    //    다시 초기 번들에 들어왔을 때의 방어선이기 때문이다. **번들이 줄어든 근거로
    //    이 설정을 인용하지 말 것** — 실제로 줄인 것은 수리 C-1(zod 지연)과
    //    C-2(KaTeX 지연)다. 목록을 고쳤으면 `npm run analyze` 로 반드시 재실측할 것.
    optimizePackageImports: [
      "zod",
      "react-markdown",
      "rehype-katex",
      "remark-math",
    ],
  },
};

/**
 * 번들 회귀 가시성 (성능 수리 C-4).
 *
 * ⚠️ `@next/bundle-analyzer` 는 **Turbopack 빌드에서 아무것도 만들지 않는다.**
 *    패키지 소스가 직접 그렇게 말한다 — `process.env.TURBOPACK` 이면 경고만 찍고
 *    설정을 그대로 돌려준다. 이 저장소의 `npm run build` 는 Turbopack 이므로
 *    이걸 그냥 붙여 두면 **실패가 침묵하는 계측기**가 된다(리포트가 안 나오는데
 *    빌드는 초록). 그래서 용도를 둘로 갈랐다:
 *
 *      npm run analyze    → Turbopack 네이티브 분석기. **실제 프로덕션 빌드**를 잰다. 기본.
 *      npm run analyze:webpack → webpack 빌드 + 이 플러그인. 트리맵 HTML 이 필요할 때만.
 *
 *    두 번째 경로는 실제 배포 빌드와 다른 번들러이므로 숫자를 그대로 믿지 말 것.
 */
export default withBundleAnalyzer({ enabled: process.env.ANALYZE === "1" })(
  nextConfig,
);
