"use client";

import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { readApiError } from "@/components/onboarding/readApiError";

export type OnboardingUnitOption = {
  id: string;
  grade: string;
  chapter: string;
  section: string;
};

const FIELD_LABEL =
  "mb-1 block text-[10.5px] font-extrabold tracking-[1.2px] text-[#6A6A68]";
const STEP_INDEX =
  "text-[10.5px] font-extrabold tracking-[1.2px] text-[#8A8A88]";
const STEP_TITLE = "mt-1 text-[15px] font-black tracking-[-0.3px]";
const ERROR_TEXT = "text-[11.5px] text-[#C5221F]";
const SELECT_CLASS =
  "h-11 w-full border border-[#C2C2C0] bg-white px-3 text-[12.5px] text-[#161616] focus:border-[#1A73E8] focus:outline focus:outline-2 focus:outline-offset-0 focus:outline-[#1A73E8] disabled:bg-[#E0E0DE]";

function unitLabel(unit: OnboardingUnitOption) {
  return `${unit.grade} · ${unit.section}`;
}

export function OnboardingForm({ units }: { units: OnboardingUnitOption[] }) {
  const router = useRouter();

  const [className, setClassName] = useState("");
  const [grade, setGrade] = useState("");
  const [classId, setClassId] = useState<string | null>(null);
  const [classError, setClassError] = useState("");
  const [classSaving, setClassSaving] = useState(false);

  const [studentName, setStudentName] = useState("");
  const [students, setStudents] = useState<string[]>([]);
  const [studentError, setStudentError] = useState("");
  const [studentSaving, setStudentSaving] = useState(false);

  const [unitId, setUnitId] = useState("");
  const [progressError, setProgressError] = useState("");
  const [progressSaving, setProgressSaving] = useState(false);

  async function handleCreateClass(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = className.trim();
    const gradeValue = grade.trim();
    if (!name) {
      setClassError("반 이름을 입력해주세요.");
      return;
    }
    if (!gradeValue) {
      setClassError("학년을 입력해주세요.");
      return;
    }

    setClassError("");
    setClassSaving(true);
    try {
      const res = await fetch("/api/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, grade: gradeValue }),
      });
      if (!res.ok) {
        setClassError(await readApiError(res));
        return;
      }
      const body = (await res.json()) as { data: { id: string } };
      setClassId(body.data.id);
    } catch {
      setClassError("저장하지 못했습니다.");
    } finally {
      setClassSaving(false);
    }
  }

  async function handleAddStudent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classId) return;
    const name = studentName.trim();
    if (!name) {
      setStudentError("학생 이름을 입력해주세요.");
      return;
    }

    setStudentError("");
    setStudentSaving(true);
    try {
      const res = await fetch("/api/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, name }),
      });
      if (!res.ok) {
        setStudentError(await readApiError(res));
        return;
      }
      setStudents((prev) => [...prev, name]);
      setStudentName("");
    } catch {
      setStudentError("저장하지 못했습니다.");
    } finally {
      setStudentSaving(false);
    }
  }

  async function handleComplete(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!classId || students.length === 0) return;
    if (!unitId) {
      setProgressError("진도를 선택해주세요.");
      return;
    }

    setProgressError("");
    setProgressSaving(true);
    try {
      const res = await fetch("/api/progress", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId, unitId }),
      });
      if (!res.ok) {
        setProgressError(await readApiError(res));
        return;
      }
      router.push("/");
    } catch {
      setProgressError("저장하지 못했습니다.");
    } finally {
      setProgressSaving(false);
    }
  }

  return (
    <div className="w-full max-w-[960px]">
      <h1 className="mb-8 text-[15px] font-black tracking-[-0.3px]">
        초기 설정
      </h1>
      <div className="grid grid-cols-1 gap-8 md:grid-cols-3">
        <section aria-labelledby="onboard-step-1">
          <p className={STEP_INDEX}>1</p>
          <h2 id="onboard-step-1" className={STEP_TITLE}>
            반 만들기
          </h2>
          {classId ? (
            <p className="mt-4 text-[12.5px] font-bold">{className.trim()}</p>
          ) : (
            <form className="mt-4 space-y-3" onSubmit={handleCreateClass}>
              <label className="block">
                <span className={FIELD_LABEL}>반 이름</span>
                <Input
                  value={className}
                  onChange={(event) => setClassName(event.target.value)}
                  maxLength={100}
                  aria-invalid={classError ? true : undefined}
                  className={classError ? "border-[#EA4335]" : ""}
                />
              </label>
              <label className="block">
                <span className={FIELD_LABEL}>학년</span>
                <Input
                  value={grade}
                  onChange={(event) => setGrade(event.target.value)}
                  maxLength={10}
                  aria-invalid={classError ? true : undefined}
                  className={classError ? "border-[#EA4335]" : ""}
                />
              </label>
              {classError ? <p className={ERROR_TEXT}>{classError}</p> : null}
              <Button type="submit" variant="primary" disabled={classSaving}>
                반 만들기
              </Button>
            </form>
          )}
        </section>

        <section
          aria-labelledby="onboard-step-2"
          className={classId ? undefined : "opacity-[0.62]"}
        >
          <p className={STEP_INDEX}>2</p>
          <h2 id="onboard-step-2" className={STEP_TITLE}>
            학생 이름
          </h2>
          <fieldset className="mt-4 space-y-3 border-0 p-0" disabled={!classId}>
            <form className="space-y-3" onSubmit={handleAddStudent}>
              <label className="block">
                <span className={FIELD_LABEL}>이름</span>
                <Input
                  value={studentName}
                  onChange={(event) => setStudentName(event.target.value)}
                  maxLength={50}
                  aria-invalid={studentError ? true : undefined}
                  className={studentError ? "border-[#EA4335]" : ""}
                />
              </label>
              {studentError ? (
                <p className={ERROR_TEXT}>{studentError}</p>
              ) : null}
              <Button
                type="submit"
                variant="secondary"
                disabled={studentSaving}
              >
                추가
              </Button>
            </form>
            {students.length > 0 ? (
              <ul className="space-y-1 text-[12.5px] font-bold">
                {students.map((name) => (
                  <li key={name}>{name}</li>
                ))}
              </ul>
            ) : null}
          </fieldset>
        </section>

        <section
          aria-labelledby="onboard-step-3"
          className={students.length > 0 ? undefined : "opacity-[0.62]"}
        >
          <p className={STEP_INDEX}>3</p>
          <h2 id="onboard-step-3" className={STEP_TITLE}>
            진도
          </h2>
          <fieldset
            className="mt-4 space-y-3 border-0 p-0"
            disabled={students.length === 0}
          >
            <form className="space-y-3" onSubmit={handleComplete}>
              <label className="block">
                <span className={FIELD_LABEL}>소단원</span>
                <select
                  className={SELECT_CLASS}
                  value={unitId}
                  onChange={(event) => setUnitId(event.target.value)}
                  aria-invalid={progressError ? true : undefined}
                >
                  <option value="">소단원 선택</option>
                  {units.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unitLabel(unit)}
                    </option>
                  ))}
                </select>
              </label>
              {progressError ? (
                <p className={ERROR_TEXT}>{progressError}</p>
              ) : null}
              <Button type="submit" variant="ink" disabled={progressSaving}>
                완료
              </Button>
            </form>
          </fieldset>
        </section>
      </div>
    </div>
  );
}
