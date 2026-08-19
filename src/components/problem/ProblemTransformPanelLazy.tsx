"use client";

import dynamic from "next/dynamic";

/**
 * 변형 패널을 **지연 청크로 떼어 낸다** — `ProblemCardLazy` / `ProblemPanelsLazy` 와 같은 이유.
 *
 * 패널은 카드마다 하나씩 붙지만 기본 상태가 닫힘이라 첫 화면에 하나도 그려지지 않는다.
 * 그대로 두면 20장 카드 청크에 계약(zod)과 `problemApi` 가 딸려 들어간다.
 *
 * 다만 **누를 때 느려지면 안 된다**(D-07). 하이드레이션 직후 미리 받아 두어 첫 페인트는
 * 막지 않고, 원장님이 「변형」을 누를 때는 이미 와 있게 한다.
 */
const loadTransformPanel = () =>
  import("@/components/problem/ProblemTransformPanel").then((mod) => ({
    default: mod.ProblemTransformPanel,
  }));

if (typeof window !== "undefined") {
  void loadTransformPanel();
}

export const ProblemTransformPanel = dynamic(loadTransformPanel, {
  ssr: false,
  loading: () => null,
});
