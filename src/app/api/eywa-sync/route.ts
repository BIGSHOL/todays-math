/**
 * POST /api/eywa-sync — 「지금 가져오기」 (계획 §8-1).
 *
 * 본체는 `runEywaSync` — CLI(`scripts/sync/sync-eywa.ts`)와 **같은 함수**다.
 * 여기가 다른 것은 원장 sink 뿐: 서버리스는 파일을 못 쓰므로 `EywaSyncLedger`
 * 표에 남기고, 최근 14회만 유지한다(그보다 오래된 되돌리기는 다음 동기화가
 * 전체 교체로 어차피 무의미하다 — eywa 가 정본, D-31 확정).
 *
 * · 동시 실행: runEywaSync 안의 advisory lock 이 직렬화한다(둘째는 기다렸다
 *   전체 교체를 다시 한다 — 낭비지만 안전).
 * · 소요: 수집 ~1분 + 적용 ~1분. `maxDuration = 300`. Vercel 요금제가 60초로
 *   막으면 이 버튼은 운영에서 타임아웃 난다 — 그때는 로컬 cron 이 대신한다
 *   (계획 §8-2). 로컬·개발에서는 제한이 없다.
 */
import { eywaSyncResponseSchema } from "@/contracts/test.contract";
import { jsonError, jsonOk, unauthorizedError } from "@/lib/apiResponse";
import { db } from "@/lib/db";
import { runEywaSync } from "@/lib/eywa/runSync";
import { getSessionUser } from "@/lib/session";

export const maxDuration = 300;

const KEEP_LEDGERS = 14;

/**
 * 실행부 — POST(세션)와 cron(GET + CRON_SECRET)이 **같은 이 함수**를 부른다.
 * 문지기만 다르고 실행·원장·응답은 한 벌이다.
 */
export async function executeSyncResponse() {
  try {
    const summary = await runEywaSync({
      prisma: db,
      apply: true,
      writeLedger: async (runId, payload) => {
        await db.eywaSyncLedger.create({
          data: { runId, payload: payload as object },
        });
        // runId 는 ISO 시각을 담아 사전순 == 시간순 — createdAt 이 같은 밀리초로
        // 동률일 때(테스트가 실제로 잡았다) 최신이 지워지는 것을 막는 보조 열쇠다.
        const old = await db.eywaSyncLedger.findMany({
          orderBy: [{ createdAt: "desc" }, { runId: "desc" }],
          skip: KEEP_LEDGERS,
          select: { id: true },
        });
        if (old.length > 0)
          await db.eywaSyncLedger.deleteMany({
            where: { id: { in: old.map((o) => o.id) } },
          });
      },
    });
    return jsonOk(eywaSyncResponseSchema, {
      data: {
        runId: summary.runId,
        students: summary.rosterTotal,
        classes: summary.classes,
        progressRows: summary.appliedCounts?.created ?? 0,
        unresolvedLines: summary.unresolvedLines,
        ambiguous: summary.ambiguous,
      },
    });
  } catch (error) {
    // eywa 쪽 장애(HTTP 503 등)·전송 미설정 — 사유를 화면까지 보낸다(침묵 금지).
    console.error("[POST /api/eywa-sync]", error);
    const message =
      error instanceof Error ? error.message : "동기화에 실패했습니다.";
    return jsonError("EYWA_SYNC_FAILED", message, 502);
  }
}

export async function POST() {
  const session = await getSessionUser();
  if (!session) return unauthorizedError();
  return executeSyncResponse();
}
