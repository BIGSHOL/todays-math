import type { SelectHTMLAttributes } from "react";

const SELECT_CLASS =
  "h-11 border border-[#C2C2C0] bg-white px-3 text-[12.5px] font-normal text-[#161616] focus:border-[#1A73E8] focus:outline focus:outline-2 focus:outline-[#1A73E8]";

type FieldSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
};

export function FieldSelect({
  label,
  className = "",
  children,
  ...props
}: FieldSelectProps) {
  return (
    <label className="flex min-w-[148px] flex-col gap-1 text-[10.5px] font-black tracking-[1.5px] text-[#6A6A68]">
      {label}
      <select className={`${SELECT_CLASS} ${className}`} {...props}>
        {children}
      </select>
    </label>
  );
}
