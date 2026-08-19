/**
 * 「이 원본은 **그림이 있어야 풀리는 문항인가**」를 판정하는 단 하나의 규칙.
 *
 * 변형은 본문 글자만 AI 에게 주고 새 본문을 받는다. **원본 그림은 따라오지 않는다.**
 * 그래서 그림에 기대는 문항을 그냥 변형하면 「본문은 그림을 가리키는데 그림이 없는」
 * 문항이 새로 태어난다 — 이 저장소가 856건 잠그며 정리한 부류다(16-figure-recovery-ledger).
 *
 * 실측(공유 DB, 2026-08-19): 출제 가능 46,681건 중 그림 있음 9,419건(20.2%),
 * 그중 본문이 그림을 지목하는 것 5,929건.
 *
 * ## 이 판정이 하는 일과 하지 않는 일
 *
 * 참이면 **변형을 막는 것이 아니라 도형을 요구한다** (원장님 지시 2026-08-19
 * "도형 변형이 필요한 부분은 svg 엔진을 이용해 도형도 새로 만들 것").
 * 프롬프트가 `figureSpec` 을 함께 받아 오고, 서버가 엔진으로 그려 본 뒤
 * **그려진 후보만** 채택할 수 있게 한다(`src/lib/figure/renderFigureSpec.ts`).
 * 못 그린 후보는 사유와 함께 「채택 불가」로 남는다 — 스캔 사진·그래프처럼 벡터로
 * 되살릴 수 없는 것이 여기 남는다(원장님: 그림 쪽은 쓸 수 있는 AI 를 나중에 정한다).
 *
 * 세는 쪽(`scripts/qa/report-missing-figures.ts`)·잠그는 쪽
 * (`scripts/qa/apply-missing-figure-lock.ts`)과 **같은 `classifyFigureNeed`** 를 쓴다.
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
 * 이 원본이 그림에 기대는 문항인가.
 *
 * 두 갈래 중 하나라도 걸리면 참이다.
 *   ㉠ **원본에 그림이 붙어 있다** — 변형본은 그것을 잃는다. 본문이 그림을 말로 가리키지
 *      않더라도, 그림이 붙어 있었다는 것 자체가 필요했다는 뜻이다. (실측 9,419건 전부 이쪽)
 *   ㉡ **본문이 그림을 지목한다**(`classifyFigureNeed` = 유실) — 원본에 그림이 없어도
 *      참이다. 그런 원본은 이미 깨진 문항이라 변형해도 깨진 것이 하나 더 는다.
 *      (오늘은 0건이다 — 이미 잠긴 856건이 출제 풀에서 빠져서다. 새로 들어올 데이터용 가드다.)
 */
export function originNeedsFigure(origin: FigureBlockOrigin): boolean {
  const hasFigure =
    origin.figureUrls.length > 0 ||
    (origin.figureSvg !== null && origin.figureSvg !== "");
  return hasFigure || classifyFigureNeed(origin.content) === "유실";
}

/** 도형이 필요한데 못 그렸을 때 화면에 보일 사유 — 문구를 두 곳에서 짓지 않는다. */
export const FIGURE_MISSING_REASON =
  "이 문항은 그림이 있어야 풀립니다 — 변형본의 도형을 만들지 못했습니다.";
