"use client";

import { useState, type FormEvent } from "react";

import { StudentList } from "@/components/class/StudentList";
import { ClassTable } from "@/components/class/ClassTable";
import { UnitTreePicker } from "@/components/progress/UnitTreePicker";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { useClassManage } from "@/hooks/useClassManage";
import { findUnit, type UnitNode } from "@/lib/units/groupUnits";

type ClassManageProps = {
  units: UnitNode[];
};

export function ClassManage({ units }: ClassManageProps) {
  const manage = useClassManage();
  const current = findUnit(units, manage.currentUnitId);

  if (manage.status === "loading") {
    return <p className="px-[26px] py-6 text-[12.5px]">불러오는 중</p>;
  }

  if (manage.status === "error") {
    return (
      <p className="px-[26px] py-6 text-[12.5px] text-[#C5221F]">
        {manage.error}
      </p>
    );
  }

  return (
    <main className="px-[26px] py-5">
      <div className="grid grid-cols-1 gap-8 lg:grid-cols-[minmax(0,1fr)_minmax(260px,320px)]">
        <section>
          <ClassTable
            classes={manage.classes}
            selectedClassId={manage.selectedClassId}
            onSelect={manage.selectClass}
          />
          <AddClassForm onAdd={manage.addClass} />
        </section>
        <div>
          <StudentList students={manage.students} />
          {manage.selectedClassId ? (
            <AddStudentForm onAdd={manage.addStudent} />
          ) : null}
        </div>
      </div>

      <section className="mt-8">
        <div className="mb-3 flex flex-wrap items-center gap-3">
          <Button onClick={() => void manage.advance()}>다음 소단원</Button>
          <p className="text-[12.5px] text-[#6A6A68]">
            현재{" "}
            <span className="font-black text-[#161616]">
              {current?.section ?? "없음"}
            </span>
          </p>
          {manage.error ? (
            <p className="text-[12.5px] text-[#C5221F]">{manage.error}</p>
          ) : null}
        </div>
        <UnitTreePicker
          units={units}
          currentUnitId={manage.currentUnitId}
          onSelect={(unitId) => {
            void manage.selectUnit(unitId);
          }}
        />
      </section>
    </main>
  );
}

function AddClassForm({
  onAdd,
}: {
  onAdd: (name: string, grade: string) => Promise<void>;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onAdd(name, grade);
    setName("");
    setGrade("");
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="mt-3 flex gap-2"
    >
      <Input
        aria-label="반 이름"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="반 이름"
        className="min-w-0 flex-1"
      />
      <Input
        aria-label="학년"
        value={grade}
        onChange={(event) => setGrade(event.target.value)}
        placeholder="학년"
        className="max-w-24"
      />
      <Button type="submit" variant="secondary">
        반 추가
      </Button>
    </form>
  );
}

function AddStudentForm({ onAdd }: { onAdd: (name: string) => Promise<void> }) {
  const [name, setName] = useState("");

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    await onAdd(name);
    setName("");
  }

  return (
    <form
      onSubmit={(event) => void handleSubmit(event)}
      className="mt-3 flex gap-2"
    >
      <Input
        aria-label="학생 이름"
        value={name}
        onChange={(event) => setName(event.target.value)}
        placeholder="이름"
        className="min-w-0 flex-1"
      />
      <Button type="submit" variant="secondary">
        등록
      </Button>
    </form>
  );
}
