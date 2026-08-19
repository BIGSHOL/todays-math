"use client";

import { useState } from "react";

import { UnitRangePicker } from "@/components/progress/UnitRangePicker";
import { UnitTreePicker } from "@/components/progress/UnitTreePicker";
import { FIELD_CLASS } from "@/components/test/labels";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import {
  ALL_END,
  ALL_START,
  ALL_UNITS,
  HIFI_GRADE_TOTAL,
  HIFI_RANGE_COUNT,
  HIFI_RANGE_END,
  HIFI_RANGE_START,
  HIFI_UNITS,
} from "./fixtures";

/** 출제 설정 폼이 실제로 쓰는 마이크로 라벨(05 §3.2 Micro Label 9~10.5 / 800). */
const LABEL_CLASS =
  "grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2";

export function RangeHifiClient() {
  return (
    <main className="mx-auto max-w-[720px] px-8 py-6">
      <h1 className="text-[15px] font-black">
        확인테스트 범위 — Hi-fi 시안 (D-07)
      </h1>
      <p className="mt-2 text-[12.5px] leading-[1.7] text-text-2">
        <strong className="text-ink">확정(2026-08-19)</strong>: Wire{" "}
        <strong className="text-ink">C안</strong>(평소 한 줄, 고칠 때만 펼침) ·
        Hi-fi <strong className="text-ink">④ 범위 막대</strong> · 펼침은{" "}
        <strong className="text-ink">㈟ 3열 피커 두 벌</strong>. 원장님이 ASCII
        시안에서는 ②를 고르셨다가{" "}
        <strong className="text-ink">실물 HTML 을 보고 ④로 바꾸셨다</strong> —
        이 페이지를 만든 이유가 그것이다. 아래는 그때 견준 안들을 그대로 남긴
        것이다(서체·색·간격은 실제 토큰).
      </p>

      <Variant
        no="①"
        title="값을 크게"
        note="범위를 제목처럼 키운다(15px/900). 근거는 아래 마이크로 회색 한 줄."
      >
        <div className={LABEL_CLASS}>
          범위
          <div className="flex items-baseline gap-3">
            <span className="text-[15px] font-black text-ink">
              {HIFI_RANGE_START.section} ~ {HIFI_RANGE_END.section}
            </span>
            <FixLink />
          </div>
          <span className="text-[10.5px] font-bold tracking-normal text-text-3">
            소단원 {HIFI_RANGE_COUNT}개 · 진도 기준 자동
          </span>
        </div>
      </Variant>

      <Variant
        no="②"
        title="계기판 행"
        note="값 12.5px/900, 개수는 회색, 아래 1px 구분선. 다른 필드와 줄이 맞는다."
      >
        <div className={LABEL_CLASS}>
          범위
          <div className="flex items-baseline gap-3 border-b border-divider pb-2">
            <span className="text-[12.5px] font-black text-ink">
              {HIFI_RANGE_START.section} ~ {HIFI_RANGE_END.section}
            </span>
            <span className="text-[12.5px] font-bold tabular-nums text-text-3">
              {HIFI_RANGE_COUNT}개
            </span>
            <FixLink className="ml-auto" />
          </div>
        </div>
      </Variant>

      <Variant
        no="③"
        title="시작 / 끝 두 칸"
        note="시작과 끝을 나란히, 각각 대단원을 받침으로. 세 줄을 먹는다."
      >
        <div className={LABEL_CLASS}>
          <div className="flex items-baseline">
            범위
            <FixLink className="ml-auto" />
          </div>
          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 border border-divider px-4 py-3">
            <div className="grid gap-0.5">
              <span className="text-[12.5px] font-black text-ink">
                {HIFI_RANGE_START.section}
              </span>
              <span className="text-[10.5px] font-bold tracking-normal text-text-3">
                {HIFI_RANGE_START.grade} {HIFI_RANGE_START.chapter}
              </span>
            </div>
            <span aria-hidden className="text-[12.5px] text-text-3">
              ~
            </span>
            <div className="grid gap-0.5">
              <span className="text-[12.5px] font-black text-ink">
                {HIFI_RANGE_END.section}
              </span>
              <span className="text-[10.5px] font-bold tracking-normal text-text-3">
                {HIFI_RANGE_END.grade} {HIFI_RANGE_END.chapter}
              </span>
            </div>
          </div>
        </div>
      </Variant>

      <Variant
        no="④"
        title="범위 막대"
        note="학년 전체에서 어디까지인지 막대로. 실물로 보니 이게 제일 낫다 — 채택."
        recommended
      >
        <div className={LABEL_CLASS}>
          범위
          <div className="flex items-baseline gap-3">
            <span className="text-[12.5px] font-black text-ink">
              {HIFI_RANGE_START.section} ~ {HIFI_RANGE_END.section}
            </span>
            <FixLink className="ml-auto" />
          </div>
          <div className="mt-1 h-[6px] w-full bg-seg-empty">
            <div
              className="h-full bg-g-blue"
              style={{
                width: `${(HIFI_RANGE_COUNT / HIFI_GRADE_TOTAL) * 100}%`,
              }}
            />
          </div>
          <span className="text-[10.5px] font-bold tracking-normal text-text-3">
            {HIFI_RANGE_START.grade} 소단원 {HIFI_GRADE_TOTAL}개 중 1~
            {HIFI_RANGE_COUNT}번째
          </span>
        </div>
      </Variant>

      <h2 className="mt-12 border-t-[3px] border-ink pt-4 text-[15px] font-black">
        「고치기」를 눌렀을 때 — 펼쳐지는 자리
      </h2>
      <p className="mt-2 text-[12.5px] leading-[1.7] text-text-2">
        C안은 평소에 한 줄이고, 고칠 때만 이 자리가 열린다. 여는 방식도 둘 중
        하나를 골라야 한다.
      </p>

      <Variant
        no="㉮"
        title="좁힌 목록 두 개"
        note="지금 화면과 같은 select 두 개. 다만 목록이 반 학년(중2 56개)으로 좁고, 라벨에 대단원이 붙는다."
      >
        <ExpandedSelects />
      </Variant>

      <Variant
        no="㉯"
        title="3열 피커 두 벌"
        note="S-07 진도 화면에서 이미 쓰는 그 피커(학년 | 대단원 | 소단원). 새 문법이 없다 — 채택."
        recommended
      >
        <ExpandedPickers />
      </Variant>

      <h2 className="mt-12 border-t-[3px] border-ink pt-4 text-[15px] font-black">
        펼침이 너무 길다 — 네 가지 해법 (2026-08-19 원장님 지적)
      </h2>
      <p className="mt-2 text-[12.5px] leading-[1.7] text-text-2">
        실제 데이터에서는 학년 열이 <strong className="text-ink">16행</strong>
        (초1~미적분2)이라 피커 하나가 750px 이 넘고, 시작·끝 두 벌이면 폼이
        통째로 화면 밖으로 밀린다. 아래 넷은{" "}
        <strong className="text-ink">실제 소단원 735개</strong>를 그대로 물려
        만들었다 — 앞의 시안들은 중2 17개만 써서 이 문제가 안 드러났다.
      </p>

      <Variant
        no="Ⓐ"
        title="한 피커에서 두 번 눌러 범위"
        note="달력의 기간 선택과 같다. 한 번 누르면 시작, 다시 누르면 끝. 피커가 한 벌이라 높이가 반이고 열마다 스크롤이 붙는다."
      >
        <RangeDemoSequential />
      </Variant>

      <Variant
        no="Ⓑ"
        title="좌클릭 = 시작 · 우클릭 = 끝"
        note="모드가 없어 어느 쪽이든 바로 고친다. 우클릭은 브라우저 메뉴를 막고 받으며, 터치·키보드를 위해 Shift+클릭도 끝으로 받는다. 안내는 우상단."
        recommended
      >
        <RangeDemoLeftRight />
      </Variant>

      <Variant
        no="Ⓒ"
        title="두 벌 그대로, 열만 스크롤"
        note="지금 구조를 안 바꾸고 각 열에 높이 상한만 준다. 가장 작은 개입이지만 여전히 두 벌이라 세로가 두 배다."
      >
        <RangeDemoTwoPickers />
      </Variant>

      <Variant
        no="Ⓓ"
        title="시작 | 끝 탭 전환"
        note="두 벌을 유지하되 한 번에 하나만 보여 준다. 높이는 한 벌이지만 「지금 어느 쪽을 고치는가」를 늘 확인해야 한다."
      >
        <RangeDemoTabs />
      </Variant>

      <h2 className="mt-12 border-t-[3px] border-ink pt-4 text-[15px] font-black">
        폼 전체에 얹으면 (②안 — 견주기용으로 남겨 둔다)
      </h2>
      <FullForm />
    </main>
  );
}

