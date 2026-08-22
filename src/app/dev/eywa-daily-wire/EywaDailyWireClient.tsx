"use client";

import { useState, type ReactNode } from "react";

/**
 * 학생별 확인테스트 출제 화면 — **와이어 5안** (D-07 1단계, 눌러 보고 고르는 물건).
 *
 * 다섯 안이 다투는 것은 「하루 92명·73갈래를 무슨 축으로 보여 드리나」다:
 *   A 반 묶음 · B 갈래(같은 범위) 묶음 · C 학생 명단 · D 예외 우선 · E 학년 레인
 *
 * 버튼은 전부 죽어 있다 — 배치만 본다. 동기화 스트립·예외 블록은 모든 안이
 * 공통으로 가진다(자리만 다르다).
 */

interface UnitRef {
  grade: string;
  chapter: string;
  section: string;
}
interface WireStudent {
  name: string;
  grade: string;
  className: string;
}
interface WireGroup {
  key: string;
  start: UnitRef;
  end: UnitRef;
  unitCount: number;
  students: WireStudent[];
  schoolLevels: string[];
  poolTotal: number;
}
interface NoProgressStudent extends WireStudent {
  rawLines: string[];
}
export interface WireDay {
  day: string;
  sync: {
    syncedAt: string;
    students: number;
    progressRows: number;
    unresolvedLines: number;
    unresolvedKinds: number;
    ambiguous: number;
  };
  totals: {
    attended: number;
    withRange: number;
    groups: number;
    groupsLackingPool: number;
    wideRangeGroups: number;
    noProgressToday: number;
  };
  noProgressToday: NoProgressStudent[];
  groups: WireGroup[];
}

const WIRES = [
  {
    key: "A",
    name: "반 묶음",
    idea: "지금 대시보드의 은유 그대로 — 반 카드 안에 오늘 학생이 선다.",
  },
  {
    key: "B",
    name: "갈래 묶음",
    idea: "같은 범위 학생을 한 행으로 — 한 행이 곧 시험지 한 종이다.",
  },
  {
    key: "C",
    name: "학생 명단",
    idea: "한 학생 한 행. 눈으로 전원 점호하는 표.",
  },
  {
    key: "D",
    name: "예외 우선",
    idea: "정상은 단추 하나로 접고, 손 갈 것만 펼친다.",
  },
  {
    key: "E",
    name: "학년 레인",
    idea: "초·중1·중2·…·고3 레인 안에 갈래가 선다.",
  },
] as const;

const EXAMISH = /(평가|시험|내신|대비|모의고사|총정리|오답|보강)/;

const n = (v: number) => v.toLocaleString("ko-KR");

const kstTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

/** 범위 한 줄 — 시작~끝 + 단원 수·풀 배지. 모든 안이 같은 표기를 쓴다. */
function RangeLine({ g }: { g: WireGroup }) {
  const one = g.unitCount === 1;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
      {one ? (
        <span className="truncate text-sm">
          <b className="font-semibold">{g.end.grade}</b> {g.end.section}
        </span>
      ) : (
        <>
          <span className="max-w-[30ch] truncate text-sm text-text-2">
            {g.start.grade} {g.start.section}
          </span>
          <span className="text-text-3">~</span>
          <span className="max-w-[34ch] truncate text-sm">
            <b className="font-semibold">{g.end.grade}</b> {g.end.section}
          </span>
        </>
      )}
      <Badges g={g} />
    </span>
  );
}

function Badges({ g }: { g: WireGroup }) {
  return (
    <>
      {g.unitCount > 30 ? (
        <span
          className="rounded border border-divider bg-side px-1 text-[11px] text-g-yellow-text"
          title="직전 확인테스트가 없어 진도 이력 첫 단원부터 잡혔다 — 첫 회 정책 미확정"
        >
          {n(g.unitCount)}단원 · 첫 회
        </span>
      ) : (
        <span className="text-[11px] text-text-3">{g.unitCount}단원</span>
      )}
      {g.poolTotal < 8 ? (
        <span className="rounded border border-divider px-1 text-[11px] font-semibold text-g-red-text">
          문항 {g.poolTotal} — 부족
        </span>
      ) : (
        <span className="text-[11px] text-text-3">문항 {n(g.poolTotal)}</span>
      )}
    </>
  );
}

function DeadButton({
  children,
  primary,
}: {
  children: ReactNode;
  primary?: boolean;
}) {
  return (
    <button
      type="button"
      className={
        "shrink-0 rounded border px-2.5 py-1 text-sm " +
        (primary
          ? "border-ink bg-ink font-semibold text-white"
          : "border-control bg-surface text-ink")
      }
    >
      {children}
    </button>
  );
}

