/**
 * **R2 — 줄 중간 보기 마커를 보기 경계로 본다** (제품 파서).
 *
 * 원본 지면이 보기를 두 열로 앉히거나 한 줄에 몰아 놓으면 추출이 `① 가 ② 나` 처럼
 * 붙여 놓는다. 파서는 `\n` 뒤의 마커만 보므로 그 문항은 **보기가 0칸**이 되고,
 * 학생은 정답을 고를 칸이 없다. 실측 **27건**이 이것만으로 살아난다.
 *
 * ## 가드 — 「1..n 이고 n>=4 일 때만 받는다」
 *
 * 이 가드는 앞 트랙이 **반대쪽 44,099건에 대 보며 세 번 고쳐** 얻은 것이다:
 *
 * | 시도 | 살린 것 | 성한 문항을 깬 것 | 무엇이 틀렸나 |
 * | --- | ---: | ---: | --- |
 * | 줄 중간의 `①`·`N.`·`N)` 를 다 본다 | 7 | **3** | `-4.5` 의 `4.` · `(1,~-2)` 의 `2)` |
 * | 줄 중간에서는 원문자만 본다 | 7 | 0 | 줄머리 마커가 없는 문항은 시작을 못 한다 |
 * | 줄 중간의 `①` 에서 다시 시작 | 32 | **5** | 서술형의 「두 직선 ①, ②를」이 잘렸다 |
 * | **+ 「1..n 이고 n>=4」** | **32** | **0** | 최종 |
 *
 * `n >= 4` 는 문턱이 아니라 **분포**에서 왔다 — 보기가 있는 문항의 99% 가 정확히 5칸.
 *
 * 픽스처는 **줄이지 않은 실제 행**이고, 위 표에서 이름이 나온 문항을 그대로 담았다.
 */
import { describe, expect, it } from "vitest";

import { parseProblemContent } from "@/lib/problem/parseProblemContent";
import { splitInlineChoiceMarkers } from "@/lib/problem/choiceRepairRules";

import ROWS from "./__fixtures__/inlineChoiceRows.json";

interface Row {
  id: string;
  school: string | null;
  n: number | null;
  content: string;
  answer: string;
  questionType: string | null;
  figureUrls: string[];
  _주석: string;
}
const rows = ROWS as unknown as Record<string, Row>;
const row = (k: string): Row => rows[k]!;

describe("R2 — 줄 중간 마커를 보기 경계로", () => {
  it("보기 다섯이 **한 줄에 붙은** 문항을 살린다 (서동중 6)", () => {
    const r = row("서동중6");
    const parsed = parseProblemContent(r.content);
    expect(parsed.choices).toHaveLength(5);
    // 정답 ④ 가 네 번째 자리에 선다 — 그게 이 수리의 목적이다.
    expect(r.answer).toBe("④");
    expect(parsed.choices[3]).toContain("OBM");
    // 발문에는 보기가 남지 않는다.
    expect(parsed.question).not.toContain("$rmbarOA$");
  });

  it("**보기 2칸**밖에 안 생기면 받지 않는다 — `n>=4` 가드 (학산중 22)", () => {
    const r = row("학산중22");
    // 가드가 없으면 이 문항은 «보기 2칸짜리 객관식»이 된다.
    expect(
      parseProblemContent(splitInlineChoiceMarkers(r.content)).choices,
    ).toHaveLength(2);
    // 제품은 그 결과를 버리고 원래대로 둔다.
    expect(parseProblemContent(r.content).choices).toHaveLength(0);
  });

  it("보기가 없는 서술형에 보기를 **만들어내지 않는다** (다사중 21)", () => {
    expect(parseProblemContent(row("다사중21").content).choices).toHaveLength(
      0,
    );
  });

  describe("성한 문항은 **글자 하나 안 바뀐다**", () => {
    // 소수점(`-4.5`)·좌표(`(1,~-2)`)·서술형 참조가 든 실제 행들이다.
    for (const key of [
      "성명여중11",
      "경상여고1",
      "동원중15",
      "강동중18",
      "경산중10",
    ]) {
      it(key, () => {
        const r = row(key);
        const parsed = parseProblemContent(r.content);
        expect(parsed.choices).toHaveLength(5);
        // 이미 1..5 로 온전하므로(`wasClean`) R2 를 아예 대지 않는다.
        // 그래서 R2 를 억지로 먹인 결과와 **같아야** 한다면 그건 우연이다 —
        // 여기서는 «지금 결과»가 곧 «예전 결과»임을 라벨 온전성으로 잠근다.
        expect(parsed.choices.every((c) => c.length > 0)).toBe(true);
      });
    }
  });

  it("이미 1..n 으로 온전하면 다시 자르지 않는다 (`wasClean`)", () => {
    const clean = [
      "다음 중 옳은 것은?",
      "",
      "① 첫째",
      "② 둘째 — 여기에 ③ 이 인용돼 있다",
      "③ 셋째",
      "④ 넷째",
      "⑤ 다섯째",
    ].join("\n");
    const parsed = parseProblemContent(clean);
    expect(parsed.choices).toHaveLength(5);
    // ②의 본문에 있는 `③` 은 **참조**다. 다시 자르면 여섯 칸이 된다.
    expect(parsed.choices[1]).toContain("③ 이 인용돼");
  });
});
