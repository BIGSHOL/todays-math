/**
 * 빈칸 기입 줄 — `각 (　　)` · `각의 꼭짓점 (　　)` 처럼 한글 레이블 + 빈 괄호.
 *
 * `parseProblemContent` 의 `collapseWhitespace` 가 개행을 공백으로 합치므로,
 * 초등 교재의 기입 칸이 한 줄로 붙는다. 하위 문항 `(1)(2)` 와 같은 자리:
 * **녹이기 전에** 자리를 표시한다.
 *
 * 한 번만 나오면 나누지 않는다 — 「빈칸 (　　) 에 알맞은 수를」 같은 문장 속
 * 빈칸은 발문의 일부다. 두 칸 이상일 때만 각 칸을 문단으로 세운다.
 */
import { tokenizeMath } from "@/lib/math/segments";

export interface BlankAnswerSlot {
  index: number;
  length: number;
}

/**
 * 한글 레이블 + 빈 괄호. 괄호 안은 전각 공백·반각 공백이 두 칸 이상.
 * `각 (가)` · `(1)` · `(0, 4)` 는 빈칸이 아니라서 안 잡힌다.
 */
const SLOT =
  /[가-힣](?:[가-힣의 ]{0,16}[가-힣])?[ \t]*[\(（][ 　]{2,}[\)）]/g;

export function findBlankAnswerSlots(text: string): BlankAnswerSlot[] {
  if (!text) return [];
  const hits: BlankAnswerSlot[] = [];
  let offset = 0;
  for (const seg of tokenizeMath(text)) {
    if (seg.type === "text") {
      SLOT.lastIndex = 0;
      for (const match of seg.value.matchAll(SLOT)) {
        hits.push({
          index: offset + (match.index ?? 0),
          length: match[0].length,
        });
      }
      offset += seg.value.length;
      continue;
    }
    offset += seg.value.length + (seg.type === "display" ? 4 : 2);
  }
  return hits.length >= 2 ? hits : [];
}
