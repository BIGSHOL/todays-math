"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  classListResponseSchema,
  studentListResponseSchema,
  type ClassEntity,
  type StudentEntity,
} from "@/contracts/class.contract";
import type { TestType } from "@/contracts/common.contract";
import { errorResponseSchema } from "@/contracts/common.contract";
import { problemGenerateResponseSchema } from "@/contracts/problem.contract";
import {
  insufficientProblemsErrorResponseSchema,
  testGenerateResponseSchema,
} from "@/contracts/test.contract";
import {
  unitListResponseSchema,
  type UnitEntity,
} from "@/contracts/unit.contract";

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
        const first = unitBody.data[0];
        const last = unitBody.data[unitBody.data.length - 1];
        if (first) setRangeStartUnitId(first.id);
        if (last) setRangeEndUnitId(last.id);
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
      if (countOverride !== undefined) setProblemCount(countOverride);
      setBusy(true);
      setSubmitError(null);
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
            difficultyRatio: { easy, mid, hard },
            ...(testType === "review"
              ? { rangeStartUnitId, rangeEndUnitId }
              : {}),
          }),
        });
        const json: unknown = await res.json();
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
    selectClass,
    generate,
    generateAiDrafts,
    reduceCount,
  };
}
