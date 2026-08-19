"use client";

import Link from "next/link";

import { UnitRangePicker } from "@/components/progress/UnitRangePicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UnitEntity } from "@/contracts/unit.contract";

import { FIELD_CLASS } from "./labels";
import { describeRange } from "./rangeSummary";
import { useGenerateSetup } from "./useGenerateSetup";

const LABEL_CLASS =
  "grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2";

/**
 * 확인테스트 범위 — **평소에는 한 줄, 고칠 때만 펼친다**(D-07 확정 2026-08-19:
 * Wire C안 → Hi-fi ④ 범위 막대 → 펼침은 Ⓐ 3열 피커 **한 벌**).
 *
 * 예전에는 소단원 select 두 개가 **735개**를 늘어놓고 기본값이 「초1 첫 소단원 ~
 * 미적분2 마지막」이었다. 원장이 손대지 않으면 전 교육과정이 범위가 되는데
 * **오류도 경고도 안 났다** — 후보가 4만 건이라 정원이 채워지기 때문이다.
 * 이제 기본값은 진도가 정하고(`/api/tests/default-range`), 화면은 그것을 읽어 준다.
 *
 * ⚠️ 펼침은 **피커 한 벌**이다(Ⓐ, 2026-08-19 원장님 확정). 시작·끝을 각각 피커로
 *    두었더니 학년 열이 16행(초1~미적분2)이라 피커 하나가 750px 이 넘고, 두 벌이면
 *    폼이 통째로 화면 밖으로 밀렸다 — 원장님이 실제 화면에서 잡아 주신 것이다.
 *    한 벌에서 **두 번 눌러** 범위를 잡고(달력의 기간 선택), 열마다 높이 상한을 준다.
 */