function FixLink({ className = "" }: { className?: string }) {
  return (
    <button
      type="button"
      className={`cursor-pointer text-[12.5px] font-bold text-g-blue underline-offset-4 hover:underline ${className}`}
    >
      고치기
    </button>
  );
}

function Variant({
  no,
  title,
  note,
  recommended = false,
  children,
}: {
  no: string;
  title: string;
  note: string;
  recommended?: boolean;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-8">
      <h3 className="flex items-baseline gap-2 text-[12.5px] font-black text-ink">
        <span className="tabular-nums">{no}</span>
        {title}
        {recommended ? (
          <span className="border border-g-blue px-1.5 py-0.5 text-[9px] font-extrabold tracking-[1.2px] text-g-blue">
            추천
          </span>
        ) : null}
      </h3>
      <p className="mt-1 text-[10.5px] leading-[1.6] text-text-3">{note}</p>
      <div className="mt-3 border border-divider bg-white px-5 py-4">
        {children}
      </div>
    </section>
  );
}

function ExpandedSelects() {
  const sameGrade = HIFI_UNITS.filter((u) => u.grade === "중2");
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      {(
        [
          ["시작 소단원", HIFI_RANGE_START.id],
          ["끝 소단원", HIFI_RANGE_END.id],
        ] as const
      ).map(([label, value]) => (
        <label key={label} className={LABEL_CLASS}>
          {label}
          <select className={FIELD_CLASS} defaultValue={value}>
            {sameGrade.map((unit) => (
              <option key={unit.id} value={unit.id}>
                {unit.chapter} · {unit.section}
              </option>
            ))}
          </select>
        </label>
      ))}
    </div>
  );
}

