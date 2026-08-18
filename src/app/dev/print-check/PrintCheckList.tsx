"use client";

import { useSyncExternalStore } from "react";

import type { PrintCheckItem } from "./items";

/**
 * 검수 진행 메모를 브라우저에 남긴다. **완료 기록이 아니다** — 완료는 `items.ts` 의
 * `status` 를 고쳐 코드에 남긴다. 여기 체크는 종이를 넘기며 「어디까지 봤나」를
 * 잃지 않기 위한 것이다.
 *
 * `useEffect` + `setState` 로 초기값을 읽으면 ESLint `react-hooks/set-state-in-effect`
 * 가 막는다(그리고 서버·클라이언트 첫 그림이 어긋난다). 그래서 저장소 자체를
 * 외부 스토어로 보고 `useSyncExternalStore` 로 읽는다 — 로그인 폼의 수화 가드와 같은 수법.
 */
const KEY = "print-check-v1";
const listeners = new Set<() => void>();

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

/** localStorage 의 문자열을 그대로 돌려준다 — 내용이 같으면 같은 문자열이라 재렌더가 안 돈다. */
function getSnapshot(): string {
  try {
    return window.localStorage.getItem(KEY) ?? "{}";
  } catch {
    return "{}";
  }
}

/** 서버에는 저장소가 없다. 첫 그림은 «아무것도 체크 안 됨» 으로 맞춘다. */
function getServerSnapshot(): string {
  return "{}";
}

function write(next: Record<string, boolean>) {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(next));
  } catch {
    /* 저장이 막혀 있어도 화면은 계속 쓸 수 있어야 한다 */
  }
  listeners.forEach((l) => l());
}

const STATUS_TONE: Record<PrintCheckItem["status"], string> = {
  대기: "text-g-red-text",
  통과: "text-g-green",
  형태미확정: "text-g-yellow-text",
};

const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";

export function PrintCheckList({ items }: { items: PrintCheckItem[] }) {
  const raw = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
  let checked: Record<string, boolean> = {};
  try {
    checked = JSON.parse(raw) as Record<string, boolean>;
  } catch {
    checked = {};
  }

  const done = items.filter((i) => checked[i.id]).length;

  return (
    <>
      <div className="mb-5 flex items-center gap-4 border-y-[3px] border-ink py-2">
        <span className={`${MICRO}`}>진행</span>
        <span className="text-[22px] font-black tabular-nums text-g-blue">
          {done}
          <span className="text-[13px] text-faint"> / {items.length}</span>
        </span>
        <button
          type="button"
          onClick={() => write({})}
          className="ml-auto min-h-11 cursor-pointer px-3 text-[12px] font-bold text-ink underline-offset-2 hover:underline"
        >
          체크 지우기
        </button>
      </div>

      <ol className="flex flex-col gap-3">
        {items.map((item, index) => {
          const isDone = Boolean(checked[item.id]);
          return (
            <li
              key={item.id}
              className={`border border-divider bg-surface px-4 py-3 ${
                isDone
                  ? "border-l-[3px] border-l-g-green"
                  : "border-l-[3px] border-l-ink"
              }`}
            >
              <div className="flex items-start gap-3">
                <label className="flex min-h-11 cursor-pointer items-center gap-2 pt-0.5">
                  <input
                    type="checkbox"
                    checked={isDone}
                    onChange={() => write({ ...checked, [item.id]: !isDone })}
                    className="size-4 cursor-pointer accent-[var(--blue)]"
                  />
                  <span className="sr-only">{item.title} 확인함</span>
                </label>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className={`${MICRO} text-faint tabular-nums`}>
                      {String(index + 1).padStart(2, "0")}
                    </span>
                    <h3
                      className={`text-[14px] font-black ${
                        isDone ? "text-faint line-through" : "text-ink"
                      }`}
                    >
                      {item.title}
                    </h3>
                    <span className={`${MICRO} ${STATUS_TONE[item.status]}`}>
                      {item.status}
                    </span>
                    <span className={`${MICRO} text-faint tabular-nums`}>
                      {item.changedOn}
                    </span>
                    {item.scale ? (
                      <span className={`${MICRO} text-text-2`}>
                        {item.scale}
                      </span>
                    ) : null}
                  </div>

                  <p className="mt-2 text-[12.5px] leading-[1.75] text-text-2">
                    {item.changed}
                  </p>

                  <div className="mt-2 border-l-[3px] border-g-blue bg-side py-2 pl-3">
                    <span className={`${MICRO} text-g-blue`}>
                      종이에서 볼 것{item.lookFromSource ? "" : " (제안)"}
                    </span>
                    <p className="mt-1 text-[12.5px] leading-[1.75] text-ink">
                      {item.look}
                    </p>
                  </div>

                  {item.needs ? (
                    <p className="mt-2 text-[11.5px] leading-[1.7] text-g-yellow-text">
                      표본 조건 — {item.needs}
                    </p>
                  ) : null}

                  <p className="mt-2 text-[11px] leading-[1.7] text-faint">
                    근거 {item.evidence.join(" · ")}
                  </p>
                </div>
              </div>
            </li>
          );
        })}
      </ol>
    </>
  );
}
