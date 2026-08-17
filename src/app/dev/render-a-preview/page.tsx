import { notFound } from "next/navigation";
import { connection } from "next/server";

import { PreviewClient } from "./PreviewClient";

/**
 * 렌더 수리 A 시안 — 문제은행 지면 배치를 실데이터 없이 확인한다 (D-07 시안 제시용).
 *
 * 이웃 dev 페이지(dev/katex, dev/transfer-qa)와 **같은 가드**다 — 이게 없으면
 * 프로덕션에 프리렌더돼 픽스처까지 번들에 딸려 들어간다.
 */
export default async function RenderAPreviewPage() {
  await connection();

  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  return <PreviewClient />;
}
