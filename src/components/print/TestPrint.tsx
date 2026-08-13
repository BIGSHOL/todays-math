"use client";

import { useState } from "react";

import { PrintAnswerKeyPage } from "@/components/print/PrintAnswerKeyPage";
import { JaseupTemplate } from "@/components/print/templates/JaseupTemplate";
import type {
  JaseupPrintMeta,
  TestPrintDocument,
} from "@/components/print/types";
import { paginateAnswerKey } from "@/lib/printLayout";
import { packProblems } from "@/lib/printPack";

import styles from "./TestPrint.module.css";

export type { TestPrintDocument } from "@/components/print/types";

type PrintMode = "questions" | "answers";

interface TestPrintProps {
  data: TestPrintDocument;
  initialMode?: PrintMode;
}

const TEST_TYPE_LABEL: Record<TestPrintDocument["testType"], string> = {
  daily: "일일테스트",
  review: "확인테스트",
};

export function TestPrint({ data, initialMode = "questions" }: TestPrintProps) {
  const [mode, setMode] = useState<PrintMode>(initialMode);
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const title = `${TEST_TYPE_LABEL[data.testType]} · ${data.section}`;
  const questionPages = packProblems(data.problems);
  const answerPages = paginateAnswerKey(data.problems);
  const meta: JaseupPrintMeta = {
    academyName: "오늘의수학",
    title,
    examDate: data.testDate,
    todayGoal: data.todayGoal,
    conceptNote: data.conceptNote,
  };

  async function printCurrentMode() {
    setIsPrinting(true);
    setPrintError(null);

    try {
      const response = await fetch(`/api/tests/${data.testId}/print`, {
        method: "POST",
      });
      if (!response.ok) {
        setPrintError("확정된 테스트만 인쇄할 수 있습니다.");
        return;
      }
      window.print();
    } catch {
      setPrintError("인쇄 준비 중 오류가 발생했습니다.");
    } finally {
      setIsPrinting(false);
    }
  }

  return (
    <main className={styles.previewShell}>
      <header className={styles.previewToolbar}>
        <div>
          <div className={styles.previewEyebrow}>PRINT PREVIEW</div>
          <h1>{title}</h1>
          <p>
            {data.className} · {data.problems.length}문항
          </p>
        </div>
        <div className={styles.toolbarActions}>
          <div
            aria-label="미리보기 종류"
            className={styles.modeSwitch}
            role="group"
          >
            <button
              aria-pressed={mode === "questions"}
              onClick={() => setMode("questions")}
              type="button"
            >
              문제지
            </button>
            <button
              aria-pressed={mode === "answers"}
              onClick={() => setMode("answers")}
              type="button"
            >
              정답지
            </button>
          </div>
          <button
            className={styles.printButton}
            disabled={isPrinting}
            onClick={() => void printCurrentMode()}
            type="button"
          >
            {isPrinting ? "인쇄 준비 중" : "인쇄하기"}
          </button>
        </div>
        {printError ? <p className={styles.printError}>{printError}</p> : null}
      </header>

      <div className={styles.pageGallery}>
        {mode === "questions"
          ? questionPages.map((page, index) => (
              <JaseupTemplate
                key={`questions-${index + 1}`}
                meta={meta}
                page={index + 1}
                problems={page.problems}
                startingNumber={page.startingNumber}
              />
            ))
          : answerPages.map((page, index) => (
              <PrintAnswerKeyPage
                allProblems={data.problems}
                key={`answers-${index + 1}`}
                page={index + 1}
                pageProblems={page.problems}
                startingNumber={page.startingNumber}
                testTitle={title}
                totalPages={answerPages.length}
              />
            ))}
      </div>
    </main>
  );
}
