import Link from "next/link";

import { formatMastheadDate } from "@/lib/main/pipeline";

/**
 * '오늘의 시험' 크롬 — **워드마크 분기** (D-39 확정).
 *
 * 워드마크 자리에 두 제품명을 나란히 두고, 선택된 쪽만 검정 굵게 / 나머지는 회색이다.
 * 날짜·nav 는 두 탭이 공유한다.
 *
 * ⚠️ 반대 방향('오늘의 수학' → '오늘의 시험')의 분기는 `src/components/chrome/AppChrome.tsx`
 *    에 있어야 하는데 그 파일은 다른 트랙 소유라 이 세션에서 고치지 않았다.
 *    코디네이터 인계 사항이다(REPORT.md).
 */
export function ExamChrome({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-full bg-canvas text-ink">
      <header className="flex items-baseline gap-6 border-b-[3px] border-ink px-[26px] pt-[19px] pb-[15px]">
        <span className="text-[28.5px] font-black tracking-[-0.5px]">
          <Link href="/" className="text-ghost">
            오늘의수학
          </Link>
          <span className="mx-[7px] font-normal text-divider">│</span>
          <span aria-current="page">오늘의시험</span>
        </span>
        <span className="text-[16.5px] text-muted tabular-nums">
          {formatMastheadDate()}
        </span>
        <nav className="ml-auto flex items-center gap-5 text-[17.25px] font-bold">
          <Link href="/">메인</Link>
          <Link href="/classes">반</Link>
          <Link href="/problems">문제은행</Link>
        </nav>
      </header>
      {children}
    </div>
  );
}
