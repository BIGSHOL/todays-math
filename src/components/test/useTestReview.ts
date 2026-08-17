"use client";

import { useCallback, useEffect, useState } from "react";

import type { TestEntity, TestProblemItem } from "@/contracts/test.contract";

/**
 * 계약 스키마는 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 * 검수 화면의 검증은 모두 `fetch` 응답 이후라, 초기 번들에서 zod + 계약 모듈
 * (279KB)을 빼도 검증은 하나도 줄지 않는다.
 */
const testContract = () => import("@/contracts/test.contract");

type ReadyState = {
  status: "ready";
  test: TestEntity;
  problems: TestProblemItem[];
};

type ReviewState =
  | { status: "loading" }
  | { status: "notfound" }
  | { status: "error"; message: string }
  | ReadyState;

export function useTestReview(testId: string) {
  const [state, setState] = useState<ReviewState>({ status: "loading" });
  const [replacingSeq, setReplacingSeq] = useState<number | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/tests/${testId}`)
      .then(async (res) => {
        if (res.status === 404) {
          if (!cancelled) setState({ status: "notfound" });
          return;
        }
        if (!res.ok) throw new Error("fail");
        const { testDetailResponseSchema } = await testContract();
        const body = testDetailResponseSchema.parse(await res.json());
        if (!cancelled) {
          setState({
            status: "ready",
            test: body.data.test,
            problems: body.data.problems,
          });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setState({
            status: "error",
            message: "테스트를 불러오지 못했습니다",
          });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [testId]);

  const replace = useCallback(
    async (seq: number) => {
      if (state.status !== "ready" || state.test.status !== "draft") return;
      setReplacingSeq(seq);
      setActionError(null);
      try {
        const res = await fetch(`/api/tests/${testId}/problems/${seq}`, {
          method: "PUT",
        });
        if (!res.ok) {
          setActionError("문제를 교체하지 못했습니다");
          return;
        }
        const { testProblemReplaceResponseSchema } = await testContract();
        const body = testProblemReplaceResponseSchema.parse(await res.json());
        setState((prev) => {
          if (prev.status !== "ready") return prev;
          return {
            status: "ready",
            test: body.data.test,
            problems: prev.problems.map((item) =>
              item.orderIndex === seq ? body.data.problem : item,
            ),
          };
        });
      } catch {
        setActionError("문제를 교체하지 못했습니다");
      } finally {
        setReplacingSeq(null);
      }
    },
    [state, testId],
  );

  const confirm = useCallback(async () => {
    if (state.status !== "ready" || state.test.status !== "draft") return;
    setConfirming(true);
    setActionError(null);
    try {
      const res = await fetch(`/api/tests/${testId}/confirm`, {
        method: "POST",
      });
      if (!res.ok) {
        setActionError("테스트를 확정하지 못했습니다");
        return;
      }
      const { testConfirmResponseSchema } = await testContract();
      const body = testConfirmResponseSchema.parse(await res.json());
      setState((prev) =>
        prev.status === "ready" ? { ...prev, test: body.data } : prev,
      );
    } catch {
      setActionError("테스트를 확정하지 못했습니다");
    } finally {
      setConfirming(false);
    }
  }, [state, testId]);

  const replacedCount =
    state.status === "ready"
      ? state.problems.filter((item) => item.replaced).length
      : 0;

  return {
    state,
    replace,
    confirm,
    replacingSeq,
    confirming,
    replacedCount,
    actionError,
  };
}
