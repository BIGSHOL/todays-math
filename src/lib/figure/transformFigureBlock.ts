/**
 * 「이 원본은 변형해도 **쓸 수 없는 문항**이 나온다」를 판정하는 단 하나의 규칙.
 *
 * 변형은 본문 글자만 AI 에게 주고 새 본문을 받는다. 그림은 따라오지 않는다 —
 * `POST /api/problems/transform/adopt` 는 `figureUrls`/`figureSvg` 를 만들지 않는다.
 * 그래서 그림에 기대는 문항을 변형하면 **본문은 그림을 가리키는데 그림이 없는** 문항이
 * 새로 태어난다. 이 저장소가 856건 잠그며 정리한 바로 그 부류다(16-figure-recovery-ledger).
 *
 * 실측(공유 DB, 2026-08-19): 출제 가능 46,681건 중 그림 있음 9,419건,
 * 그중 본문이 그림을 지목하는 것 5,929건. 막지 않으면 이 5,929건이 전부 통로다.
 *
 * ⚠️ **임시 조치다.** 원장님 방침(2026-08-19)은 「도형은 SVG 엔진으로 새로 만들고,
 * 스캔 그림은 쓸 수 있는 AI 를 나중에 정한다」이다. 도형 생성이 붙으면 이 판정은
 * 「엔진이 못 그리는 것만」으로 좁아진다. 지금은 전부 막는다.
 *
 * 세는 쪽(`scripts/qa/report-missing-figures.ts`)과 같은 `classifyFigureNeed` 를 쓴다 —
 * 목록을 두 벌로 두면 세는 쪽과 막는 쪽이 같이 눈이 먼다.
 */
import { classifyFigureNeed } from "./missingFigureRule";

/** 판정에 필요한 원본의 최소 형태. */
export interface FigureBlockOrigin {
  content: string;
  figureUrls: string[];
  figureSvg: string | null;
}

/**
 * 막아야 하면 **사유 문구**를, 괜찮으면 `null` 을 돌려준다.
 * 문구는 그대로 화면에 나가므로 원장님이 읽고 판단할 수 있게 쓴다.
 *
 * 두 갈래로 막는다. 어느 하나라도 걸리면 막는다.
 *   ㉠ **원본에 그림이 붙어 있다** — 변형본은 그것을 잃는다. 본문이 그림을 말로 가리키지
 *      않더라도 그림이 붙어 있었다는 것 자체가 필요했다는 뜻이다.
 *   ㉡ **본문이 그림을 지목한다**(`classifyFigureNeed` = 유실) — 원본에 그림이 없어도
 *      막는다. 그런 원본은 이미 깨진 문항이라(그 856건) 변형해도 깨진 것이 하나 더 는다.
 */
export function transformFigureBlockReason(
  origin: FigureBlockOrigin,
): string | null {
  const hasFigure =
    origin.figureUrls.length > 0 ||
    (origin.figureSvg !== null && origin.figureSvg !== "");
  if (hasFigure) {
    return "원본에 그림이 붙어 있습니다 — 변형본에는 그 그림이 따라가지 않아 못 푸는 문항이 됩니다. 도형을 새로 그릴 수 있게 되면 열립니다.";
  }
  if (classifyFigureNeed(origin.content) === "유실") {
    return "본문이 그림을 가리키는데 원본에 그림이 없습니다 — 변형해도 못 푸는 문항입니다.";
  }
  return null;
}
