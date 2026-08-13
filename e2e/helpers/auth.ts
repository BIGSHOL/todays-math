import type { Page } from "@playwright/test";

export async function signupViaUi(
  page: Page,
  account: { email: string; password: string; name: string },
) {
  await page.goto("/signup");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호").fill(account.password);
  await page.getByLabel("이름").fill(account.name);
  await page.getByRole("button", { name: "가입", exact: true }).click();
  await page.waitForURL("**/onboarding");
}

export async function loginViaUi(
  page: Page,
  account: { email: string; password: string },
) {
  await page.goto("/login");
  await page.getByLabel("이메일").fill(account.email);
  await page.getByLabel("비밀번호").fill(account.password);
  await page.getByRole("button", { name: "로그인", exact: true }).click();
  await page.waitForURL((url) => url.pathname === "/");
}

export async function completeOnboarding(
  page: Page,
  input: {
    className: string;
    grade: string;
    studentName: string;
    unitLabel: string;
  },
) {
  await page.getByRole("heading", { name: "초기 설정" }).waitFor();
  await page.getByLabel("반 이름").fill(input.className);
  await page.getByLabel("학년").fill(input.grade);
  await page.getByRole("button", { name: "반 만들기" }).click();
  await page.getByText(input.className, { exact: true }).waitFor();

  await page.getByRole("textbox", { name: "이름" }).fill(input.studentName);
  await page.getByRole("button", { name: "추가" }).click();
  await page
    .getByRole("listitem")
    .filter({ hasText: input.studentName })
    .waitFor();

  await page.getByRole("combobox", { name: "소단원" }).selectOption({
    label: input.unitLabel,
  });
  await page.getByRole("button", { name: "완료" }).click();
  await page.waitForURL((url) => url.pathname === "/");
}
