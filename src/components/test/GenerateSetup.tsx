"use client";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";

import { FIELD_CLASS } from "./labels";
import { useGenerateSetup } from "./useGenerateSetup";

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
              <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
                시작 소단원
                <select
                  className={FIELD_CLASS}
                  value={form.rangeStartUnitId}
                  onChange={(event) =>
                    form.setRangeStartUnitId(event.target.value)
                  }
                >
                  {form.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.section}
                    </option>
                  ))}
                </select>
              </label>
              <label className="grid gap-1 text-[10px] font-extrabold tracking-[1.2px] text-[#6A6A68]">
                끝 소단원
                <select
                  className={FIELD_CLASS}
                  value={form.rangeEndUnitId}
                  onChange={(event) =>
                    form.setRangeEndUnitId(event.target.value)
                  }
                >
                  {form.units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.section}
                    </option>
                  ))}
                </select>
              </label>
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
                  onClick={() => void form.generateAiThenRetry()}
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
            </div>
          ) : null}

          {form.submitError ? (
            <p className="text-[12.5px] text-[#C5221F]">{form.submitError}</p>
          ) : null}

          <Button type="submit" variant="primary" disabled={form.busy}>
            출제
          </Button>
        </form>
      ) : null}
    </main>
  );
}