/** 동기화 상태 스트립 — 다섯 안 공통. eywa 에서 언제·무엇이 왔는지 + 지금 가져오기. */
function SyncStrip({ d }: { d: WireDay }) {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded border border-divider bg-side px-3 py-2 text-sm">
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full bg-g-green"
        />
        eywa 동기화 <b>{kstTime(d.sync.syncedAt)}</b>
      </span>
      <span className="text-text-2">
        학생 {n(d.sync.students)} · 진도 {n(d.sync.progressRows)}행
      </span>
      <span className="text-text-2">
        미분류 {n(d.sync.unresolvedLines)}줄 · 애매 {n(d.sync.ambiguous)}
      </span>
      <DeadButton>지금 가져오기</DeadButton>
      <span className="text-[11px] text-text-3">
        48시간 넘으면 초록 점이 붉은 「오래됨」 경고로 바뀐다
      </span>
    </div>
  );
}

/** 예외 블록 — 진도 대신 시험기간·미분류만 적힌 학생. 다섯 안 공통(자리만 다름). */
function ExceptionBlock({ d, compact }: { d: WireDay; compact?: boolean }) {
  if (d.noProgressToday.length === 0)
    return (
      <p className="text-sm text-text-3">
        오늘 보고서에서 진도를 못 읽은 학생 없음
      </p>
    );
  const shown = compact ? d.noProgressToday.slice(0, 6) : d.noProgressToday;
  return (
    <div className="rounded border border-divider bg-surface">
      <p className="border-b border-divider px-3 py-2 text-sm font-semibold text-g-yellow-text">
        보고서는 있는데 진도를 못 읽음 — {d.noProgressToday.length}명
        <span className="ml-2 font-normal text-text-3">
          시험기간이면 확인테스트 대신 시험대비로 다룰지가 다음 질문이다
        </span>
      </p>
      <ul>
        {shown.map((s) => (
          <li
            key={s.name + s.className}
            className="flex flex-wrap items-center gap-x-2 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
          >
            <b>{s.name}</b>
            <span className="text-text-3">
              {s.grade} · {s.className}
            </span>
            {[...new Set(s.rawLines)].map((l) => (
              <span
                key={l}
                className={
                  "rounded bg-side px-1.5 text-[12px] " +
                  (EXAMISH.test(l) ? "text-g-yellow-text" : "text-g-red-text")
                }
              >
                {l}
              </span>
            ))}
            <span className="ml-auto">
              <DeadButton>범위 직접 고르기</DeadButton>
            </span>
          </li>
        ))}
        {compact && d.noProgressToday.length > shown.length ? (
          <li className="px-3 py-1.5 text-sm text-text-3">
            … 외 {d.noProgressToday.length - shown.length}명
          </li>
        ) : null}
      </ul>
    </div>
  );
}

/* ────────────────────────── A. 반 묶음 ────────────────────────── */

