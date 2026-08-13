import type { InputHTMLAttributes } from "react";

import { Input } from "@/components/ui/Input";

type AuthFieldProps = InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
};

export function AuthField({
  label,
  error,
  id,
  className = "",
  ...props
}: AuthFieldProps) {
  const errorId = error && id ? `${id}-error` : undefined;

  return (
    <div>
      <label
        htmlFor={id}
        className="mb-1 block text-[10.5px] font-bold tracking-[1.2px] text-[#6A6A68]"
      >
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={error ? `border-[#EA4335] ${className}` : className}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-[11.5px] text-[#C5221F]">
          {error}
        </p>
      ) : null}
    </div>
  );
}
