/**
 * webpack 빌드 + `@next/bundle-analyzer` 트리맵 리포트 (성능 수리 C-4).
 *
 * 왜 래퍼가 필요한가:
 *  1. `ANALYZE=1 next build` 같은 인라인 환경변수 지정은 Windows(cmd.exe)에서 안 먹는다.
 *     원장님 환경이 Windows 라 npm 스크립트에 그대로 쓸 수 없고, 이것 하나 때문에
 *     `cross-env` 의존성을 새로 넣지는 않는다.
 *  2. `@next/bundle-analyzer` 는 **Turbopack 빌드에서 리포트를 만들지 않는다**(패키지
 *     소스가 `process.env.TURBOPACK` 이면 경고만 찍고 빠진다). 그래서 여기서
 *     `--webpack` 을 강제로 붙인다.
 *
 * ⚠️ 이 경로는 실제 배포 빌드(`npm run build`, Turbopack)와 **다른 번들러**다.
 *    「무엇이 번들에 들어왔나」를 눈으로 볼 때만 쓰고, 크기 숫자는
 *    `npm run analyze`(Turbopack 네이티브) 쪽을 정본으로 삼을 것.
 */
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";

// `npx.cmd` 를 spawn 하면 최신 Node 의 Windows 정책 때문에 EINVAL 이 난다.
// next 진입점을 직접 node 로 돌리면 셸을 타지 않아 플랫폼 차이가 사라진다.
const nextBin = createRequire(import.meta.url).resolve("next/dist/bin/next");

const result = spawnSync(process.execPath, [nextBin, "build", "--webpack"], {
  stdio: "inherit",
  env: { ...process.env, ANALYZE: "1" },
});

if (result.error) {
  console.error(result.error);
  process.exit(1);
}
if (result.status === 0) {
  console.log(
    "\n트리맵 리포트: .next/analyze/client.html · nodejs.html · edge.html",
  );
}
process.exit(result.status ?? 1);
