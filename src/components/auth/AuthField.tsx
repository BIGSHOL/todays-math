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
        className="mb-1 block text-[10.5px] font-bold tracking-[1.2px] text-text-2"
      >
        {label}
      </label>
      <Input
        id={id}
        aria-invalid={error ? true : undefined}
        aria-describedby={errorId}
        className={error ? `border-g-red ${className}` : className}
        {...props}
      />
      {error ? (
        <p id={errorId} className="mt-1 text-[11.5px] text-g-red-text">
          {error}
        </p>
      ) : null}
    </div>
  );
}
