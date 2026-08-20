/**
 * 발문에 남은 **`[그림]` 자국**을 지면에서 가린다 — 조판과 자가 **같은 함수**를 쓴다.
 *
 * ## 무엇이 문제인가
 *
 * 원장님이 시험지에서 찾아 주셨다(2026-08-20). 그림이 **붙어 있는데도** 발문 끝에
 * `[그림]` 이라는 글자가 같이 인쇄된다 — 실측 **3,951건**(출제 가능의 8.6%).
 * 그림은 바로 아래 그려지므로 그 글자는 순전한 군더더기다.
 *
 * ## 🔴 보기 쪽 `[그림]` 은 **지우면 안 된다**
 *
 * `① [그림] ② [그림]` 은 「어느 그림이 ①인지 모른다」를 **솔직히 보여 주는** 표시다.
 * 지우면 못 푸는 문항이 멀쩡해 보이고, 학생은 아무거나 고른다
 * (`choiceFigureIndex.ts` 가 같은 이유로 「모르면 오늘 그대로」를 고른다).
 * 그래서 이 함수는 **발문만** 손댄다. 실측으로도 보기에만 있는 것은 0건이다.
 *
 * ## 🔴 그림이 없으면 지우지 않는다
 *
 * 그림이 없는데 `[그림]` 만 남은 문항은 **못 푸는 문항**이다. 그 표시가 유일한
 * 신호이므로 지우면 「멀쩡해 보이는 못 푸는 문항」이 된다 — 2026-08-16 의
 * 「지우면 근거가 사라진다」와 같은 자리다. 그런 문항은 이미 출제에서 빠져 있다.
 *
 * ## 🔴 DB 는 안 건드린다
 *
 * 지우는 것이 아니라 **가리는** 것이다. 본문은 그대로 두므로 판정 규칙
 * (`missingFigureRule`)·회수 도구가 보던 근거가 그대로 남는다.
 *
 * ## 조판과 자가 갈라지면 안 된다
 *
 * 조판이 안 그리는 글자를 자가 세면 높이를 **과대평가**하고, 반대면 **놓친다**.
 * 그래서 `ProblemContent`(모든 렌더 경로)와 `estimateProblemPx`(넘침 자)가
 * 둘 다 이 함수를 부른다 — 한쪽만 고치면 조용히 어긋난다(CLAUDE.md 2026-08-18).
 */

/** 본문에 박히는 자국. `missingFigureRule.CONTAMINATION` 과 같은 글자다. */
export const FIGURE_MARKER = "[그림]";

/**
 * 발문에서 `[그림]` 자국을 걷어낸다. **그림이 있을 때만.**
 *
 * 자국이 홀로 남긴 빈 줄·겹친 공백까지 정리한다 — 안 하면 조판은 빈 줄을
 * 안 그리는데 자는 한 줄로 세어 높이가 갈라진다.
 */
export function hideFigureMarker(question: string, hasFigure: boolean): string {
  if (!hasFigure || !question.includes(FIGURE_MARKER)) return question;
  const NL = String.fromCharCode(10);
  const out: string[] = [];
  for (const line of question.split(NL)) {
    if (!line.includes(FIGURE_MARKER)) {
      out.push(line);
      continue;
    }
    // 자국을 뺀 자리에 남은 겹친 공백을 한 칸으로.
    const stripped = line
      .split(FIGURE_MARKER)
      .join("")
      .replace(/[ \t]{2,}/g, " ")
      .replace(/[ \t]+$/g, "");
    // 🔴 **자국 때문에 빈 줄이 된 것만** 버린다. 원래 빈 줄은 문단을 가르는
    //    구조라 건드리면 안 된다 — 조판이 그걸로 문단을 나눈다.
    if (stripped.trim() !== "") out.push(stripped);
  }
  return out.join(NL).trim();
}
