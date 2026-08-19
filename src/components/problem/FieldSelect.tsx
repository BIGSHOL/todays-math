import { Children, isValidElement, type ReactNode } from "react";
import type { InputHTMLAttributes, SelectHTMLAttributes } from "react";

/**
 * 필터 칸 폭 — **고정**이다 (2026-08-17 원장님 "필터 선택할때마다 크기 제각각인데
 * 고정된 크기에서 선택만 바뀌도록").
 *
 * 종전에는 `min-w-[148px]` 로 **하한만** 있고 상한이 없어, 네이티브 select 가
 * 가장 긴 option 만큼 벌어졌다 — 실측(1440px 창) 학년 148px vs 소단원 466px.
 * 선택을 바꾸면 자리가 흔들렸다.
 *
 * 12rem(192px)인 근거: 내용폭 = 192 − 좌우 패딩 24 − 화살표 ≈ 152px → 12.5px 글자
 * 기준 한글 약 12자. 실제 소단원 725종을 앞에서 잘라 본 결과 서로 구분되지 않는 항목은
 * 앞 10자 50건 → **앞 12자 12건** → 앞 18자 0건이다. 0건까지 가려면 265px 이 필요한데,
 * 원장님이 "드랍다운 버튼은 그대로 두고 드랍다운 목록을 키우는걸로"라고 방향을 잡아
 * **닫힌 폭은 좁게 두고** 나머지 12건은 (1) 펼친 목록 (2) `title` 툴팁으로 받는다.
 * Chrome 은 네이티브 팝업을 컨트롤보다 넓게 그린다 — 148px 컨트롤에서 362px 팝업으로
 * 41자 단원명까지 온전히 나온다(실측, 보고서 §5).
 */
export const FIELD_SELECT_WIDTH = "12rem";

const SELECT_CLASS =
  "h-11 w-full cursor-pointer overflow-hidden text-ellipsis whitespace-nowrap border border-control bg-white px-3 text-[12.5px] font-normal text-ink focus:border-g-blue focus:outline focus:outline-2 focus:outline-g-blue disabled:cursor-not-allowed";

type FieldSelectProps = SelectHTMLAttributes<HTMLSelectElement> & {
  label: string;
};

/**
 * 고른 option 의 글자를 찾아 `title` 로 돌려준다 — 닫힌 칸에서 말줄임된 값을
 * 마우스만 올려도 끝까지 읽을 수 있게 (잘려서 무엇을 골랐는지 모르면 실패다).
 * 제어되지 않는 select(값을 안 넘기는 경우)는 알 수 없으므로 붙이지 않는다.
 */
function selectedOptionText(
  children: ReactNode,
  value: SelectHTMLAttributes<HTMLSelectElement>["value"],
): string | undefined {
  if (typeof value !== "string") return undefined;

  let found: string | undefined;
  Children.forEach(children, (child) => {
    if (found !== undefined || !isValidElement(child)) return;
    const props = child.props as { value?: string; children?: ReactNode };
    if (props.value === value && typeof props.children === "string") {
      found = props.children;
    }
  });
  return found;
}

export function FieldSelect({
  label,
  className = "",
  children,
  ...props
}: FieldSelectProps) {
  const title = selectedOptionText(children, props.value);

  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10.5px] font-black tracking-[1.5px] text-text-2">
      {label}
      <select
        className={`${SELECT_CLASS} ${className}`}
        title={title}
        {...props}
      >
        {children}
      </select>
    </label>
  );
}

/**
 * 필터 줄의 **글자 입력칸** — `FieldSelect` 와 같은 제목·높이·테두리를 쓴다.
 *
 * ⚠️ 줄맞춤은 «같은 클래스»가 아니라 **같은 구조**에서 나온다. 제목이 `<label>` 의
 * 첫 줄로 서고 그 아래 `h-11` 상자가 오는 흐름을 그대로 지켜야 다른 칸과 밑선이 맞는다.
 */
export function FieldText({
  label,
  className = "",
  ...props
}: InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="flex min-w-0 flex-col gap-1 text-[10.5px] font-black tracking-[1.5px] text-text-2">
      {label}
      <input
        className={`h-11 w-full border border-control bg-white px-3 text-[12.5px] font-normal text-ink focus:border-g-blue focus:outline focus:outline-2 focus:outline-g-blue ${className}`}
        type="search"
        {...props}
      />
    </label>
  );
}
