import { useEffect, useState } from "react";

import type { ClassEntity, StudentEntity } from "@/contracts/class.contract";
import {
  advanceProgress,
  createClass,
  createStudent,
  fetchClasses,
  fetchProgress,
  fetchStudents,
  recordProgress,
} from "@/lib/class/classApi";

export function useClassManage() {
  const [classes, setClasses] = useState<ClassEntity[]>([]);
  const [students, setStudents] = useState<StudentEntity[]>([]);
  const [selectedClassId, setSelectedClassId] = useState("");
  const [currentUnitId, setCurrentUnitId] = useState<string | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">(
    "loading",
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchClasses()
      .then((rows) => {
        if (cancelled) return;
        setClasses(rows);
        setSelectedClassId(rows[0]?.id ?? "");
        setStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setStatus("error");
        setError("목록을 불러오지 못했습니다");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!selectedClassId) return;
    let cancelled = false;
    Promise.all([
      fetchStudents(selectedClassId),
      fetchProgress(selectedClassId),
    ])
      .then(([nextStudents, progress]) => {
        if (cancelled) return;
        setStudents(nextStudents);
        setCurrentUnitId(progress?.unitId ?? null);
      })
      .catch(() => {
        if (!cancelled) setError("목록을 불러오지 못했습니다");
      });
    return () => {
      cancelled = true;
    };
  }, [selectedClassId]);

  async function advance() {
    if (!selectedClassId) return;
    setError(null);
    try {
      const next = await advanceProgress(selectedClassId);
      setCurrentUnitId(next.unitId);
    } catch {
      setError("다음 소단원이 없습니다");
    }
  }

  async function selectUnit(unitId: string) {
    if (!selectedClassId) return;
    setError(null);
    try {
      const next = await recordProgress(selectedClassId, unitId);
      setCurrentUnitId(next.unitId);
    } catch {
      setError("진도를 저장하지 못했습니다");
    }
  }

  async function addStudent(name: string) {
    if (!selectedClassId || !name.trim()) return;
    const created = await createStudent(selectedClassId, name.trim());
    setStudents((prev) => [...prev, created]);
  }

  async function addClass(name: string, grade: string) {
    if (!name.trim() || !grade.trim()) return;
    const created = await createClass(name.trim(), grade.trim());
    setClasses((prev) => [...prev, created]);
    selectClass(created.id);
  }

  function selectClass(classId: string) {
    setStudents([]);
    setCurrentUnitId(null);
    setError(null);
    setSelectedClassId(classId);
  }

  return {
    classes,
    students,
    selectedClassId,
    currentUnitId,
    status,
    error,
    selectClass,
    advance,
    selectUnit,
    addStudent,
    addClass,
  };
}
