/**
 * PNG·JPEG 머리에서 **원본 치수만** 읽는다 (디코딩하지 않는다).
 *
 * 왜 라이브러리를 안 쓰나: 필요한 것은 `public/figures` 12,129장의 폭·높이뿐이고,
 * 그 값은 파일 앞쪽 수십 바이트에 있다. 275MB 를 디코딩할 이유가 없다.
 *
 * 쓰는 곳은 적재 스크립트(`scripts/qa/extract-figure-dimensions.ts`) 하나다.
 * **런타임 판정은 파일을 읽지 않는다** — DB `problem.figure_dims` 에 적재된 값을 쓴다
 * (`printOverflow.ts` 의 그림 줄 수 환산).
 *
 * ⚠️ 모르는 것은 `null` 로 둔다. 추측한 치수를 흘리면 판정이 «안다»고 착각한다 —
 *    모른다고 두어야 판정 쪽이 보수적 상수로 받는다.
 */

export interface ImageDimensions {
  width: number;
  height: number;
}

const PNG_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

/** SOF 마커 — 이 뒤에 높이·폭이 있다. C4(허프만)·C8(확장)·CC(산술)는 SOF 가 아니다. */
function isStartOfFrame(marker: number): boolean {
  return (
    marker >= 0xc0 &&
    marker <= 0xcf &&
    marker !== 0xc4 &&
    marker !== 0xc8 &&
    marker !== 0xcc
  );
}

function readPng(buffer: Buffer): ImageDimensions | null {
  // 서명(8) + 청크 길이(4) + "IHDR"(4) 뒤에 폭·높이가 각 4바이트.
  if (buffer.length < 24) return null;
  if (!buffer.subarray(0, 8).equals(PNG_SIGNATURE)) return null;
  if (buffer.subarray(12, 16).toString("latin1") !== "IHDR") return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

function readJpeg(buffer: Buffer): ImageDimensions | null {
  if (buffer.length < 4) return null;
  if (buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;

  let offset = 2;
  while (offset + 3 < buffer.length) {
    if (buffer[offset] !== 0xff) return null; // 마커 자리가 아니면 구조가 깨진 것이다.
    const marker = buffer[offset + 1]!;
    if (marker === 0xff) {
      offset += 1; // 채움 바이트
      continue;
    }
    // 본문 없는 마커 — RSTn(D0~D7) · SOI(D8) · EOI(D9) · TEM(01)
    if ((marker >= 0xd0 && marker <= 0xd9) || marker === 0x01) {
      offset += 2;
      continue;
    }
    if (offset + 4 > buffer.length) return null;
    const length = buffer.readUInt16BE(offset + 2);
    if (length < 2) return null;
    if (isStartOfFrame(marker)) {
      // 세그먼트: 길이(2) 정밀도(1) 높이(2) 폭(2)
      if (offset + 9 > buffer.length) return null;
      return {
        height: buffer.readUInt16BE(offset + 5),
        width: buffer.readUInt16BE(offset + 7),
      };
    }
    offset += 2 + length;
  }
  return null;
}

/** 버퍼에서 치수를 읽는다. PNG·JPEG 어느 쪽도 아니거나 구조가 깨졌으면 `null`. */
export function readImageDimensions(buffer: Buffer): ImageDimensions | null {
  const dims = readPng(buffer) ?? readJpeg(buffer);
  if (!dims) return null;
  if (!Number.isInteger(dims.width) || !Number.isInteger(dims.height))
    return null;
  if (dims.width <= 0 || dims.height <= 0) return null;
  return dims;
}