function RangeField({
  units,
  startUnitId,
  endUnitId,
  editing,
  unknown,
  onToggleEdit,
  onChangeRange,
}: {
  units: UnitEntity[];
  startUnitId: string;
  endUnitId: string;
  editing: boolean;
  unknown: boolean;
  onToggleEdit: () => void;
  onChangeRange: (startUnitId: string, endUnitId: string) => void;
}) {
  const summary = describeRange(units, startUnitId, endUnitId);

  return (
    <div className={LABEL_CLASS}>
      범위
      <div className="flex items-baseline gap-3">
        <span className="text-[12.5px] font-black text-ink">
          {summary ? summary.text : "진도 기록이 없어 범위를 정하지 못했습니다"}
        </span>
        <button
          type="button"
          onClick={onToggleEdit}
          className="ml-auto cursor-pointer text-[12.5px] font-bold text-g-blue underline-offset-4 hover:underline"
        >
          {editing ? "접기" : "고치기"}
        </button>
      </div>
      {summary ? (
        <>
          {/* 막대는 라벨이 말하는 것을 그림으로 되풀이할 뿐이라 보조기기에서는 숨긴다. */}
          <div aria-hidden className="mt-1 h-[6px] w-full bg-seg-empty">
            <div
              className="h-full bg-g-blue"
              style={{
                marginLeft: `${summary.offsetPct}%`,
                width: `${summary.widthPct}%`,
              }}
            />
          </div>
          <span className="text-[10.5px] font-bold tracking-normal text-text-3">
            {summary.label}
          </span>
        </>
      ) : null}
      {unknown && !editing ? (
        <span className="text-[10.5px] font-bold tracking-normal text-text-3">
          진도를 기록하거나 「고치기」로 직접 고르세요
        </span>
      ) : null}
      {editing ? (
        <div className="mt-2">
          <UnitRangePicker
            units={units}
            startUnitId={startUnitId || null}
            endUnitId={endUnitId || null}
            onChange={onChangeRange}
          />
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  initialClassId?: string;
  initialStudentId?: string;
};

export function GenerateSetup({ initialClassId, initialStudentId }: Props) {
  const form = useGenerateSetup({ initialClassId, initialStudentId });

  return (
    <main className="px-8 py-6">
      <h1 className="text-[15px] font-black">출제 설정</h1>
      {form.loadError ? (
        <p className="mt-4 text-[12.5px] text-g-red-text">{form.loadError}</p>
      ) : null}
      {!form.ready && !form.loadError ? (
        <p className="mt-4 text-[12.5px] text-text-2">불러오는 중</p>
      ) : null}
      {form.ready ? (
        <form
          className="mt-6 grid max-w-none gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.generate();
          }}
        >
          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
            반
            <select
              className={FIELD_CLASS}
              value={form.classId}
              onChange={(event) => form.selectClass(event.target.value)}
            >
              {form.classes.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
            학생
            <select
              className={FIELD_CLASS}
              value={form.studentId}
              onChange={(event) => form.setStudentId(event.target.value)}
            >
              <option value="">반 전체</option>
              {form.students.map((item) => (
                <option key={item.id} value={item.id}>
                  {item.name}
                </option>
              ))}
            </select>
          </label>

          <fieldset className="grid gap-2">
            <legend className="text-[10px] font-extrabold tracking-[1.2px] text-text-2">
              유형
            </legend>
            <div className="flex gap-4 text-[12.5px] font-bold">
              <label className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="testType"
                  value="daily"
                  checked={form.testType === "daily"}
                  onChange={() => form.setTestType("daily")}
                />
                일일테스트
              </label>
              <label className="inline-flex min-h-11 items-center gap-2">
                <input
                  type="radio"
                  name="testType"
                  value="review"
                  checked={form.testType === "review"}
                  onChange={() => form.setTestType("review")}
                />
                확인테스트
              </label>
            </div>
          </fieldset>

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
            시행일
            <Input
              type="date"
              value={form.testDate}
              onChange={(event) => form.setTestDate(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
            문항 수
            <Input
              type="number"
              min={1}
              max={30}
              value={form.problemCount}
              onChange={(event) =>
                form.setProblemCount(Number(event.target.value))
              }
            />
          </label>

          <div className="grid grid-cols-3 gap-3">
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
              하
              <Input
                type="number"
                min={0}
                value={form.easy}
                onChange={(event) => form.setEasy(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
              중
              <Input
                type="number"
                min={0}
                value={form.mid}
                onChange={(event) => form.setMid(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-text-2">
              상
              <Input
                type="number"
                min={0}
                value={form.hard}
                onChange={(event) => form.setHard(Number(event.target.value))}
              />
            </label>
          </div>

          {form.testType === "review" ? (
            <RangeField
              units={form.units}
              startUnitId={form.rangeStartUnitId}
              endUnitId={form.rangeEndUnitId}
              editing={form.rangeEditing}
              unknown={form.rangeUnknown}
              onToggleEdit={() => form.setRangeEditing(!form.rangeEditing)}
              onChangeRange={form.setRange}
            />
          ) : null}

          {form.insufficient ? (
            <div
              role="alert"
              className="border border-g-red bg-white px-4 py-3 text-[12.5px]"
            >
              <p>{form.insufficient.message}</p>
              <p className="mt-1 font-bold text-g-red-text">
                가용 {form.insufficient.available} / 필요{" "}
                {form.insufficient.required}
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="primary"
                  disabled={form.busy}
                  onClick={() => void form.generateAiDrafts()}
                >
                  AI 생성
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  disabled={form.busy || form.insufficient.available < 1}
                  onClick={form.reduceCount}
                >
                  문항 수 줄이기
                </Button>
              </div>
              {form.generatedPendingCount > 0 ? (
                <p className="mt-3">
                  {form.generatedPendingCount}문항을 생성했습니다. 문제은행에서
                  승격한 뒤 다시 출제하세요.{" "}
                  <Link href="/problems" className="font-bold underline">
                    문제은행
                  </Link>
                </p>
              ) : null}
            </div>
          ) : null}

          {form.submitError ? (
            // role 이 없으면 화면을 못 보는 사용자에겐 실패가 일어나지 않은 것과 같다.
            <p className="text-[12.5px] text-g-red-text" role="alert">
              {form.submitError}
            </p>
          ) : null}

          {/* 확인테스트인데 범위를 못 정했으면 누를 수 없다 — 범위 없이 출제하면
              서버가 400 을 낼 뿐이고, 원장은 무엇을 고쳐야 하는지 모른다. */}
          <Button
            type="submit"
            variant="primary"
            disabled={
              form.busy ||
              (form.testType === "review" &&
                (!form.rangeStartUnitId || !form.rangeEndUnitId))
            }
          >
            출제
          </Button>
        </form>
      ) : null}
    </main>
  );
}