function ExpandedPickers() {
  const [start, setStart] = useState(HIFI_RANGE_START.id);
  const [end, setEnd] = useState(HIFI_RANGE_END.id);
  return (
    <div className="grid gap-5">
      <div className={LABEL_CLASS}>
        시작 소단원
        <UnitTreePicker
          units={HIFI_UNITS}
          currentUnitId={start}
          onSelect={setStart}
        />
      </div>
      <div className={LABEL_CLASS}>
        끝 소단원
        <UnitTreePicker
          units={HIFI_UNITS}
          currentUnitId={end}
          onSelect={setEnd}
        />
      </div>
    </div>
  );
}

/** ②안을 지금 폼에 그대로 얹은 모습 — 줄이 맞는지 보려는 것이다. */
function FullForm() {
  return (
    <div className="mt-4 border border-divider bg-white px-6 py-5">
      <div className="grid gap-4">
        <label className={LABEL_CLASS}>
          반
          <select className={FIELD_CLASS} defaultValue="c1">
            <option value="c1">중2 A반</option>
          </select>
        </label>
        <label className={LABEL_CLASS}>
          학생
          <select className={FIELD_CLASS} defaultValue="">
            <option value="">반 전체</option>
          </select>
        </label>
        <fieldset className="grid gap-2">
          <legend className="text-[10px] font-extrabold tracking-[1.2px] text-text-2">
            유형
          </legend>
          <div className="flex gap-4 text-[12.5px] font-bold">
            <label className="inline-flex min-h-11 items-center gap-2">
              <input type="radio" name="hifi-type" value="daily" />
              일일테스트
            </label>
            <label className="inline-flex min-h-11 items-center gap-2">
              <input
                type="radio"
                name="hifi-type"
                value="review"
                defaultChecked
              />
              확인테스트
            </label>
          </div>
        </fieldset>

        <div className={LABEL_CLASS}>
          범위
          <div className="flex items-baseline gap-3 border-b border-divider pb-2">
            <span className="text-[12.5px] font-black text-ink">
              {HIFI_RANGE_START.section} ~ {HIFI_RANGE_END.section}
            </span>
            <span className="text-[12.5px] font-bold tabular-nums text-text-3">
              {HIFI_RANGE_COUNT}개
            </span>
            <FixLink className="ml-auto" />
          </div>
        </div>

        <label className={LABEL_CLASS}>
          시행일
          <Input type="date" defaultValue="2026-08-19" />
        </label>
        <label className={LABEL_CLASS}>
          문항 수
          <Input type="number" min={1} max={30} defaultValue={8} />
        </label>
        <div className="grid grid-cols-3 gap-3">
          {(
            [
              ["하", 3],
              ["중", 4],
              ["상", 1],
            ] as const
          ).map(([label, value]) => (
            <label key={label} className={LABEL_CLASS}>
              {label}
              <Input type="number" min={0} defaultValue={value} />
            </label>
          ))}
        </div>
        <div className="flex justify-end">
          <Button type="button" variant="ink">
            출제
          </Button>
        </div>
      </div>
    </div>
  );
}

