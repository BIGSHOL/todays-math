"use client";

/**
 * 인쇄 단추 하나 — 견본지는 서버 컴포넌트라 여기만 클라이언트다.
 *
 * 모양은 부모가 CSS 모듈 클래스로 준다(견본지와 시험지가 같은 토큰을 쓰게).
 * D-30: 실제로 누르는 컨트롤이므로 `<button>` 이고 손가락 커서가 맞다.
 */
export function PrintButton({ className }: { className?: string }) {
  return (
    <button type="button" className={className} onClick={() => window.print()}>
      인쇄하기
    </button>
  );
}
