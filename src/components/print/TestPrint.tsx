"use client";

import { useState } from "react";

import { PrintAnswerKeyPage } from "@/components/print/PrintAnswerKeyPage";
import { JaseupTemplate } from "@/components/print/templates/JaseupTemplate";
import type {
  JaseupPrintMeta,
  TestPrintDocument,
} from "@/components/print/types";
import { paginateAnswerKey } from "@/lib/printLayout";
import { assessOverflowRisk } from "@/lib/printOverflow";
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

/**
 * 인쇄 실패 사유. **서버가 준 문구가 정본**이다 — 라우트가 401/404/409 마다 다른 말을
 * 이미 보내는데, 예전엔 클라이언트가 전부 "확정된 테스트만 인쇄할 수 있습니다."로
 * 뭉개서 세션이 끊긴 원장이 검수 화면을 헤맸다.
 */
const PRINT_ERROR_BY_STATUS: Record<number, string> = {
  401: "로그인이 풀렸습니다. 다시 로그인해 주세요.",
  403: "이 테스트를 인쇄할 권한이 없습니다.",
  404: "테스트를 찾을 수 없습니다.",
  409: "확정된 테스트만 인쇄할 수 있습니다.",
};

async function readPrintError(response: Response): Promise<string> {
  try {
    const body: unknown = await response.json();
    const message = (body as { error?: { message?: unknown } })?.error?.message;
    if (typeof message === "string" && message.trim()) return message;
  } catch {
    // 본문이 없거나 JSON 이 아니면 상태 코드로 갈라 말한다.
  }
  return (
    PRINT_ERROR_BY_STATUS[response.status] ??
    `서버 오류로 인쇄하지 못했습니다. (${response.status})`
  );
}

export function TestPrint({ data, initialMode = "questions" }: TestPrintProps) {
  const [mode, setMode] = useState<PrintMode>(initialMode);
  const [printError, setPrintError] = useState<string | null>(null);
  const [isPrinting, setIsPrinting] = useState(false);
  const title = `${TEST_TYPE_LABEL[data.testType]} · ${data.section}`;
  const questionPages = packProblems(data.problems);
  // 지면 형태는 D-07 확정이라 바꾸지 않는다 — 잘릴 만하면 **알리기만** 한다.
  const overflowRisks = assessOverflowRisk(data.problems);
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
        setPrintError(await readPrintError(response));
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
        {printError ? (
          <p className={styles.printError} role="alert">
            {printError}
          </p>
        ) : null}
        {overflowRisks.length ? (
          <p className={styles.printWarning} role="status">
            지면을 넘길 수 있는 문항이 있습니다 —{" "}
            {overflowRisks
              .map((r) => `${r.number}번(${r.reasons.join(", ")})`)
              .join(" · ")}
            . 인쇄 미리보기에서 잘리지 않았는지 확인하십시오.
          </p>
        ) : null}
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
