/**
 * **R2 — 줄 중간 보기 마커를 보기 경계로 본다.** 규칙은 여기 한 벌뿐이다.
 *
 * 제품 파서(`parseProblemContent`)와 QA 자(`simulate-choice-repairs` ·
 * `hwpRescueRules`)가 **이 파일 하나**를 읽는다. 옮겨 적으면 세는 쪽과 고치는 쪽이
 * 같이 눈이 먼다(CLAUDE.md 2026-08-18).
 *
 * 원래 `scripts/qa/` 에 있었는데, 원장님 확정으로 **제품 동작이 되었으므로**
 * 제품이 소유하고 QA 쪽이 읽어 가는 방향으로 뒤집었다. 반대로 두면 Next 번들이
 * `scripts/` 를 끌고 들어간다.
 */
import { BODY_CHOICE_MARKS } from "@/lib/math/circledNumber";

/**
 * ⚠️ **본문 마커는 좁게 둔다.** `circledNumber.ts` 가 «정답 판독은 전 계열,
 * 본문 마커는 ①..⑮」로 갈라 두었다 — 넓히면 `❶`·`➊` 로 적힌 **규칙 항목·작도
 * 순서·그래프 라벨**이 보기로 잘려 성한 문항이 깨진다(실측 6행 전량 육안).
 */
const CIRCLED_1_15 = BODY_CHOICE_MARKS;
/**
 * R2 — 「바로 앞 마커의 **다음 번호**가 줄 중간에 있으면」 그 앞에서 줄을 나눈다.
 *
 * ⚠️ **줄 중간에서는 원문자(`①`)만 본다.** 처음에는 `N.`·`N)` 도 함께 봤는데,
 * 성한 문항 **3건이 깨졌다** — `-4.5` 의 `4.` 와 `(1,~-2)` 의 `2)` 가 마커로 잡혀
 * 보기가 쪼개졌다(성명여중 11 · 경상여고 1 · 동원중 15). 소수점과 좌표는 이 축에서
 * 마커와 **겹친다.** 겹치는 축에 문턱을 놓으면 어느 쪽으로 옮겨도 한쪽이 틀리므로
 * (2026-08-18 «문턱이 아니라 축이 틀린 것이다») 열쇠를 **글자 모양**으로 바꿨다.
 * 줄머리 마커는 종전대로 둘 다 본다 — 거기서는 겹치지 않는다.
 */
export function splitInlineChoiceMarkers(raw: string): string {
  const text = (raw ?? "").replace(/\r\n?/g, "\n");
  let out = "";
  let rest = text;
  let expected = 0; // 다음에 올 보기 번호. 0 이면 아직 첫 마커를 못 봤다.
  const MARKER = new RegExp(`(\\n[ \\t]*)?([${CIRCLED_1_15}]|[1-9][0-9]?[.)])`);
  for (;;) {
    const m = MARKER.exec(rest);
    if (!m) break;
    const atLineStart = m[1] !== undefined;
    const token = m[2]!;
    const circled = CIRCLED_1_15.indexOf(token[0]!);
    const num = circled >= 0 ? circled + 1 : Number(/^(\d+)/.exec(token)![1]);
    const end = m.index + m[0].length;

    if (atLineStart) {
      expected = num + 1;
      out += rest.slice(0, end);
    } else if (circled >= 0 && (num === expected || num === 1)) {
      // 줄 중간인데 **원문자**이고 «다음 번호»다 → 경계로 본다.
      // `expected === 0 && num === 1` 은 **줄머리 마커가 하나도 없는** 문항의 시작이다
      // (보기 다섯이 통째로 한 줄에 붙은 부류). 이걸 안 두면 그 부류가 통째로 안 잡힌다.
      out += `${rest.slice(0, m.index)}\n${token} `;
      expected = num + 1;
    } else {
      out += rest.slice(0, end);
    }
    rest = rest.slice(end);
  }
  return out + rest;
}
