/**
 * 스크롤 상자 안에서 **한 항목을 보이게 하려면 얼마나 굴려야 하나** — 순수 함수.
 *
 * 🔴 `Element.scrollIntoView({block:"nearest"})` 를 쓰면 안 된다. 사양상 그것은
 *    **스크롤 가능한 조상 전부**를 굴린다 — 열(overflow-y:auto)만이 아니라 **문서도**
 *    굴린다. 펼침 패널이 화면 아래에 걸쳐 있으면 페이지가 통째로 튄다. 그건 원장님이
 *    처음 지적하신 「스크롤이 너무 강제된다」 바로 그 증상이라, 고치려던 것을 다시
 *    부르는 꼴이 된다(적대적 리뷰 2026-08-19).
 *
 * 그래서 **열 상자만** 굴린다. 이 함수는 그 굴림량만 계산한다 — DOM 을 안 만진다.
 */
export interface RevealBox {
  /** 스크롤 상자의 화면 위 좌표와 높이. */
  containerTop: number;
  containerHeight: number;
  /** 보이게 하려는 항목의 화면 위 좌표와 높이. */
  nodeTop: number;
  nodeHeight: number;
}

/**
 * 더할 `scrollTop` 값. 이미 다 보이면 **0**(= 아무것도 안 한다).
 * 안 보이면 상자 가운데로 가져온다 — 위아래 맥락이 함께 보여야 「어디쯤인지」가 읽힌다.
 *
 * 항목이 상자보다 크면 가운데 정렬이 **머리를 자른다.** 그때는 위를 맞춘다 —
 * 잘릴 수밖에 없다면 시작이 보이는 쪽이 낫다.
 */
export function scrollDeltaToReveal({
  containerTop,
  containerHeight,
  nodeTop,
  nodeHeight,
}: RevealBox): number {
  const containerBottom = containerTop + containerHeight;
  const nodeBottom = nodeTop + nodeHeight;
  if (nodeTop >= containerTop && nodeBottom <= containerBottom) return 0;
  if (nodeHeight >= containerHeight) return Math.round(nodeTop - containerTop);
  return Math.round(
    nodeTop - containerTop - (containerHeight - nodeHeight) / 2,
  );
}
