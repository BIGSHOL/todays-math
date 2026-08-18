"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui/Button";
import type { ProblemEntity } from "@/contracts/problem.contract";
import { transformProblems } from "@/lib/problem/problemApi";

import { FieldSelect } from "./FieldSelect";

type Props = {
  problems: ProblemEntity[];
  onCreated: (
    count: number,
    created: Awaited<ReturnType<typeof transformProblems>>["data"],
  ) => void;
  onError: (message: string) => void;
};

export function ProblemTransformForm({ problems, onCreated, onError }: Props) {
  const [pending, setPending] = useState(false);
  const defaultOrigin = problems[0]?.id ?? "";

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setPending(true);
    try {
      const body = await transformProblems({
        originProblemId: String(form.get("originProblemId") ?? ""),
        count: 1,
      });
      onCreated(body.data.length, body.data);
    } catch {
      onError("변형에 실패했습니다");
    } finally {
      setPending(false);
    }
  }

  return (
    <form
      aria-label="변형"
      className="mt-4 border border-divider bg-white p-4"
      onSubmit={handleSubmit}
    >
      <FieldSelect
        name="originProblemId"
        label="원본 문제"
        defaultValue={defaultOrigin}
        required
      >
        {problems.map((problem) => (
          <option key={problem.id} value={problem.id}>
            {problem.content.replace(/\$[^$]*\$/g, "").slice(0, 28)}
          </option>
        ))}
      </FieldSelect>
      <div className="mt-4">
        <Button type="submit" variant="secondary" disabled={pending}>
          변형하기
        </Button>
      </div>
    </form>
  );
}
