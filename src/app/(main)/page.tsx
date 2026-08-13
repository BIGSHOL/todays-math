import { AppChrome } from "@/components/chrome/AppChrome";

export default function Home() {
  return (
    <AppChrome>
      <main className="p-8">
        <h1 className="text-[15px] font-black">오늘의 테스트</h1>
        <p className="mt-2 text-[12.5px] text-[#6A6A68]">
          메인 화면은 출제 중.
        </p>
      </main>
    </AppChrome>
  );
}
