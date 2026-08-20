import type { PickResult } from "./pickPaperProblems";

/**
 * 자리별 채움 현황 — **못 채운 자리를 먼저 보여 준다.**
 *
 * 못 채운 자리는 「이 시험지로는 그 항목을 검수할 수 없다」는 뜻이다. 조용히
 * 넘기면 뽑아 놓고 검수한 척 남는다 — 이 저장소가 여러 번 적은 「분모를 먼저
 * 세어 찍어라」와 같은 자리고, 여기서 분모는 **검수 항목**이다.
 *
 * 인쇄에서는 사라진다(`print:hidden`) — 종이에 나갈 것은 시험지뿐이다.
 */
export function SlotReport({
  filled,
  padding,
  total,
  picked,
  pool,
  slots,
}: {
  filled: PickResult["filled"];
  padding: number;
  total: number;
  picked: number;
  pool: number;
  slots: number;
}) {
  const missing = filled.filter((f) => f.got < f.want);
  return (
    <section className="mx-auto max-w-[1000px] px-7 pt-6 print:hidden">
      <h1 className="text-[18px] font-black tracking-[-0.02em] text-ink">
        인쇄 검수 시험지 견본
      </h1>
      <p className="mt-1 text-[12.5px] leading-[1.75] text-text-2">
        `/dev/print-check` 의 미결 항목이{" "}
        <strong>드러나도록 문항을 골라</strong> 제품의 시험지 지면에 그대로
        얹었다. 아래 「인쇄하기」로 뽑으면 된다.
        <br />
        <br />
        <strong>문제지와 정답지를 둘 다 뽑으세요.</strong> 아래 모드 전환으로
        「정답지」를 고른 뒤 한 번 더 인쇄해야 <code>overflow-first-page</code>
        (정답지 1쪽 정원에 해설이 사라지는지)와 <code>multi-answer</code>(복수
        정답 표기)가 드러납니다.
        <br />
        그림 넷(mm · 벡터 · 배경 · 해상도)은 크기를 재야 해서{" "}
        <a className="underline" href="/dev/print-specimen">
          /dev/print-specimen
        </a>{" "}
        견본지가 따로 있다.
      </p>

      <div className="mt-4 border border-divider bg-surface px-4 py-3">
        <p className="text-[10px] font-extrabold tracking-[1.2px] text-ink">
          자리 채움 — 못 채운 자리는 이 시험지로 검수할 수 없다
        </p>
        <p className="mt-1 text-[12px] text-text-2">
          풀 {pool.toLocaleString()}건에서 자리 {slots}개를 채우고 정원 {total}
          까지 메웠다 — 실린 문항 {picked} (자리 {picked - padding} · 메움{" "}
          {padding}).
        </p>
        <ul className="mt-2 flex flex-col gap-1">
          {filled.map((f) => (
            <li
              key={f.forItem}
              className={`border-l-[3px] pl-3 text-[12.5px] leading-[1.7] ${
                f.got >= f.want
                  ? "border-divider text-ink"
                  : "border-ink font-bold text-ink"
              }`}
            >
              {f.got >= f.want ? "○" : "🔴"} {f.got}/{f.want} · {f.label}{" "}
              <code className="bg-side px-1 text-[11px]">{f.forItem}</code>
            </li>
          ))}
        </ul>
        {missing.length > 0 ? (
          <p className="mt-2 border-l-[3px] border-ink pl-3 text-[12.5px] leading-[1.7] text-ink">
            <strong>못 채운 자리 {missing.length}개</strong> — 그 항목(
            {missing.map((m) => m.forItem).join(" · ")})은{" "}
            <strong>이 시험지로 검수했다고 적으면 안 된다.</strong> 풀에 그런
            문항이 없거나 정원이 모자란 것이다.
          </p>
        ) : null}
      </div>
    </section>
  );
}
