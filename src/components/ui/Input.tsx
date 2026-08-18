import type { InputHTMLAttributes } from "react";

export function Input({
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={`h-11 w-full border border-control bg-white px-3 text-[12.5px] text-ink placeholder:text-text-3 focus:border-g-blue focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-g-blue disabled:cursor-not-allowed disabled:bg-[#E0E0DE] ${className}`}
      {...props}
    />
  );
}
