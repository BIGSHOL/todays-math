import Link from "next/link";

import { formatMastheadDate } from "@/lib/main/pipeline";

type AppChromeProps = {
  children: React.ReactNode;
  dateLabel?: string;
  remaining?: number;
  extraNav?: React.ReactNode;
};

export function AppChrome({
  children,
  dateLabel,
  remaining,
  extraNav,
}: AppChromeProps) {
  const date = dateLabel ?? formatMastheadDate();

  return (
    <div className="min-h-full bg-[#ECECEA] text-[#161616]">
      <header className="flex items-baseline gap-6 border-b-[3px] border-[#161616] px-[26px] pt-[19px] pb-[15px]">
        <Link href="/" className="text-[28.5px] font-black tracking-[-0.5px]">
          오늘의수학
        </Link>
        <span className="text-[16.5px] text-[#6A6A68] tabular-nums">
          {date}
        </span>
        {remaining !== undefined ? (
          <span
            className={`text-[17.25px] font-black ${
              remaining > 0 ? "text-[#C5221F]" : "text-[#161616]"
            }`}
          >
            {remaining > 0 ? `남은 작업 ${remaining}` : "오늘 완료"}
          </span>
        ) : null}
        <nav className="ml-auto flex items-center gap-5 text-[17.25px] font-bold">
          {extraNav}
          <Link href="/">메인</Link>
          <Link href="/classes">반</Link>
          <Link href="/problems">문제은행</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