function WireA({ d }: { d: WireDay }) {
  const byClass = new Map<string, Array<{ s: WireStudent; g: WireGroup }>>();
  for (const g of d.groups)
    for (const s of g.students) {
      const list = byClass.get(s.className) ?? [];
      list.push({ s, g });
      byClass.set(s.className, list);
    }
  const classes = [...byClass.entries()].sort(
    (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0], "ko"),
  );
  return (
    <div className="space-y-3">
      <ExceptionBlock d={d} compact />
      {classes.map(([className, rows]) => (
        <section
          key={className}
          className="rounded border border-divider bg-surface"
        >
          <header className="flex items-center gap-2 border-b border-divider px-3 py-2">
            <h3 className="text-sm font-semibold">{className}</h3>
            <span className="text-[12px] text-text-3">
              오늘 {rows.length}명
            </span>
            <span className="ml-auto">
              <DeadButton primary>반 전체 출제</DeadButton>
            </span>
          </header>
          <ul>
            {rows.map(({ s, g }) => (
              <li
                key={s.name}
                className="flex items-center gap-3 border-b border-divider px-3 py-1.5 last:border-b-0"
              >
                <span className="w-24 shrink-0 truncate text-sm">
                  <b>{s.name}</b>{" "}
                  <span className="text-[11px] text-text-3">{s.grade}</span>
                </span>
                <RangeLine g={g} />
                <span className="ml-auto">
                  <DeadButton>출제</DeadButton>
                </span>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

/* ────────────────────────── B. 갈래 묶음 ────────────────────────── */

function GroupRow({ g }: { g: WireGroup }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider px-3 py-2 last:border-b-0">
      <div className="min-w-0 basis-full sm:basis-[46%]">
        <RangeLine g={g} />
      </div>
      <div className="flex min-w-0 flex-1 flex-wrap gap-1">
        {g.students.map((s) => (
          <span
            key={s.name}
            className="rounded bg-side px-1.5 py-0.5 text-[12px]"
            title={s.className}
          >
            {s.name} <span className="text-text-3">{s.grade}</span>
          </span>
        ))}
      </div>
      <DeadButton primary>{g.students.length}명 출제</DeadButton>
    </li>
  );
}

function WireB({ d }: { d: WireDay }) {
  return (
    <div className="space-y-3">
      <div className="flex items-center gap-3 rounded border border-divider bg-surface px-3 py-2">
        <p className="text-sm">
          오늘 <b>{n(d.totals.withRange)}명</b> · 시험지{" "}
          <b>{n(d.totals.groups)}종</b>
        </p>
        <span className="ml-auto">
          <DeadButton primary>오늘 전부 출제</DeadButton>
        </span>
      </div>
      <ExceptionBlock d={d} compact />
      <ul className="rounded border border-divider bg-surface">
        {d.groups.map((g) => (
          <GroupRow key={g.key} g={g} />
        ))}
      </ul>
    </div>
  );
}

/* ────────────────────────── C. 학생 명단 ────────────────────────── */

function WireC({ d }: { d: WireDay }) {
  const rows: Array<{ s: WireStudent; g: WireGroup }> = [];
  for (const g of d.groups) for (const s of g.students) rows.push({ s, g });
  rows.sort(
    (a, b) =>
      a.s.className.localeCompare(b.s.className, "ko") ||
      a.s.name.localeCompare(b.s.name, "ko"),
  );
  return (
    <div className="space-y-3">
      <ExceptionBlock d={d} compact />
      <table className="w-full border-collapse rounded border border-divider bg-surface text-sm">
        <thead>
          <tr className="border-b border-divider text-left text-[12px] text-text-2">
            <th className="px-3 py-2 font-medium">학생</th>
            <th className="px-2 py-2 font-medium">반</th>
            <th className="px-2 py-2 font-medium">확인테스트 범위</th>
            <th className="px-2 py-2 text-right font-medium">출제</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(({ s, g }) => (
            <tr
              key={s.name}
              className="border-b border-divider last:border-b-0"
            >
              <td className="px-3 py-1.5 whitespace-nowrap">
                <b>{s.name}</b>{" "}
                <span className="text-[11px] text-text-3">{s.grade}</span>
              </td>
              <td className="px-2 py-1.5 whitespace-nowrap text-[12px] text-text-2">
                {s.className}
              </td>
              <td className="px-2 py-1.5">
                <RangeLine g={g} />
              </td>
              <td className="px-2 py-1.5 text-right">
                <DeadButton>출제</DeadButton>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ────────────────────────── D. 예외 우선 ────────────────────────── */

function WireD({ d }: { d: WireDay }) {
  const lacking = d.groups.filter((g) => g.poolTotal < 8);
  const fine = d.groups.filter((g) => g.poolTotal >= 8);
  return (
    <div className="space-y-3">
      <div className="rounded border border-divider bg-surface px-4 py-3">
        <p className="text-base">
          오늘 <b>{n(d.totals.withRange)}명</b> — 시험지{" "}
          <b>{n(d.totals.groups)}종</b>이 자동으로 나온다
        </p>
        <div className="mt-2 flex items-center gap-3">
          <DeadButton primary>모두 출제</DeadButton>
          <span className="text-[12px] text-text-3">
            출제 후 검수함에 초안으로 쌓인다 — 승인해야 인쇄로 간다 (D-22)
          </span>
        </div>
      </div>
      <ExceptionBlock d={d} />
      {lacking.length > 0 ? (
        <div className="rounded border border-divider bg-surface">
          <p className="border-b border-divider px-3 py-2 text-sm font-semibold text-g-red-text">
            문항이 부족해 자동 출제에서 뺌 — {lacking.length}갈래
          </p>
          <ul>
            {lacking.map((g) => (
              <GroupRow key={g.key} g={g} />
            ))}
          </ul>
        </div>
      ) : (
        <p className="text-sm text-text-3">문항 부족 갈래 없음</p>
      )}
      <details className="rounded border border-divider bg-surface">
        <summary className="cursor-pointer px-3 py-2 text-sm text-text-2">
          자동으로 나가는 {fine.length}갈래 펼쳐 보기
        </summary>
        <ul className="border-t border-divider">
          {fine.map((g) => (
            <GroupRow key={g.key} g={g} />
          ))}
        </ul>
      </details>
    </div>
  );
}

/* ────────────────────────── E. 학년 레인 ────────────────────────── */

const LANE_ORDER = ["초등", "중1", "중2", "중3", "고1", "고2", "고3", "기타"];

function WireE({ d }: { d: WireDay }) {
  const lanes = new Map<string, WireGroup[]>();
  for (const g of d.groups) {
    const grade = g.students[0]?.grade ?? "기타";
    const lane = /^초/.test(grade)
      ? "초등"
      : LANE_ORDER.includes(grade)
        ? grade
        : "기타";
    const list = lanes.get(lane) ?? [];
    list.push(g);
    lanes.set(lane, list);
  }
  return (
    <div className="space-y-3">
      <ExceptionBlock d={d} compact />
      {LANE_ORDER.filter((l) => lanes.has(l)).map((lane) => {
        const gs = lanes.get(lane)!;
        const count = gs.reduce((s, g) => s + g.students.length, 0);
        return (
          <section
            key={lane}
            className="rounded border border-divider bg-surface"
          >
            <header className="flex items-center gap-2 border-b border-divider px-3 py-2">
              <h3 className="text-sm font-semibold">{lane}</h3>
              <span className="text-[12px] text-text-3">
                {count}명 · {gs.length}갈래
              </span>
              <span className="ml-auto">
                <DeadButton primary>{lane} 전체 출제</DeadButton>
              </span>
            </header>
            <ul>
              {gs.map((g) => (
                <GroupRow key={g.key} g={g} />
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

/* ────────────────────────── 틀 ────────────────────────── */

export function EywaDailyWireClient({ days }: { days: WireDay[] }) {
  const [dayIdx, setDayIdx] = useState(0);
  const [wire, setWire] = useState<string>("A");
  const d = days[dayIdx]!;
  return (
    <div className="min-h-screen bg-bg p-6 text-ink">
      <header className="mx-auto max-w-4xl">
        <h1 className="text-lg font-semibold">
          학생별 확인테스트 출제 — 와이어 시안
        </h1>
        <p className="mt-1 text-sm text-text-2">
          eywa 실데이터 두 날로 그렸다. 학생 이름만 가명 — 실제 화면에는 실명이
          나온다. 버튼은 전부 눌리지 않는다(배치만 본다).
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {days.map((day, i) => (
            <button
              key={day.day}
              type="button"
              onClick={() => setDayIdx(i)}
              aria-pressed={dayIdx === i}
              className={
                "cursor-pointer rounded border px-3 py-1.5 text-sm " +
                (dayIdx === i
                  ? "border-ink bg-ink text-white"
                  : "border-control bg-surface text-ink hover:bg-side")
              }
            >
              {day.day.slice(5).replace("-", "/")} —{" "}
              {i === 0 ? "가장 많던 날" : "시험기간이 많던 날"} (
              {n(day.totals.withRange)}명 · {n(day.totals.groups)}갈래
              {day.totals.noProgressToday > 0
                ? ` · 못 읽음 ${day.totals.noProgressToday}`
                : ""}
              )
            </button>
          ))}
        </div>
        <div className="mt-3">
          <SyncStrip d={d} />
        </div>
        <nav className="mt-4 flex flex-wrap gap-2">
          {WIRES.map((w) => (
            <button
              key={w.key}
              type="button"
              onClick={() => setWire(w.key)}
              aria-pressed={wire === w.key}
              className={
                "cursor-pointer rounded border px-3 py-1.5 text-sm " +
                (wire === w.key
                  ? "border-ink bg-ink text-white"
                  : "border-control bg-surface text-ink hover:bg-side")
              }
            >
              {w.key}. {w.name}
            </button>
          ))}
        </nav>
        <p className="mt-2 text-sm text-text-2">
          {WIRES.find((w) => w.key === wire)?.idea}
        </p>
      </header>

      <main className="mx-auto mt-5 max-w-4xl">
        {wire === "A" && <WireA d={d} />}
        {wire === "B" && <WireB d={d} />}
        {wire === "C" && <WireC d={d} />}
        {wire === "D" && <WireD d={d} />}
        {wire === "E" && <WireE d={d} />}
      </main>
    </div>
  );
}
