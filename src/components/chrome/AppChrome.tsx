import Link from "next/link";

import { formatMastheadDate } from "@/lib/main/pipeline";

/**
 * 상단 크롬 — **워드마크 분기** (D-39 확정).
 *
 * 워드마크 자리에 두 제품명을 나란히 둔다: `오늘의수학 │ 오늘의시험`.
 * 선택된 쪽은 검정 굵게 + `aria-current="page"`, 나머지는 회색이다.
 * 날짜·남은 작업·nav 는 **두 탭이 공유**한다(05 §8.7).
 *
 * ⚠️ 두 제품명 모두 링크로 둔다. 선택된 쪽도 링크인 이유:
 *   - 워드마크는 예부터 홈으로 가는 길이라 없애면 오히려 어포던스가 준다.
 *   - "여기 있음"은 색이 아니라 `aria-current` 로 알린다(색만으로 전달 금지, 05 §5).
 *   자기 자신으로 가는 링크는 실제로 이동하므로 D-30 이 막는 "눌러도 아무 일 없음"이 아니다.
 *
 * ⚠️ nav 에 '오늘의 시험' 항목을 넣지 않는다 — D-39 가 "nav 항목 추가"안을 무게감이
 *    약하다는 이유로 반려했다. 분기는 워드마크 자리에서만 일어난다.
 */
type Tab = "math" | "exam";

type AppChromeProps = {
  children: React.ReactNode;
  dateLabel?: string;
  remaining?: number;
  extraNav?: React.ReactNode;
  /** 현재 열려 있는 제품 탭. 기본은 '오늘의 수학'. */
  tab?: Tab;
};

const WORDMARK = "text-[28.5px] font-black tracking-[-0.5px]";

export function AppChrome({
  children,
  dateLabel,
  remaining,
  extraNav,
  tab = "math",
}: AppChromeProps) {
  const date = dateLabel ?? formatMastheadDate();

  return (
    <div className="min-h-full bg-canvas text-ink">
      <header className="flex items-baseline gap-6 border-b-[3px] border-ink px-[26px] pt-[19px] pb-[15px]">
        <span className="flex items-baseline">
          <Link
            href="/"
            aria-current={tab === "math" ? "page" : undefined}
            className={`${WORDMARK} ${tab === "math" ? "text-ink" : "text-text-3"}`}
          >
            오늘의수학
          </Link>
          <span
            aria-hidden="true"
            className="mx-[7px] text-[28.5px] text-[#C2C2C0]"
          >
            │
          </span>
          <Link
            href="/exam"
            aria-current={tab === "exam" ? "page" : undefined}
            className={`${WORDMARK} ${tab === "exam" ? "text-ink" : "text-text-3"}`}
          >
            오늘의시험
          </Link>
        </span>
        <span className="text-[16.5px] text-text-2 tabular-nums">{date}</span>
        {remaining !== undefined ? (
          <span
            className={`text-[17.25px] font-black ${
              remaining > 0 ? "text-g-red-text" : "text-ink"
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
