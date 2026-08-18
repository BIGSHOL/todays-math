import type { ClassEntity } from "@/contracts/class.contract";
import type { UnitEntity } from "@/contracts/unit.contract";

import { adjacentUnitIds, unitSectionName } from "@/lib/main/unitLookup";

type Props = {
  classes: ClassEntity[];
  units: readonly Pick<UnitEntity, "id" | "section" | "orderIndex">[];
  selectedClassId: string;
  selectedUnitId: string | null;
  printedDays: number;
  unmodifiedRate: number;
  error: string | null;
  /** 화면에 보이는 차시(열람 위치)가 실제 기록된 진도와 달라 "진도 기록"이 의미 있는 상태인가. */
  canRecord: boolean;
  onSelectClass: (classId: string) => void;
  onStep: (unitId: string) => void;
  onRecord: () => void;
};

const ARROW =
  "inline-flex min-h-11 min-w-[44px] items-center justify-center border-2 border-ink text-[14px] font-black";

export function ProgressPanel({
  classes,
  units,
  selectedClassId,
  selectedUnitId,
  printedDays,
  unmodifiedRate,
  error,
  canRecord,
  onSelectClass,
  onStep,
  onRecord,
}: Props) {
  const lesson = unitSectionName(selectedUnitId, units);
  const { prevId, nextId } = adjacentUnitIds(selectedUnitId, units);

  // 배경이 원색 화이트가 된 뒤(2026-08-18) 회색 면이 큰 덩어리로 남아 겉돌았다
  // (원장님 지적 "여긴 여전히 회색톤인데"). 구역은 **3px 잉크 좌경계**가 이미 가르므로
  // 면은 물러난다 — 팔레트 「계기판」 설계 노트가 예고한 그 자리다.
  // 덤으로 패널 위 본문 대비가 5.11:1 → 6.21:1 로 올라간다.
  return (
    <aside className="w-[250px] shrink-0 border-l-[3px] border-ink bg-surface px-5 py-4">
      <h2 className="mb-2 border-t-[3px] border-ink pt-1.5 text-[10.5px] font-black tracking-[2.5px]">
        진도 입력
      </h2>
      <div className="text-[11.5px] leading-[2.1] text-[#4a4a48]">
        <label className="block">
          <span className="sr-only">반 선택</span>
          <select
            aria-label="반 선택"
            value={selectedClassId}
            onChange={(e) => onSelectClass(e.target.value)}
            className="w-full cursor-pointer bg-transparent font-bold text-ink"
          >
            {classes.map((cls) => (
              <option key={cls.id} value={cls.id}>
                {cls.name}
              </option>
            ))}
          </select>
        </label>
        <span
          aria-label="현재 소단원"
          className={`mt-0.5 mb-2 block text-[13.5px] font-black ${
            lesson === "—" ? "text-faint" : "text-ink"
          }`}
        >
          {lesson}
        </span>
        <div className="mt-1 flex items-center gap-1">
          <button
            type="button"
            aria-label="이전 차시"
            disabled={!prevId}
            onClick={() => {
              if (prevId) onStep(prevId);
            }}
            className={`${ARROW} cursor-pointer disabled:cursor-not-allowed disabled:opacity-40`}
          >
            &lt;
          </button>
          <span className="min-w-0 flex-1 text-center text-[10.5px] font-black tracking-[1.2px]">
            차시이동
          </span>
          <button
            type="button"
            aria-label="다음 차시"
            disabled={!nextId}
            onClick={() => {
              if (nextId) onStep(nextId);
            }}
            className={`${ARROW} cursor-pointer disabled:cursor-not-allowed disabled:opacity-40`}
          >
            &gt;
          </button>
        </div>
        {/* 차시이동 화살표는 "열람"만 한다(진도를 기록하지 않는다). 실제 진도 기록은 아래
            버튼으로 명시적으로 커밋한다 — 예전엔 화살표 클릭마다 진도가 쌓이는 버그가 있었다
            (원장 관찰, 2026-08-14). */}
        <button
          type="button"
          disabled={!canRecord}
          onClick={onRecord}
          className="mt-2 inline-flex min-h-11 w-full items-center justify-center bg-ink text-[12px] font-black text-canvas cursor-pointer disabled:cursor-not-allowed disabled:bg-side disabled:text-text-3"
        >
          이 차시로 진도 기록
        </button>
        {error ? <p className="mt-2 text-g-red-text">{error}</p> : null}
      </div>
      <h3 className="mt-5 mb-2 border-t-[3px] border-ink pt-1.5 text-[10.5px] font-black tracking-[2.5px]">
        이번 주
      </h3>
      <div className="flex gap-[18px]">
        <div>
          <div
            aria-label="이번 주 인쇄 일수"
            className="text-[26px] font-black leading-none tabular-nums text-g-blue"
          >
            {printedDays}
          </div>
          <div className="mt-1 text-[9.5px] font-extrabold tracking-[1.2px] text-faint">
            인쇄 일수
          </div>
        </div>
        <div>
          <div
            aria-label="이번 주 무수정 사용률"
            className="text-[26px] font-black leading-none tabular-nums text-g-blue"
          >
            {unmodifiedRate}
            <small className="text-[13px] font-extrabold text-faint">%</small>
          </div>
          <div className="mt-1 text-[9.5px] font-extrabold tracking-[1.2px] text-faint">
            무수정
          </div>
        </div>
      </div>
    </aside>
  );
}
