/**
 * `public/figures` 의 그림 한 장에서 **원본 치수만** 읽는다 (Node 전용 · 디코딩 없음).
 *
 * 왜 한 곳에 모으나: 같은 「머리만 읽어 치수를 뽑는다」를 적재 스크립트 셋이 각자
 * 가지고 있었다. 그 사이 **문항이 들어오는 길**(`toLoadRows`)에는 아무것도 없어서,
 * 2026-08-18 적재분 8,442건 뒤에 들어오는 그림 문항은 전부 치수가 빈 채였다
 * (적대적 리뷰 ④ C — 새 문항 재현율 96.1% → 60.4%).
 *
 * ⚠️ **모르는 것은 `null`.** 추측한 치수를 흘리면 판정이 «안다»고 착각한다.
 *    한 장이라도 모르면 그 문항은 치수를 통째로 비워야 한다(`toLoadRows`).
 */
import { readFileSync } from "node:fs";
import path from "node:path";

import { readImageDimensions } from "@/lib/printImageDimensions";

/** 머리만 읽으면 되므로 앞부분만 읽는다. JPEG 는 EXIF 가 길어 넉넉히 잡는다. */
const HEAD_BYTES = 256 * 1024;

const cache = new Map<string, [number, number] | null>();

/** `public` 아래 경로(`/figures/…`)를 실제 파일 경로로. */
function publicPathFor(figureUrl: string): string | null {
  if (!figureUrl.startsWith("/")) return null;
  return path.join(process.cwd(), "public", figureUrl);
}

export function readFigureDimensions(
  figureUrl: string,
): [number, number] | null {
  const cached = cache.get(figureUrl);
  if (cached !== undefined) return cached;

  let result: [number, number] | null = null;
  const file = publicPathFor(figureUrl);
  if (file) {
    try {
      const head = readFileSync(file).subarray(0, HEAD_BYTES);
      const measured = readImageDimensions(head);
      if (measured) result = [measured.width, measured.height];
    } catch {
      result = null; // 파일이 없으면 «모른다» — 추측하지 않는다.
    }
  }
  cache.set(figureUrl, result);
  return result;
}

/** 테스트·배치 재실행용. 파일이 바뀌었을 때만 쓸 일이 있다. */
export function clearFigureDimensionCache(): void {
  cache.clear();
}
