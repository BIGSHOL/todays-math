"use client";

import { useEffect, useState } from "react";

import { AppChrome } from "@/components/chrome/AppChrome";

import type { ExamRoundSummary } from "./examScreen.contract";
import { loadExamRounds } from "./examApi";
import { RoundRow } from "./RoundRow";
import { sortRounds } from "./viewModel";

/**
 * '오늘의 시험' 계기판 (S-T70 · D-39 확정).
 *
 * 진행 중인 내신 회차를 큰 순번 + D-day 로 세운다. 반·진도 단위로 도는 '오늘의 수학'과 달리
 * 이 축의 단위는 **학교 내신 1회차**다(05 §8.7).
 */
type LoadState =
  | { status: "loading" }
  | { status: "error"; message: string }
  | { status: "ready"; rounds: ExamRoundSummary[] };

export function ExamDashboard() {
  const [state, setState] = useState<LoadState>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadExamRounds()
      .then((rounds) => {
        if (!cancelled) setState({ status: "ready", rounds });
      })
      .catch(() => {
        if (!cancelled) {
          setState({ status: "error", message: "회차를 불러오지 못했습니다" });
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status !== "ready") {
    return (
      <AppChrome tab="exam">
        <div className="px-7 py-8 text-[13px] text-muted">
          {state.status === "loading" ? "불러오는 중" : state.message}
        </div>
      </AppChrome>
    );
  }

  const rounds = sortRounds(state.rounds);

  return (
    <AppChrome tab="exam">
      <div className="px-5 pt-4 pb-6">
        {/* 시안의 우측 「+ 새 회차」는 회차 생성 API·폼이 없어 넣지 않았다.
            누르면 아무 일도 안 하는 컨트롤을 두는 것이 D-30 이 막는 바로 그 버그다. */}
        <h1 className="border-b border-divider pb-2 text-xs font-black tracking-[0.08em] text-muted uppercase">
          진행 중인 내신
        </h1>
        {rounds.length === 0 ? (
          // 실측이 아직 0건이라 당분간은 이 상태가 기본이다. 빈 화면 대신 이유를 적는다.
          <p className="py-8 text-[13px] text-muted">
            아직 회차가 없습니다. 예측을 실행하면 여기에 쌓입니다.
          </p>
        ) : (
          rounds.map((round, i) => (
            <RoundRow key={round.id} round={round} index={i + 1} />
          ))
        )}
      </div>
    </AppChrome>
  );
}
