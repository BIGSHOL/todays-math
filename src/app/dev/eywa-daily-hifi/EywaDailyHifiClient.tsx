"use client";

import { useState } from "react";

import { Button } from "@/components/ui/Button";

import type { WireDay } from "../eywa-daily-wire/EywaDailyWireClient";

/**
 * 학생별 확인테스트 출제 — **Hi-fi 4안** (D-07 2단계, D 골격 확정 후).
 *
 * 골격은 넷 다 같다(원장님 확정): 요약 + 「모두 출제」 하나 → 손 갈 것만 펼침
 * (시험기간 표시만 · 문항 부족 자동 제외) → 자동 갈래는 접힘 → 동기화 스트립.
 * 다른 것은 **시각 처리**다:
 *   ① 계기판 — 메인 대시보드의 세그먼트·숫자 언어
 *   ② 수첩   — 잉크·구분선의 조밀한 장부
 *   ③ 브리핑 — 문장이 앞서고 숫자는 따라온다
 *   ④ 작업함 — 예외 하나가 카드 하나, 우측에 요약 패널
 */

const HIFIS = [
  {
    key: "1",
    name: "계기판",
    idea: "메인 화면과 같은 언어 — 세그먼트 바와 큰 숫자.",
  },
  { key: "2", name: "수첩", idea: "잉크와 구분선. 원장 장부처럼 조밀하게." },
  {
    key: "3",
    name: "브리핑",
    idea: "「오늘 51종이 나갑니다. 볼 것 14건.」 문장이 먼저.",
  },
  {
    key: "4",
    name: "작업함",
    idea: "예외 하나가 카드 하나. 비우면 끝나는 할 일함.",
  },
] as const;

const MICRO_LABEL = "text-[10px] font-extrabold tracking-[1.2px] text-text-2";

const n = (v: number) => v.toLocaleString("ko-KR");

