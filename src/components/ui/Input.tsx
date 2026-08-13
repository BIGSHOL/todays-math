import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 w-full border border-[#C2C2C0] bg-white px-3 text-[12.5px] text-[#161616] placeholder:text-[#8A8A88] focus:border-[#1A73E8] focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-[#1A73E8] disabled:bg-[#E0E0DE] ${className}`}
      {...props}
    />
  );
}
