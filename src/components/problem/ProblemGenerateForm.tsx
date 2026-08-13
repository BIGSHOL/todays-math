"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { Difficulty } from "@/contracts/common.contract";
import { generateProblems } from "@/lib/problem/problemApi";
import type { MockUnit } from "@/mocks/data/units";

import { FieldSelect } from "./FieldSelect";

type Props = {
  units: MockUnit[];
  defaultUnitId: string;
  onCreated: (
    count: number,
    problems: Awaited<ReturnType<typeof generateProblems>>["data"],
  ) => void;
  onError: (message: string) => void;
};

export function ProblemGenerateForm({
  units,
  defaultUnitId,
  onCreated,
  onError,
}: Props) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const difficulty = form.get("difficulty");
    setPending(true);
    try {
      const body = await generateProblems({
        unitId: String(form.get("unitId") ?? ""),
        difficulty: (difficulty === "hard" || difficulty === "mid"
          ? difficulty
          : "easy") as Difficulty,
        count: 1,
      });
      onCreated(body.data.length, body.data);
    } catch {
      onError("생성에 실패했습니다");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label="생성"
      className="mt-4 border border-[#C2C2C0] bg-white p-4"
      onSubmit={handleSubmit}
    >
      <div className="flex flex-wrap gap-3">
        <FieldSelect
          name="unitId"
          label="단원"
          defaultValue={defaultUnitId}
          required
        >
          {units.map((unit) => (
            <option key={unit.id} value={unit.id}>
              {unit.section}
            </option>
          ))}
        </FieldSelect>
        <FieldSelect
          name="difficulty"
          label="난이도"
          defaultValue="easy"
          required
        >
          <option value="easy">쉬움</option>
          <option value="mid">보통</option>
          <option value="hard">어려움</option>
        </FieldSelect>
      </div>
      <div className="mt-4">
        <Button type="submit" disabled={pending}>
          생성하기
        </Button>
      </div>
    </form>
  );
}
