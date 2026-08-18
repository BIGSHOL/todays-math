import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ink" | "secondary" | "ghost";

/**
 * 비활성은 **opacity 로 흐리지 않는다.** 투명도는 그 버튼의 배경·글자·테두리 대비를
 * 한꺼번에 깎아서 얼마나 읽히는지 계산할 수 없게 만든다(같은 이유로 반 목록 행의
 * `opacity-[0.78]` 도 걷었다, 2026-08-18). 대신 비활성 전용 색을 명시한다 —
 * 면 `--side` 위 글자 `--text-3` 는 3.75:1 로, 「눌리지 않는다」는 보이되 읽히기는 한다.
 *
 * 면이 없는 변형(ghost)은 비활성이어도 면을 만들지 않는다 — 없던 사각형이 생기면
 * 오히려 눌러도 되는 것처럼 보인다.
 */
const DISABLED_FILLED = "disabled:bg-side disabled:text-text-3";
const DISABLED_FLAT = "disabled:text-text-3";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: `bg-g-blue text-white hover:enabled:bg-[#18497f] ${DISABLED_FILLED}`,
  ink: `bg-ink text-white hover:enabled:bg-black ${DISABLED_FILLED}`,
  secondary: `border border-control bg-transparent text-ink hover:enabled:bg-side ${DISABLED_FILLED} disabled:border-divider`,
  ghost: `bg-transparent text-ink underline-offset-2 hover:enabled:underline ${DISABLED_FLAT}`,
};

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant }) {
  return (
    <button
      type={type}
      className={`inline-flex min-h-11 min-w-[44px] shrink-0 cursor-pointer items-center justify-center whitespace-nowrap px-3 text-[12.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-g-blue disabled:cursor-not-allowed ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