/** 범위 요약 한 줄 — 데모마다 같은 것을 쓴다. */
function RangeLine({ startId, endId }: { startId: string; endId: string }) {
  const start = ALL_UNITS.find((u) => u.id === startId);
  const end = ALL_UNITS.find((u) => u.id === endId);
  const count = ALL_UNITS.filter(
    (u) =>
      start &&
      end &&
      u.orderIndex >= Math.min(start.orderIndex, end.orderIndex) &&
      u.orderIndex <= Math.max(start.orderIndex, end.orderIndex),
  ).length;
  return (
    <p className="mb-2 text-[12.5px] font-black text-ink">
      {start?.section} ~ {end?.section}
      <span className="ml-2 font-bold text-text-3">소단원 {count}개</span>
    </p>
  );
}

function RangeDemoSequential() {
  const [start, setStart] = useState(ALL_START.id);
  const [end, setEnd] = useState(ALL_END.id);
  return (
    <div>
      <RangeLine startId={start} endId={end} />
      <UnitRangePicker
        units={ALL_UNITS}
        startUnitId={start}
        endUnitId={end}
        onChange={(s, e) => {
          setStart(s);
          setEnd(e);
        }}
      />
    </div>
  );
}

function RangeDemoLeftRight() {
  const [start, setStart] = useState(ALL_START.id);
  const [end, setEnd] = useState(ALL_END.id);
  return (
    <div>
      <RangeLine startId={start} endId={end} />
      <UnitRangePicker
        mode="left-right"
        units={ALL_UNITS}
        startUnitId={start}
        endUnitId={end}
        onChange={(s, e) => {
          setStart(s);
          setEnd(e);
        }}
      />
    </div>
  );
}

function RangeDemoTwoPickers() {
  const [start, setStart] = useState(ALL_START.id);
  const [end, setEnd] = useState(ALL_END.id);
  return (
    <div className="grid gap-4">
      <RangeLine startId={start} endId={end} />
      <div className={LABEL_CLASS}>
        시작
        <UnitTreePicker
          label="범위 시작 소단원"
          units={ALL_UNITS}
          currentUnitId={start}
          onSelect={setStart}
          columnMaxHeightPx={260}
        />
      </div>
      <div className={LABEL_CLASS}>
        끝
        <UnitTreePicker
          label="범위 끝 소단원"
          units={ALL_UNITS}
          currentUnitId={end}
          onSelect={setEnd}
          columnMaxHeightPx={260}
        />
      </div>
    </div>
  );
}

function RangeDemoTabs() {
  const [start, setStart] = useState(ALL_START.id);
  const [end, setEnd] = useState(ALL_END.id);
  const [tab, setTab] = useState<"start" | "end">("start");
  return (
    <div className="grid gap-2">
      <RangeLine startId={start} endId={end} />
      <div className="flex gap-2">
        {(
          [
            ["start", "시작"],
            ["end", "끝"],
          ] as const
        ).map(([key, text]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`min-h-11 cursor-pointer border px-4 text-[12.5px] font-bold ${
              tab === key
                ? "border-ink bg-ink text-white"
                : "border-divider bg-white text-ink"
            }`}
          >
            {text}
          </button>
        ))}
      </div>
      <UnitTreePicker
        label={tab === "start" ? "범위 시작 소단원" : "범위 끝 소단원"}
        units={ALL_UNITS}
        currentUnitId={tab === "start" ? start : end}
        onSelect={tab === "start" ? setStart : setEnd}
        columnMaxHeightPx={260}
      />
    </div>
  );
}
