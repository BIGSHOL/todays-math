"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import type { ProblemCreateRequest } from "@/contracts/problem.contract";
import type { UnitEntity } from "@/contracts/unit.contract";
import { createProblem } from "@/lib/problem/problemApi";

import { FieldSelect } from "./FieldSelect";
import { PROBLEM_TYPES } from "./labels";

type Props = {
  units: UnitEntity[];
  defaultUnitId: string;
  onCreated: (
    count: number,
    problems: Awaited<ReturnType<typeof createProblem>>["data"][],
  ) => void;
  onError: (message: string) => void;
};

export function ProblemRegisterForm({
  units,
  defaultUnitId,
  onCreated,
  onError,
}: Props) {
  const [pending, setPending] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const input: ProblemCreateRequest = {
      unitId: String(form.get("unitId") ?? ""),
      source: form.get("source") === "past_exam" ? "past_exam" : "manual",
      difficulty:
        form.get("difficulty") === "hard"
          ? "hard"
          : form.get("difficulty") === "mid"
            ? "mid"
            : "easy",
      problemType:
        (form.get("problemType") as ProblemCreateRequest["problemType"]) ??
        "계산",
      content: String(form.get("content") ?? ""),
      answer: String(form.get("answer") ?? ""),
      pool: "shared",
    };
    setPending(true);
    try {
      const body = await createProblem(input);
      onCreated(1, [body.data]);
    } catch {
      onError("등록에 실패했습니다");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label="등록"
      className="mt-4 border border-divider bg-white p-4"
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
        <FieldSelect name="source" label="출처" defaultValue="manual" required>
          <option value="manual">자작</option>
          <option value="past_exam">기출</option>
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
        <FieldSelect
          name="problemType"
          label="유형"
          defaultValue="계산"
          required
        >
          {PROBLEM_TYPES.map((type) => (
            <option key={type} value={type}>
              {type}
            </option>
          ))}
        </FieldSelect>
      </div>
      <label className="mt-3 flex flex-col gap-1 text-[10.5px] font-black tracking-[1.5px] text-text-2">
        본문
        <textarea
          name="content"
          required
          rows={3}
          className="border border-divider bg-white px-3 py-2 text-[12.5px] text-ink focus:border-g-blue focus:outline focus:outline-2 focus:outline-g-blue"
        />
      </label>
      <label className="mt-3 flex flex-col gap-1 text-[10.5px] font-black tracking-[1.5px] text-text-2">
        정답
        <Input name="answer" required />
      </label>
      <div className="mt-4">
        <Button type="submit" variant="ink" disabled={pending}>
          등록하기
        </Button>
      </div>
    </form>
  );
}
