import Link from "next/link";

import { primaryAction, type ClassRow } from "@/lib/main/pipeline";

const BTN =
  "inline-block w-[112px] border-2 py-2 text-center text-[12.5px] font-black tracking-[1px]";

type Props = {
  row: ClassRow;
  onProgress?: (classId: string) => void;
};

export function ActionControl({ row, onProgress }: Props) {
  const action = primaryAction(row);
  const filled =
    action.label === "검수" ||
    action.label === "인쇄" ||
    action.label === "다시 보기";
  const className = `${BTN} ${
    filled
      ? "border-g-blue bg-g-blue text-white"
      : "border-ink bg-transparent text-ink"
  }`;

  if (action.href) {
    return (
      <Link href={action.href} className={className}>
        {action.label}
      </Link>
    );
  }

  return (
    <button
      type="button"
      className={className}
      onClick={() => onProgress?.(row.classId)}
    >
      {action.label}
    </button>
  );
}
