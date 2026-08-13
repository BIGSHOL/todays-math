export default function AuthLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <div className="flex min-h-full flex-col bg-[#ECECEA] text-[#161616]">
      <header className="border-b-[3px] border-[#161616] px-[26px] pt-[13px] pb-[10px]">
        <p className="text-[19px] font-black tracking-[-0.5px]">오늘의수학</p>
      </header>
      <div className="flex flex-1 items-start justify-center px-6 py-16">
        {children}
      </div>
    </div>
  );
}
