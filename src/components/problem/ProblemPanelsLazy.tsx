"use client";

import dynamic from "next/dynamic";

/**
 * 등록·생성·변형 패널을 **지연 청크로 떼어 낸다** (성능 수리 C-2).
 *
 * 세 패널은 `panel === null` 이 기본 상태라 문제은행 첫 화면에 하나도 그려지지
 * 않는데 전부 첫 로드에 실리고 있었다. 효과는 크지 않다(−3.5KB, 초기 요청 1개
 * 감소) — 카드(−398KB)와 달리 이건 덤이다.
 *
 * 다만 **누를 때 느려지면 안 된다**(D-07). 버튼을 누른 뒤에야 내려받으면 패널이
 * 늦게 뜨는데, 그건 3.5KB 와 바꿀 것이 아니다. 그래서 카드와 같이 하이드레이션
 * 직후 미리 받아 둔다 — 첫 페인트는 막지 않고, 누를 때는 이미 와 있다.
 */
const loadRegisterForm = () =>
  import("@/components/problem/ProblemRegisterForm").then((mod) => ({
    default: mod.ProblemRegisterForm,
  }));
const loadGenerateForm = () =>
  import("@/components/problem/ProblemGenerateForm").then((mod) => ({
    default: mod.ProblemGenerateForm,
  }));
const loadTransformForm = () =>
  import("@/components/problem/ProblemTransformForm").then((mod) => ({
    default: mod.ProblemTransformForm,
  }));

if (typeof window !== "undefined") {
  void loadRegisterForm();
  void loadGenerateForm();
  void loadTransformForm();
}

export const ProblemRegisterForm = dynamic(loadRegisterForm, {
  ssr: false,
  loading: () => null,
});

export const ProblemGenerateForm = dynamic(loadGenerateForm, {
  ssr: false,
  loading: () => null,
});

export const ProblemTransformForm = dynamic(loadTransformForm, {
  ssr: false,
  loading: () => null,
});
