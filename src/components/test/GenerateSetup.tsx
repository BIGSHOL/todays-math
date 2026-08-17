"use client";

import { memo } from "react";
import Link from "next/link";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { UnitEntity } from "@/contracts/unit.contract";

import { FIELD_CLASS } from "./labels";
import { useGenerateSetup } from "./useGenerateSetup";

const LABEL_CLASS =
  "grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]";

type UnitSelectProps = {
  label: string;
  value: string;
  units: UnitEntity[];
  onChange: (value: string) => void;
};

/**
 * 소단원 목록은 실제로 1,472개다. 이 select 를 폼 안에 그대로 두면 **문항 수
 * 칸에 글자 하나 칠 때마다** option 1,472개가 두 벌씩 다시 조정된다.
 * memo 로 잘라 두면 값이 안 바뀐 select 는 React 가 아예 들어가지 않는다.
 * (`setRangeStartUnitId` 는 useState 의 setter 라 참조가 고정이므로 memo 가 산다 —
 *  여기에 화살표 함수를 새로 만들어 넘기면 이 수리가 통째로 죽는다.)
 *
 * 같은 저장소 ClassManage 의 AddClassForm 처럼 "입력 상태를 격리"하는 것과 목적은
 * 같지만 방식이 다르다. 여기 값들은 훅과 **양방향**이다 — selectClass 가 반의
 * 기본 문항 수·난이도를, reduceCount 가 줄인 문항 수를 되쓴다. 상태를 로컬로
 * 내리면 그 되쓰기와 동기화가 필요해져 화면 동작이 달라질 위험이 있어,
 * 대신 무거운 목록 쪽을 잘라 냈다. 그려지는 DOM 은 전과 같다.
 */
const UnitSelect = memo(function UnitSelect({
  label,
  value,
  units,
  onChange,
}: UnitSelectProps) {
  return (
    <label className={LABEL_CLASS}>
      {label}
      <select
        className={FIELD_CLASS}
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        {units.map((unit) => (
          <option key={unit.id} value={unit.id}>
            {unit.section}
          </option>
        ))}
      </select>
    </label>
  );
});

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
        <p className="mt-4 text-[12.5px] text-[#C5221F]">{form.loadError}</p>
      ) : null}
      {!form.ready && !form.loadError ? (
        <p className="mt-4 text-[12.5px] text-[#6A6A68]">불러오는 중</p>
      ) : null}
      {form.ready ? (
        <form
          className="mt-6 grid max-w-none gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void form.generate();
          }}
        >
          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
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

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
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
            <legend className="text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
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

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
            시행일
            <Input
              type="date"
              value={form.testDate}
              onChange={(event) => form.setTestDate(event.target.value)}
            />
          </label>

          <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
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
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
              하
              <Input
                type="number"
                min={0}
                value={form.easy}
                onChange={(event) => form.setEasy(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
              중
              <Input
                type="number"
                min={0}
                value={form.mid}
                onChange={(event) => form.setMid(Number(event.target.value))}
              />
            </label>
            <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
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
            <div className="grid gap-4 sm:grid-cols-2">
              <UnitSelect
                label="시작 소단원"
                value={form.rangeStartUnitId}
                units={form.units}
                onChange={form.setRangeStartUnitId}
              />
              <UnitSelect
                label="끝 소단원"
                value={form.rangeEndUnitId}
                units={form.units}
                onChange={form.setRangeEndUnitId}
              />
            </div>
          ) : null}

          {form.insufficient ? (
            <div
              role="alert"
              className="border border-[#EA4335] bg-white px-4 py-3 text-[12.5px]"
            >
              <p>{form.insufficient.message}</p>
              <p className="mt-1 font-bold text-[#C5221F]">
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
            <p className="text-[12.5px] text-[#C5221F]" role="alert">
              {form.submitError}
            </p>
          ) : null}

          <Button type="submit" variant="primary" disabled={form.busy}>
            출제
          </Button>
        </form>
      ) : null}
    </main>
  );
}
