import { notFound } from "next/navigation";
import { connection } from "next/server";

import {
  ITEMS,
  PRINT_ROUTE,
  SAMPLING_PLAN,
  SPECIMEN_ITEM_IDS,
  SPECIMEN_ROUTE,
} from "./items";
import { PrintCheckList } from "./PrintCheckList";

/**
 * 실물 프린터 출력 검수 대기 목록 (내부 화면).
 *
 * CLAUDE.md 절대 규칙 6 — 「인쇄 관련 변경은 실물 프린터 출력 검수까지가 완료 조건」.
 * 그 미결 잔고가 여러 문서에 흩어져 있어 무엇이 밀려 있는지 한눈에 안 보였다.
 * 이 화면은 그 잔고를 한 장에 모은다. 목록의 SSOT 는 `items.ts` 다.
 *
 * 다른 `/dev` 화면과 같은 가드를 쓴다 — 프로덕션에서는 기본으로 없다.
 *
 * ⚠️ **`force-static` 을 쓰면 안 된다.** 그러면 빌드 시점에 한 번 판정한 뒤 HTML 이
 * 구워져, 나중에 `ENABLE_RENDER_QA` 를 꺼도 이미 구워진 쪽이 나간다. 적대적 리뷰가
 * 실제 빌드로 확인했다 — 플래그를 켜고 빌드하면 `print-check.html` 50KB 가 만들어지고
 * 15건이 통째로 들어간다. `/dev/` 는 `src/proxy.ts` 에서 인증 없이 열려 있다.
 * `dev/katex` 주석에 같은 사고가 이미 한 번 기록돼 있다.
 * 그래서 형제 화면들처럼 `connection()` 으로 **정적 생성을 옵트아웃**한다.
 */

const MICRO = "text-[10px] font-extrabold tracking-[1.2px]";

export default async function PrintCheckPage() {
  await connection();
  if (
    process.env.NODE_ENV === "production" &&
    process.env.ENABLE_RENDER_QA !== "1"
  ) {
    notFound();
  }

  const waiting = ITEMS.filter((i) => i.status === "대기").length;
  const undecided = ITEMS.filter((i) => i.status === "형태미확정").length;
  const passed = ITEMS.filter((i) => i.status === "통과").length;

  return (
    <main className="mx-auto max-w-[860px] px-6 py-8">
      <header className="mb-6">
        <span className={`${MICRO} text-faint`}>절대 규칙 6</span>
        <h1 className="mt-1 text-[24px] font-black tracking-tight">
          실물 출력 검수 대기
        </h1>
        <p className="mt-2 text-[13px] leading-[1.8] text-text-2">
          인쇄 관련 변경은 실물 프린터 출력 검수까지가 완료 조건이다. 아래는
          아직 종이로 확인되지 않은 변경이다. 검수를 마치면{" "}
          <code className="bg-side px-1 text-[12px]">
            src/app/dev/print-check/items.ts
          </code>{" "}
          의 <code className="bg-side px-1 text-[12px]">status</code> 를{" "}
          <code className="bg-side px-1 text-[12px]">&quot;통과&quot;</code> 로
          바꾼다.
        </p>
      </header>

      <section className="mb-6 flex gap-6 border-t-[3px] border-ink pt-3">
        <div>
          <div className="text-[26px] font-black leading-none tabular-nums text-g-red-text">
            {waiting}
          </div>
          <div className={`mt-1 ${MICRO} text-faint`}>검수 대기</div>
        </div>
        <div>
          <div className="text-[26px] font-black leading-none tabular-nums text-g-yellow-text">
            {undecided}
          </div>
          <div className={`mt-1 ${MICRO} text-faint`}>형태 미확정</div>
        </div>
        <div>
          <div className="text-[26px] font-black leading-none tabular-nums text-g-green">
            {passed}
          </div>
          <div className={`mt-1 ${MICRO} text-faint`}>검수 통과</div>
        </div>
      </section>

      <section className="mb-6 border border-divider bg-surface px-4 py-3">
        <h2 className={`${MICRO} text-ink`}>어떻게 뽑나</h2>
        <p className="mt-2 text-[12.5px] leading-[1.75] text-text-2">
          전부 <code className="bg-side px-1">{PRINT_ROUTE}</code> 한 화면에서
          나온다. 출제한 시험지를 열고 인쇄하면 된다.
        </p>
        <p className="mt-2 border-l-[3px] border-ink pl-3 text-[12.5px] leading-[1.75] text-ink">
          다만 <strong>그림 관련 {SPECIMEN_ITEM_IDS.length}건</strong>(
          {SPECIMEN_ITEM_IDS.join(" · ")})은 한 시험지에 다 안 나온다 — 서로
          다른 문항이라 몇 장을 뽑아도 같이 찍힐 보장이 없다. 그 넷은{" "}
          <a className="underline" href={SPECIMEN_ROUTE}>
            <code className="bg-side px-1">{SPECIMEN_ROUTE}</code>
          </a>{" "}
          견본지에서 한 번에 판정한다. 첫 장의 100mm 자가 인쇄 배율을 지킨다.
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {SAMPLING_PLAN.map((line) => (
            <li
              key={line}
              className="border-l-[3px] border-divider pl-3 text-[12.5px] leading-[1.75] text-ink"
            >
              {line}
            </li>
          ))}
        </ul>
      </section>

      <PrintCheckList items={ITEMS} />

      <p className="mt-6 border-t border-divider pt-3 text-[11.5px] leading-[1.7] text-faint">
        「종이에서 볼 것」에 <b>(제안)</b> 이 붙은 것은 근거 문서에 판정 기준이
        적혀 있지 않아 이 화면이 제안하는 것이다. 남이 쓴 것과 지어낸 것을 섞지
        않는다.
      </p>
    </main>
  );
}
