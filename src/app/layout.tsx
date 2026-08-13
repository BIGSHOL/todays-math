import type { Metadata } from "next";
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
