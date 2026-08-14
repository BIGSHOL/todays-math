import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // 개발 서버(next dev)에서 LAN IP(192.168.101.32:3000)로 접속할 때 클라이언트 번들·HMR·폰트 등
  // /_next 리소스 요청이 cross-origin으로 차단돼 하이드레이션이 되지 않는 문제를 푼다.
  // (차단 시 로그인 폼이 JS 없이 네이티브 GET으로 제출됨.) dev 전용 설정이라 프로덕션엔 영향 없음.
  allowedDevOrigins: ["192.168.101.32"],
};

export default nextConfig;
