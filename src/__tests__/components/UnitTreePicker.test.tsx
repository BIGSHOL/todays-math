/**
 * 🔴 RED → 🟢 GREEN — Phase 2, T2.3 S-07 UnitTreePicker
 *
 * 구현: src/components/progress/UnitTreePicker.tsx
 * 확정: docs/planning/05-design-system.md §8.6 (3열 + 현재 단원 Blue 하이라이트)
 */
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ComponentProps } from "react";
import { describe, expect, it, vi } from "vitest";

import { UnitTreePicker } from "@/components/progress/UnitTreePicker";
import { unitId } from "@/mocks/data/ids";
import { MOCK_CURRENT_PROGRESS_UNIT, MOCK_UNITS } from "@/mocks/data";

const extraGradeUnit = {
  id: unitId(99),
  grade: "중1",
  chapter: "1. 소인수분해",
  section: "소인수분해",
  orderIndex: 300,
};

function renderPicker(
  overrides?: Partial<ComponentProps<typeof UnitTreePicker>>,
) {
  const onSelect = vi.fn();
  const view = render(
    <UnitTreePicker
      units={MOCK_UNITS}
      currentUnitId={MOCK_CURRENT_PROGRESS_UNIT.id}
      onSelect={onSelect}
      {...overrides}
    />,
  );
  return { onSelect, ...view };
}

describe("[T2.3] UnitTreePicker", () => {
  it("학년 · 대단원 · 소단원 3열을 보여 준다", () => {
    renderPicker();

    expect(screen.getByRole("heading", { name: "학년" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "대단원" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "소단원" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "중2" })).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "1. 수와 식" }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", {
        name: MOCK_CURRENT_PROGRESS_UNIT.section,
      }),
    ).toBeInTheDocument();
  });

  it("현재 단원의 학년·대단원·소단원을 Blue로 하이라이트한다", () => {
    renderPicker();

    const grade = screen.getByRole("button", { name: "중2" });
    const chapter = screen.getByRole("button", { name: "1. 수와 식" });
    const section = screen.getByRole("button", {
      name: MOCK_CURRENT_PROGRESS_UNIT.section,
    });

    expect(grade).toHaveAttribute("aria-current", "true");
    expect(chapter).toHaveAttribute("aria-current", "true");
    expect(section).toHaveAttribute("aria-current", "true");
    expect(grade).toHaveClass("bg-[#1A73E8]");
    expect(chapter).toHaveClass("bg-[#1A73E8]");
    expect(section).toHaveClass("bg-[#1A73E8]");
  });

  it("학년을 고르면 해당 학년의 대단원만 보여 준다", async () => {
    const user = userEvent.setup();
    renderPicker({ units: [...MOCK_UNITS, extraGradeUnit] });

    await user.click(screen.getByRole("button", { name: "중1" }));

    expect(
      screen.getByRole("button", { name: "1. 소인수분해" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "1. 수와 식" }),
    ).not.toBeInTheDocument();
  });

  it("대단원을 고르면 해당 대단원의 소단원만 보여 준다", async () => {
    const user = userEvent.setup();
    renderPicker();

    await user.click(screen.getByRole("button", { name: "2. 부등식" }));

    expect(screen.getByRole("button", { name: "부등식" })).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "순환소수" }),
    ).not.toBeInTheDocument();
  });

  it("소단원을 누르면 onSelect(unitId)를 호출한다", async () => {
    const user = userEvent.setup();
    const { onSelect } = renderPicker();

    await user.click(screen.getByRole("button", { name: "순환소수" }));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith(MOCK_UNITS[1]!.id);
  });
});
