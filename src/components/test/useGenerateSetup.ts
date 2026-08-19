"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import type { ClassEntity, StudentEntity } from "@/contracts/class.contract";
import type { TestType } from "@/contracts/common.contract";
import type { UnitEntity } from "@/contracts/unit.contract";

/**
 * 계약 스키마는 **런타임 값으로 정적 import 하지 않는다** (성능 수리 C-1).
 *
 * 이 훅은 5개 계약 모듈에서 6개 스키마를 정적으로 끌어와 출제 설정 화면 초기
 * 번들에 zod + 계약 모듈(279KB)을 얹고 있었다. 여기 검증은 전부 `fetch` 응답
 * (또는 사용자 제출) 이후라 그 시점에 불러도 늦지 않다. 검증은 그대로 남는다.
 */
const classContract = () => import("@/contracts/class.contract");
const commonContract = () => import("@/contracts/common.contract");
const problemContract = () => import("@/contracts/problem.contract");
const testContract = () => import("@/contracts/test.contract");
const unitContract = () => import("@/contracts/unit.contract");

export type InsufficientState = {
  unitId: string;
  available: number;
  required: number;
  message: string;
};

type Props = {
  initialClassId?: string;
  initialStudentId?: string;
};

function todayIso() {
  const now = new Date();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${now.getFullYear()}-${month}-${day}`;
}

function applyClass(
  cls: ClassEntity | undefined,
  setProblemCount: (n: number) => void,
  setEasy: (n: number) => void,
  setMid: (n: number) => void,
  setHard: (n: number) => void,
) {
  if (!cls) return;
  setProblemCount(cls.defaultProblemCount);
  setEasy(cls.difficultyRatio.easy);
  setMid(cls.difficultyRatio.mid);
  setHard(cls.difficultyRatio.hard);
}

function fitDifficultyRatio(
  ratio: { easy: number; mid: number; hard: number },
  count: number,
) {
  const keys = ["easy", "mid", "hard"] as const;
  const total = keys.reduce((sum, key) => sum + ratio[key], 0);
  if (total <= 0) return { easy: 0, mid: count, hard: 0 };

  const scaled = keys.map((key) => ({
    key,
    exact: (ratio[key] * count) / total,
  }));
  const result = {
    easy: Math.floor(scaled[0]!.exact),
    mid: Math.floor(scaled[1]!.exact),
    hard: Math.floor(scaled[2]!.exact),
  };
  let remaining = count - result.easy - result.mid - result.hard;
  scaled
    .sort((a, b) => (b.exact % 1) - (a.exact % 1))
    .forEach(({ key }) => {
      if (remaining > 0) {
        result[key] += 1;
        remaining -= 1;
      }
    });
  return result;
}

export function useGenerateSetup({ initialClassId, initialStudentId }: Props) {
  const router = useRouter();
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [units, setUnits] = useState<UnitEntity[]>([]);
  const [students, setStudents] = useState<StudentEntity[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [classId, setClassId] = useState("");
  const [studentId, setStudentId] = useState("");
  const [testType, setTestType] = useState<TestType>("daily");
  const [testDate, setTestDate] = useState(todayIso);
  const [problemCount, setProblemCount] = useState(8);
  const [easy, setEasy] = useState(3);
  const [mid, setMid] = useState(4);
  const [hard, setHard] = useState(1);
  const [rangeStartUnitId, setRangeStartUnitId] = useState("");
  const [rangeEndUnitId, setRangeEndUnitId] = useState("");
  /** 「고치기」를 눌러 3열 피커를 펼쳤는가 (S-04 C안 — 평소에는 한 줄이다). */
  const [rangeEditing, setRangeEditing] = useState(false);
  /**
   * 서버가 범위를 못 냈다(진도 기록 없음). **여기서 지어내지 않는다** —
   * 예전 기본값(초1 첫 소단원 ~ 미적분2 마지막)이 바로 그 지어냄이었고,
   * 손대지 않고 출제하면 다섯 학년이 섞인 시험지가 조용히 나왔다.
   */
  const [rangeUnknown, setRangeUnknown] = useState(false);
  const [insufficient, setInsufficient] = useState<InsufficientState | null>(
    null,
  );
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [generatedPendingCount, setGeneratedPendingCount] = useState(0);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      fetch("/api/classes?page=1&pageSize=100"),
      fetch("/api/units"),
    ])
      .then(async ([classRes, unitRes]) => {
        if (!classRes.ok || !unitRes.ok) {
          throw new Error("목록을 불러오지 못했습니다");
        }
        const [{ classListResponseSchema }, { unitListResponseSchema }] =
          await Promise.all([classContract(), unitContract()]);
        const classBody = classListResponseSchema.parse(await classRes.json());
        const unitBody = unitListResponseSchema.parse(await unitRes.json());
        if (cancelled) return;
        setClasses(classBody.data);
        setUnits(unitBody.data);
        const nextClass =
          classBody.data.find((item) => item.id === initialClassId) ??
          classBody.data[0];
        if (nextClass) {
          setClassId(nextClass.id);
          applyClass(nextClass, setProblemCount, setEasy, setMid, setHard);
        }
        // ⚠️ 여기서 범위 기본값을 **정하지 않는다.** 예전에는 `units[0]`(초1 첫
        //    소단원) ~ `units[마지막]`(미적분2 마지막)을 넣었다 — 그게 전 교육과정
        //    735단원짜리 확인테스트를 오류 없이 만들던 자리다. 범위는 진도가 정하고,
        //    그 판정은 서버(`/api/tests/default-range`)에 한 벌만 둔다.
        setReady(true);
      })
      .catch(() => {
        if (!cancelled) setLoadError("반 목록을 불러오지 못했습니다");
      });
    return () => {
      cancelled = true;
    };
  }, [initialClassId]);

  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    fetch(`/api/students?classId=${classId}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        const { studentListResponseSchema } = await classContract();
        return studentListResponseSchema.parse(await res.json());
      })
      .then((body) => {
        if (cancelled) return;
        setStudents(body.data);
        const keep =
          initialStudentId &&
          body.data.some((item) => item.id === initialStudentId)
            ? initialStudentId
            : "";
        setStudentId(keep);
      })
      .catch(() => {
        if (!cancelled) setStudents([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, initialStudentId]);

  /**
   * 확인테스트 기본 범위 — **진도가 정한다**(원장님 확정 2026-08-19).
   * 반·학생이 바뀌면 다시 묻는다. 원장이 「고치기」로 고른 값은 그때 함께 버려진다 —
   * 다른 반의 범위를 물려받는 것이 더 위험하다.
   */
  useEffect(() => {
    if (!classId) return;
    let cancelled = false;
    setRangeEditing(false);
    const query = new URLSearchParams({ classId });
    if (studentId) query.set("studentId", studentId);
    fetch(`/api/tests/default-range?${query.toString()}`)
      .then(async (res) => {
        if (!res.ok) throw new Error("fail");
        const { defaultReviewRangeResponseSchema } = await testContract();
        return defaultReviewRangeResponseSchema.parse(await res.json());
      })
      .then((body) => {
        if (cancelled) return;
        if (!body.data) {
          setRangeUnknown(true);
          setRangeStartUnitId("");
          setRangeEndUnitId("");
          return;
        }
        setRangeUnknown(false);
        setRangeStartUnitId(body.data.rangeStartUnitId);
        setRangeEndUnitId(body.data.rangeEndUnitId);
      })
      .catch(() => {
        if (cancelled) return;
        setRangeUnknown(true);
        setRangeStartUnitId("");
        setRangeEndUnitId("");
      });
    return () => {
      cancelled = true;
    };
  }, [classId, studentId]);

  const selectClass = useCallback(
    (nextId: string) => {
      setClassId(nextId);
      applyClass(
        classes.find((item) => item.id === nextId),
        setProblemCount,
        setEasy,
        setMid,
        setHard,
      );
      setInsufficient(null);
      setSubmitError(null);
    },
    [classes],
  );

  const generate = useCallback(
    async (countOverride?: number) => {
      if (!classId) return;
      const count = countOverride ?? problemCount;
      const difficultyRatio =
        countOverride === undefined
          ? { easy, mid, hard }
          : fitDifficultyRatio({ easy, mid, hard }, count);
      if (countOverride !== undefined) {
        setProblemCount(countOverride);
        setEasy(difficultyRatio.easy);
        setMid(difficultyRatio.mid);
        setHard(difficultyRatio.hard);
      }
      if (testType === "review" && (!rangeStartUnitId || !rangeEndUnitId)) {
        setInsufficient(null);
        setSubmitError("진도 기록이 없어 범위를 정하지 못했습니다");
        return;
      }
      if (
        difficultyRatio.easy + difficultyRatio.mid + difficultyRatio.hard !==
        count
      ) {
        setInsufficient(null);
        setSubmitError("난이도 배분의 합이 문항 수와 같아야 합니다");
        return;
      }
      setBusy(true);
      setSubmitError(null);
      // 새 시도를 시작하면 지난 부족 안내는 즉시 지운다. 안 지우면 다른 사유로
      // 재실패했을 때 옛 가용/필요 숫자와 「AI 생성」이 새 오류와 나란히 남아
      // 원장이 엉뚱한 버튼을 누른다.
      setInsufficient(null);
      try {
        const res = await fetch("/api/tests/generate", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            classId,
            ...(studentId ? { studentId } : {}),
            testType,
            testDate,
            problemCount: count,
            difficultyRatio,
            ...(testType === "review"
              ? { rangeStartUnitId, rangeEndUnitId }
              : {}),
          }),
        });
        const json: unknown = await res.json();
        const [
          {
            insufficientProblemsErrorResponseSchema,
            testGenerateResponseSchema,
          },
          { errorResponseSchema },
        ] = await Promise.all([testContract(), commonContract()]);
        if (res.status === 422) {
          const parsed =
            insufficientProblemsErrorResponseSchema.safeParse(json);
          if (parsed.success) {
            setInsufficient({
              ...parsed.data.error.details,
              message: parsed.data.error.message,
            });
            return;
          }
        }
        if (!res.ok) {
          const parsed = errorResponseSchema.safeParse(json);
          setSubmitError(
            parsed.success ? parsed.data.error.message : "출제하지 못했습니다",
          );
          return;
        }
        const ok = testGenerateResponseSchema.parse(json);
        setInsufficient(null);
        router.push(`/tests/${ok.data.test.id}`);
      } catch {
        setSubmitError("출제하지 못했습니다");
      } finally {
        setBusy(false);
      }
    },
    [
      classId,
      studentId,
      testType,
      testDate,
      problemCount,
      easy,
      mid,
      hard,
      rangeStartUnitId,
      rangeEndUnitId,
      router,
    ],
  );

  const generateAiDrafts = useCallback(async () => {
    if (!insufficient) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const count = Math.min(
        10,
        Math.max(1, insufficient.required - insufficient.available),
      );
      const res = await fetch("/api/problems/generate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          unitId: insufficient.unitId,
          difficulty: "mid",
          count,
        }),
      });
      if (!res.ok) {
        setSubmitError("AI 문제 생성에 실패했습니다");
        return;
      }
      const { problemGenerateResponseSchema } = await problemContract();
      const created = problemGenerateResponseSchema.parse(await res.json());
      setGeneratedPendingCount(created.data.length);
    } catch {
      setSubmitError("AI 문제 생성에 실패했습니다");
    } finally {
      setBusy(false);
    }
  }, [insufficient]);

  const reduceCount = useCallback(() => {
    if (!insufficient || insufficient.available < 1) return;
    void generate(insufficient.available);
  }, [generate, insufficient]);

  return {
    classes,
    units,
    students,
    ready,
    loadError,
    classId,
    studentId,
    testType,
    testDate,
    problemCount,
    easy,
    mid,
    hard,
    rangeStartUnitId,
    rangeEndUnitId,
    rangeEditing,
    rangeUnknown,
    insufficient,
    generatedPendingCount,
    submitError,
    busy,
    setStudentId,
    setTestType,
    setTestDate,
    setProblemCount,
    setEasy,
    setMid,
    setHard,
    setRangeStartUnitId,
    setRangeEndUnitId,
    setRangeEditing,
    selectClass,
    generate,
    generateAiDrafts,
    reduceCount,
  };
}
