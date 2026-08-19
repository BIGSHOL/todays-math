import { notFound } from "next/navigation";
import { connection } from "next/server";

import { RangeHifiClient } from "./RangeHifiClient";

/**
 * 확인테스트 범위 Hi-fi 시안 — 실제 토큰·컴포넌트로 그린 화면 (D-07 시안 제시용).
 *
 * 이웃 dev 페이지(dev/render-a-preview, dev/katex)와 **같은 가드**다 — 이게 없으면
 * 프로덕션에 프리렌더돼 픽스처까지 번들에 딸려 들어간다.
 */
export default async function RangeHifiPage() {
  await connection();

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  return <RangeHifiClient />;
}
