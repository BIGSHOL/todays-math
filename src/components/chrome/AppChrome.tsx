import Link from "next/link";

type AppChromeProps = {
  children: React.ReactNode;
  dateLabel?: string;
};

export function AppChrome({ children, dateLabel }: AppChromeProps) {
  const date =
    dateLabel ??
    new Intl.DateTimeFormat("ko-KR", {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      weekday: "short",
    }).format(new Date());

  return (
    <div className="min-h-full bg-[#ECECEA] text-[#161616]">
      <header className="flex items-baseline gap-4 border-b-[3px] border-[#161616] px-[26px] pt-[13px] pb-[10px]">
        <Link href="/" className="text-[19px] font-black tracking-[-0.5px]">
          오늘의수학
        </Link>
        <span className="text-[11px] text-[#6A6A68] tabular-nums">{date}</span>
        <nav className="ml-auto flex gap-[18px] text-[11.5px] font-bold">
          <Link href="/">메인</Link>
          <Link href="/classes">반</Link>
          <Link href="/problems">문제은행</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
