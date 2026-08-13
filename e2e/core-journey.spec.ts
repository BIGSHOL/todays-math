import { expect, test } from "@playwright/test";

import {
  E2E_ACCOUNTS,
  E2E_NEXT_SECTION,
  E2E_TARGET_GRADE,
  E2E_TARGET_SECTION,
} from "./env";
import { completeOnboarding, loginViaUi, signupViaUi } from "./helpers/auth";
import {
  approvePendingProblems,
  currentClassAndUnit,
  seedApprovedProblemsViaApi,
} from "./helpers/bank";

test.describe.configure({ timeout: 120_000 });

test.describe("T6.1 여정 A — 신규 가입부터 인쇄 미리보기", () => {
  test("가입 → 온보딩 → 출제 → 검수 → 인쇄 미리보기", async ({ page }) => {
    const email = `e2e.signup.${Date.now()}@todaysmath.test`;
    await signupViaUi(page, {
      email,
      password: "password1",
      name: "신규원장",
    });
    await completeOnboarding(page, {
      className: "중2 신규반",
      grade: E2E_TARGET_GRADE,
      studentName: "이학생",
      unitLabel: `${E2E_TARGET_GRADE} · ${E2E_TARGET_SECTION}`,
    });

    await expect(
      page.getByRole("article", { name: "중2 신규반" }),
    ).toBeVisible();
    const { unitId } = await currentClassAndUnit(page.request);
    await seedApprovedProblemsViaApi(page.request, unitId);

    await page.getByRole("link", { name: "출제" }).click();
    await expect(
      page.getByRole("heading", { name: "출제 설정" }),
    ).toBeVisible();
    await page.getByRole("button", { name: "출제" }).click();

    await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/i);
    await expect(page.getByRole("heading", { name: "검수" })).toBeVisible();
    await expect(page.getByRole("article", { name: "문 1" })).toBeVisible();
    await expect(page.getByText("8문항")).toBeVisible();

    await page.getByRole("link", { name: "인쇄" }).click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}\/print$/i);
    await expect(page.getByText("PRINT PREVIEW")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: /일일테스트/ }).first(),
    ).toBeVisible();
    await expect(page.getByText("중2 신규반 · 8문항")).toBeVisible();
  });
});

test.describe("T6.1 여정 B — 일상 루프", () => {
  test("로그인 → 준비된 테스트 → 교체 1회 → 확정 → 인쇄 → 진도 갱신", async ({
    page,
  }) => {
    await page.addInitScript(() => {
      window.print = () => {
        (window as unknown as { __e2ePrinted?: boolean }).__e2ePrinted = true;
      };
    });

    await loginViaUi(page, E2E_ACCOUNTS.daily);
    await expect(
      page.getByRole("article", { name: E2E_ACCOUNTS.daily.className }),
    ).toBeVisible();
    await expect(page.getByText("준비됨")).toBeVisible();

    await page.getByRole("link", { name: "검수" }).click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/i);
    const first = page.getByRole("article", { name: "문 1" });
    await expect(first).toBeVisible();
    const before = (await first.innerText()).trim();

    await first.getByRole("button", { name: "교체" }).click();
    await expect(page.getByText("교체 1")).toBeVisible();
    await expect(first).not.toHaveText(before);

    await page.getByRole("button", { name: "확정" }).click();
    await expect(page.getByRole("button", { name: "확정" })).toBeDisabled();

    await page.getByRole("link", { name: "인쇄" }).click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}\/print$/i);
    await expect(page.getByText("PRINT PREVIEW")).toBeVisible();
    await page.getByRole("button", { name: "인쇄하기" }).click();
    await expect(
      page.getByText("확정된 테스트만 인쇄할 수 있습니다."),
    ).toHaveCount(0);
    await expect
      .poll(async () =>
        page.evaluate(
          () =>
            (window as unknown as { __e2ePrinted?: boolean }).__e2ePrinted ===
            true,
        ),
      )
      .toBe(true);

    await page.goto("/");
    await expect(page.getByLabel("현재 소단원")).toHaveText(E2E_TARGET_SECTION);
    await page.getByRole("button", { name: "다음 차시로" }).click();
    await expect(page.getByLabel("현재 소단원")).toHaveText(E2E_NEXT_SECTION);
  });
});

test.describe("T6.1 여정 C — 문제 부족 후 AI 생성(모킹)", () => {
  test("문제 부족 → AI 생성(모킹) → 출제 완료", async ({ page }) => {
    await loginViaUi(page, E2E_ACCOUNTS.shortfall);
    await page.getByRole("link", { name: "출제" }).click();
    await expect(
      page.getByRole("heading", { name: "출제 설정" }),
    ).toBeVisible();

    await page.getByRole("button", { name: "출제" }).click();
    await expect(
      page.getByRole("alert").filter({ hasText: "문제가 부족합니다" }),
    ).toBeVisible();
    await expect(page.getByText(/가용 2/)).toBeVisible();
    await expect(page.getByText(/필요 8/)).toBeVisible();

    await page.getByRole("button", { name: "AI 생성" }).click();
    await expect(
      page.getByText(/문제은행에서 승격한 뒤 다시 출제하세요/),
    ).toBeVisible();
    await approvePendingProblems(page.request);
    await page.getByRole("button", { name: "출제" }).click();
    await page.waitForURL(/\/tests\/[0-9a-f-]{36}$/i);
    await expect(page.getByRole("heading", { name: "검수" })).toBeVisible();
    await expect(page.getByRole("article", { name: "문 1" })).toBeVisible();
    await expect(page.getByText("8문항")).toBeVisible();
  });
});
