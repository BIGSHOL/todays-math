import type { Metadata } from "next";
// sumaek: KaTeX CSS 는 루트에서 한 번만. 일부 라우트만 로드하면 MathML 이 이중으로 보인다.
import "katex/dist/katex.min.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "오늘의수학",
  description: "진도 기반 수학 시험지 자동 출제",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="flex min-h-full flex-col">{children}</body>
    </html>
  );
}
