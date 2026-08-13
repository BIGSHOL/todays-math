import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "ink" | "secondary" | "ghost";

const VARIANT_CLASS: Record<Variant, string> = {
  primary: "bg-[#1A73E8] text-white hover:bg-[#1558b0] disabled:opacity-40",
  ink: "bg-[#161616] text-white hover:bg-black disabled:opacity-40",
  secondary:
    "border border-[#C2C2C0] bg-transparent text-[#161616] hover:bg-white disabled:opacity-40",
  ghost:
    "bg-transparent text-[#161616] underline-offset-2 hover:underline disabled:opacity-40",
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
      className={`inline-flex min-h-11 min-w-[44px] items-center justify-center px-3 text-[12.5px] font-bold focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1A73E8] ${VARIANT_CLASS[variant]} ${className}`}
      {...props}
    />
  );
}
