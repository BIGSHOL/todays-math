"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { basisLine, BlueprintPanel } from "./BlueprintPanel";
import type { ExamRoundDetail } from "./examScreen.contract";
import { ExamChrome } from "./ExamChrome";
import { loadExamRound } from "./examApi";
import { PipelineDots } from "./PipelineDots";
import { StudentScoreTable } from "./StudentScoreTable";
import {
  ddayLabel,
  roundJudgement,
  roundTitle,
  stageViews,
} from "./viewModel";

/**
 * 회차 상세 — **예측 | 실측 좌우 대조** (D-40 확정).
 *
 * 보정 루프가 화면 골격 그 자체다. 시험 전에는 오른쪽이 비어 있고, 그 상태가 정상임이
 * 드러나야 한다. 상단 4단계 띠는 계기판과 같은 문법을 유지한다(05 §8.2).
 */
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; detail: ExamRoundDetail };

export function RoundDetail({
  roundId,
  today,
}: {
  roundId: string;
  today?: Date;
}) {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadExamRound(roundId)
      .then((detail) => {
        if (!cancelled) setState({ status: "ready", detail });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", message: "회차를 불러오지 못했습니다" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [roundId]);

  if (state.status !== "ready") {
    return (
      <ExamChrome>
        <div className="px-7 py-8 text-[13px] text-muted">
          {state.status === "loading" ? "불러오는 중" : state.message}
        </div>
      </ExamChrome>
    );
  }

  const { detail } = state;
  const { summary } = detail;
  const judgement = roundJudgement(summary);
  const stages = stageViews(summary.stages, judgement.available);
  const dday = ddayLabel(summary.examDate, today);
  const title = roundTitle(summary);

  return (
    <ExamChrome>
      <div className="px-5 pt-4 pb-8">
        <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 border-b border-divider pb-3">
          <Link href="/exam" className="text-[12.5px] font-bold text-muted">
            {/* 꺾쇠는 장식이다 — 링크 이름에 섞이면 스크린 리더가 "‹ 목록"으로 읽는다. */}
            <span aria-hidden="true">‹ </span>목록
          </Link>
          <h1 className="text-[17px] font-black tracking-[-0.01em]">{title}</h1>
          <span className="font-mono text-[14px] font-bold tabular-nums">
            {dday ?? "일정 미정"}
          </span>
        </div>

        <div className="py-3">
          <PipelineDots stages={stages} />
        </div>

        <div className="grid grid-cols-1 gap-x-8 gap-y-6 border-t border-divider pt-4 md:grid-cols-2">
          <BlueprintPanel
            label="예측"
            blueprint={detail.predictedBlueprint}
            judgement={judgement}
            emptyText="아직 청사진을 내지 않았습니다"
            basisText={basisLine(summary.evidenceCount, summary.confidence)}
          />
          <BlueprintPanel
            label="실측"
            blueprint={detail.observedBlueprint}
            emptyText="실측 없음 — 시험 전입니다"
          />
        </div>

        <StudentScoreTable
          students={detail.students}
          roundAvailable={judgement.available}
          caption={`${title} · 예측 대비 실측`}
        />

        <p className="mt-4 border-t border-divider pt-3 text-[12.5px] text-muted tabular-nums">
          {detail.engineVersion
            ? `엔진 ${detail.engineVersion} · 근거 ${summary.evidenceCount}회차`
            : "엔진 미실행"}
        </p>
      </div>
    </ExamChrome>
  );
}