const kstTime = (iso: string) =>
  new Intl.DateTimeFormat("ko-KR", {
    timeZone: "Asia/Seoul",
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(iso));

interface Derived {
  auto: WireDay["groups"];
  lacking: WireDay["groups"];
  autoStudents: number;
  lackingStudents: number;
}

function derive(d: WireDay): Derived {
  const auto = d.groups.filter((g) => g.poolTotal >= 8);
  const lacking = d.groups.filter((g) => g.poolTotal < 8);
  return {
    auto,
    lacking,
    autoStudents: auto.reduce((s, g) => s + g.students.length, 0),
    lackingStudents: lacking.reduce((s, g) => s + g.students.length, 0),
  };
}

/** 범위 표기 — 첫 회는 대단원 처음~현재라 「대단원 › 처음~끝 소단원」이 짧게 선다. */
function rangeText(g: WireDay["groups"][number]) {
  if (g.unitCount === 1)
    return `${g.end.grade} ${g.end.chapter} › ${g.end.section}`;
  return `${g.end.grade} ${g.end.chapter} › ${g.start.section} ~ ${g.end.section}`;
}

function StudentChips({
  students,
}: {
  students: WireDay["groups"][number]["students"];
}) {
  return (
    <span className="inline-flex flex-wrap gap-1 align-middle">
      {students.map((s) => (
        <span
          key={s.name}
          className="rounded bg-side px-1.5 py-0.5 text-[12px]"
          title={s.className}
        >
          {s.name} <span className="text-text-3">{s.grade}</span>
        </span>
      ))}
    </span>
  );
}

/** 시험기간·미분류 — 원장님 확정: 표시만, 자동 출제 제외. 접힌 한 줄이 기본. */
function ExamStrip({ d, tone }: { d: WireDay; tone?: "card" | "flat" }) {
  if (d.noProgressToday.length === 0) return null;
  return (
    <details
      className={
        tone === "flat"
          ? "border-t border-divider"
          : "rounded border border-divider bg-surface"
      }
    >
      <summary className="cursor-pointer px-3 py-2 text-sm text-g-yellow-text">
        시험기간·진도 못 읽음 {d.noProgressToday.length}명 — 자동 출제 제외
      </summary>
      <ul className="border-t border-divider">
        {d.noProgressToday.map((s) => (
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
                className="rounded bg-side px-1.5 text-[12px] text-g-yellow-text"
              >
                {l}
              </span>
            ))}
            <span className="ml-auto">
              <Button variant="secondary" className="min-h-8">
                범위 직접 골라 출제
              </Button>
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function LackingRows({ groups }: { groups: WireDay["groups"] }) {
  return (
    <ul>
      {groups.map((g) => (
        <li
          key={g.key}
          className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider px-3 py-2 text-sm last:border-b-0"
        >
          <span className="min-w-0 basis-full truncate sm:basis-[44%]">
            {rangeText(g)}
          </span>
          <StudentChips students={g.students} />
          <span className="font-semibold text-g-red-text">
            문항 {g.poolTotal}
          </span>
          <span className="ml-auto inline-flex gap-1.5">
            <Button variant="secondary" className="min-h-8">
              범위 넓혀 출제
            </Button>
            <Button variant="secondary" className="min-h-8">
              AI 생성 요청
            </Button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function AutoDetails({ dv }: { dv: Derived }) {
  return (
    <details className="rounded border border-divider bg-surface">
      <summary className="cursor-pointer px-3 py-2 text-sm text-text-2">
        자동으로 나가는 {dv.auto.length}갈래 · {dv.autoStudents}명 펼쳐 보기
      </summary>
      <ul className="border-t border-divider">
        {dv.auto.map((g) => (
          <li
            key={g.key}
            className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-divider px-3 py-1.5 text-sm last:border-b-0"
          >
            <span className="min-w-0 basis-full truncate sm:basis-[44%]">
              {rangeText(g)}
            </span>
            <StudentChips students={g.students} />
            <span className="ml-auto text-[11px] text-text-3">
              문항 {n(g.poolTotal)}
            </span>
          </li>
        ))}
      </ul>
    </details>
  );
}

function SyncLine({ d, className = "" }: { d: WireDay; className?: string }) {
  return (
    <p
      className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[12px] text-text-2 ${className}`}
    >
      <span className="flex items-center gap-1.5">
        <span
          aria-hidden
          className="inline-block h-2 w-2 rounded-full bg-g-green"
        />
        eywa 동기화 {kstTime(d.sync.syncedAt)}
      </span>
      <span>
        학생 {n(d.sync.students)} · 진도 {n(d.sync.progressRows)}행 · 미분류{" "}
        {n(d.sync.unresolvedLines)}줄
      </span>
      <Button variant="ghost" className="min-h-8 px-1">
        지금 가져오기
      </Button>
    </p>
  );
}

/* ────────────── ① 계기판 — 메인 대시보드의 언어 ────────────── */

function Hifi1({ d, dv }: { d: WireDay; dv: Derived }) {
  const total = dv.autoStudents + dv.lackingStudents + d.noProgressToday.length;
  const seg = (v: number) =>
    `${Math.max(4, Math.round((v / Math.max(1, total)) * 100))}%`;
  return (
    <div className="space-y-4">
      <section className="border border-divider bg-surface p-4">
        <p className={MICRO_LABEL}>오늘의 확인테스트</p>
        <div className="mt-2 flex flex-wrap items-end gap-x-8 gap-y-2">
          <p>
            <span className="text-[34px] leading-none font-bold">
              {n(dv.autoStudents)}
            </span>
            <span className="ml-1 text-sm text-text-2">
              명 자동 · {dv.auto.length}종
            </span>
          </p>
          <p>
            <span className="text-[34px] leading-none font-bold text-g-red-text">
              {n(dv.lackingStudents)}
            </span>
            <span className="ml-1 text-sm text-text-2">명 문항 부족</span>
          </p>
          <p>
            <span className="text-[34px] leading-none font-bold text-g-yellow-text">
              {n(d.noProgressToday.length)}
            </span>
            <span className="ml-1 text-sm text-text-2">명 시험기간</span>
          </p>
          <span className="ml-auto">
            <Button className="min-h-11 px-5">모두 출제</Button>
          </span>
        </div>
        <div className="mt-3 flex h-2 gap-[3px]">
          <span className="bg-g-blue" style={{ width: seg(dv.autoStudents) }} />
          {dv.lackingStudents > 0 ? (
            <span
              className="bg-g-red"
              style={{ width: seg(dv.lackingStudents) }}
            />
          ) : null}
          {d.noProgressToday.length > 0 ? (
            <span
              className="bg-g-yellow"
              style={{ width: seg(d.noProgressToday.length) }}
            />
          ) : null}
        </div>
        <p className="mt-2 text-[12px] text-text-3">
          출제 후 검수함에 초안으로 쌓인다 — 승인해야 인쇄로 간다
        </p>
      </section>
      {dv.lacking.length > 0 ? (
        <section className="border border-divider bg-surface">
          <p
            className={`border-b border-divider px-3 py-2 ${MICRO_LABEL} text-g-red-text`}
          >
            문항 부족 — 자동에서 뺌
          </p>
          <LackingRows groups={dv.lacking} />
        </section>
      ) : null}
      <ExamStrip d={d} />
      <AutoDetails dv={dv} />
      <SyncLine d={d} />
    </div>
  );
}

/* ────────────── ② 수첩 — 잉크 장부 ────────────── */

function Hifi2({ d, dv }: { d: WireDay; dv: Derived }) {
  return (
    <div className="border-2 border-ink bg-surface">
      <header className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b-2 border-ink px-4 py-3">
        <h2 className="text-base font-bold">
          확인테스트 — {d.day.slice(5).replace("-", ". ")}.
        </h2>
        <p className="text-sm">
          자동 <b>{dv.autoStudents}명</b>({dv.auto.length}종) · 부족{" "}
          <b className="text-g-red-text">{dv.lackingStudents}명</b> · 시험기간{" "}
          <b className="text-g-yellow-text">{d.noProgressToday.length}명</b>
        </p>
        <span className="ml-auto">
          <Button variant="ink">모두 출제</Button>
        </span>
      </header>
      {dv.lacking.length > 0 ? (
        <div className="border-b border-divider">
          <p className="px-4 pt-2 text-[12px] font-bold">
            문항 부족 — 자동에서 뺌
          </p>
          <LackingRows groups={dv.lacking} />
        </div>
      ) : null}
      <ExamStrip d={d} tone="flat" />
      <div className="border-t border-divider px-1 py-1">
        <AutoDetails dv={dv} />
      </div>
      <SyncLine d={d} className="border-t-2 border-ink px-4 py-2" />
    </div>
  );
}

/* ────────────── ③ 브리핑 — 문장이 먼저 ────────────── */

function Hifi3({ d, dv }: { d: WireDay; dv: Derived }) {
  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <section>
        <p className="text-[22px] leading-snug">
          오늘 수업한 <b>{n(d.totals.attended)}명</b> 중{" "}
          <b>{n(dv.autoStudents)}명</b>의 시험지 <b>{dv.auto.length}종</b>이
          자동으로 나갑니다.
          {dv.lacking.length > 0 || d.noProgressToday.length > 0 ? (
            <>
              {" "}
              확인할 것은{" "}
              <b className="text-g-red-text">
                {dv.lacking.length + (d.noProgressToday.length > 0 ? 1 : 0)}건
              </b>
              입니다.
            </>
          ) : (
            <> 확인할 것이 없습니다.</>
          )}
        </p>
        <div className="mt-3 flex items-center gap-3">
          <Button className="px-5">모두 출제</Button>
          <span className="text-[12px] text-text-3">
            출제 후 검수함에 초안으로 쌓인다
          </span>
        </div>
      </section>
      {dv.lacking.length > 0 ? (
        <section className="rounded border border-divider bg-surface">
          <p className="border-b border-divider px-3 py-2 text-sm font-semibold">
            문항이 부족한 {dv.lacking.length}갈래{" "}
            <span className="font-normal text-text-3">
              — 범위를 넓히거나 AI 생성으로
            </span>
          </p>
          <LackingRows groups={dv.lacking} />
        </section>
      ) : null}
      <ExamStrip d={d} />
      <AutoDetails dv={dv} />
      <SyncLine d={d} />
    </div>
  );
}

/* ────────────── ④ 작업함 — 예외 카드 + 우측 요약 ────────────── */

function Hifi4({ d, dv }: { d: WireDay; dv: Derived }) {
  return (
    <div className="flex flex-col gap-4 lg:flex-row">
      <div className="min-w-0 flex-1 space-y-3">
        <p className={MICRO_LABEL}>
          손 갈 것 {dv.lacking.length + (d.noProgressToday.length > 0 ? 1 : 0)}
          건
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          {dv.lacking.map((g) => (
            <section
              key={g.key}
              className="flex flex-col gap-2 border border-divider bg-surface p-3"
            >
              <p className="text-sm font-semibold">{rangeText(g)}</p>
              <StudentChips students={g.students} />
              <p className="text-[12px] text-g-red-text">
                승인 문항 {g.poolTotal} — 8개가 안 된다
              </p>
              <div className="mt-auto flex gap-1.5">
                <Button variant="secondary" className="min-h-8">
                  범위 넓혀 출제
                </Button>
                <Button variant="secondary" className="min-h-8">
                  AI 생성 요청
                </Button>
              </div>
            </section>
          ))}
          {d.noProgressToday.length > 0 ? (
            <section className="flex flex-col gap-2 border border-divider bg-surface p-3">
              <p className="text-sm font-semibold text-g-yellow-text">
                시험기간·진도 못 읽음 {d.noProgressToday.length}명
              </p>
              <StudentChips students={d.noProgressToday.slice(0, 8)} />
              {d.noProgressToday.length > 8 ? (
                <p className="text-[12px] text-text-3">
                  … 외 {d.noProgressToday.length - 8}명
                </p>
              ) : null}
              <div className="mt-auto">
                <Button variant="secondary" className="min-h-8">
                  명단 열기
                </Button>
              </div>
            </section>
          ) : null}
          {dv.lacking.length === 0 && d.noProgressToday.length === 0 ? (
            <p className="text-sm text-text-3">손 갈 것 없음</p>
          ) : null}
        </div>
        <AutoDetails dv={dv} />
      </div>
      <aside className="shrink-0 space-y-3 border-l-0 border-divider lg:w-[250px] lg:border-l-[3px] lg:pl-4">
        <p className={MICRO_LABEL}>오늘</p>
        <p className="text-[30px] leading-none font-bold">
          {n(dv.autoStudents)}
          <span className="ml-1 text-sm font-normal text-text-2">
            명 · {dv.auto.length}종
          </span>
        </p>
        <Button className="w-full">모두 출제</Button>
        <p className="text-[12px] text-text-3">
          출제 후 검수함에 초안으로 쌓인다 — 승인해야 인쇄로 간다
        </p>
        <SyncLine d={d} className="flex-col items-start gap-y-1" />
      </aside>
    </div>
  );
}

/* ────────────── 틀 ────────────── */

export function EywaDailyHifiClient({ days }: { days: WireDay[] }) {
  const [dayIdx, setDayIdx] = useState(0);
  const [hifi, setHifi] = useState<string>("1");
  const d = days[dayIdx]!;
  const dv = derive(d);
  return (
    <div className="min-h-screen bg-bg p-6 text-ink">
      <header className="mx-auto max-w-4xl">
        <h1 className="text-lg font-semibold">
          학생별 확인테스트 출제 — Hi-fi 시안 (D 골격)
        </h1>
        <p className="mt-1 text-sm text-text-2">
          확정 반영: 첫 회 범위는 현재 대단원만 · 시험기간은 표시만. 데이터는
          실측 두 날, 학생 이름만 가명. 버튼은 눌리지 않는다.
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
              {i === 0 ? "가장 많던 날" : "시험기간이 많던 날"}
            </button>
          ))}
        </div>
        <nav className="mt-3 flex flex-wrap gap-2">
          {HIFIS.map((h) => (
            <button
              key={h.key}
              type="button"
              onClick={() => setHifi(h.key)}
              aria-pressed={hifi === h.key}
              className={
                "cursor-pointer rounded border px-3 py-1.5 text-sm " +
                (hifi === h.key
                  ? "border-ink bg-ink text-white"
                  : "border-control bg-surface text-ink hover:bg-side")
              }
            >
              {h.key}. {h.name}
            </button>
          ))}
        </nav>
        <p className="mt-2 text-sm text-text-2">
          {HIFIS.find((h) => h.key === hifi)?.idea}
        </p>
      </header>
      <main className="mx-auto mt-5 max-w-4xl">
        {hifi === "1" && <Hifi1 d={d} dv={dv} />}
        {hifi === "2" && <Hifi2 d={d} dv={dv} />}
        {hifi === "3" && <Hifi3 d={d} dv={dv} />}
        {hifi === "4" && <Hifi4 d={d} dv={dv} />}
      </main>
    </div>
  );
}
