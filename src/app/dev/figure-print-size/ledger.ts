/**
 * **실측 원장**(`그림벡터` 트랙 산출물)을 읽는다 — 그리고 못 읽으면 **말한다**.
 *
 * ## 이 파일이 생긴 이유
 *
 * 1차 화면은 원장을 «URL → 객체» 지도로 읽었는데, 실제로 온 원장은
 * `{"행": [{figure, width_mm, …}]}` 다. 모양이 달라 원장이 **있어도** 한 장도 못 읽고
 * `catch` 로 떨어져 **조용히 가정값으로** 내려갔다. 화면 문구는 정직했지만 다음 사람은
 * 그걸 「원장이 아직 없구나」로 읽는다 — 실은 있는데 못 읽는 것이었다.
 *
 * 그래서 여기서는 **실패가 침묵하지 않는다**:
 *   · 모양이 다르면 `ok:false` 와 **사유**를 돌려준다
 *   · 행이 0이면 성공이 아니다 — 「실측인데 0장」은 실측이 아니다
 *   · 쓸 수 없는 행이 섞이면 **몇 개를 버렸는지 센다**(분모를 먼저 지킨다)
 *
 * ## mm 는 **제품 술어**로 거른다
 *
 * `parseFigureSourceMm`(지면·자가 쓰는 바로 그 함수)을 통과한 값만 `sourceMm` 이 된다.
 * 화면이 지면보다 무르면 「화면에서는 40mm 인데 지면에서는 안 그려지는」 값이 생기고,
 * 그건 원장님이 못 가려낸다.
 *
 * ⚠️ 원장 파일 자체는 `.gitignore` 라 저장소에 없다. 없는 것이 **정상 상태**이므로
 *    화면은 그때 「원장이 없다」고 적고 **멈춘다.** 가정값으로 내려가지 않는다.
 */
import { parseFigureSourceMm } from "@/lib/figurePrintSize";

/** `그림벡터` 트랙 산출물. 커밋되지 않는다(7MB). */
export const RECT_LEDGER_PATH = "scripts/qa/reports/figure-rect-ledger.json";

export interface ProofLabel {
  /** 화면에 붙이는 짧은 이름. */
  name: string;
  /** 무엇을 근거로 그렇게 말하는가. */
  detail: string;
  /** 근거의 세기. 클수록 세다. **모르는 갈래는 0** — 아는 척하지 않는다. */
  rank: number;
}

/**
 * 원장의 `match` 값 네 갈래.
 *
 * 🔴 `png-dpi` 는 나머지 셋과 **다른 물건**이다. 원본 지면에서의 **자리(rect)를 못 찾은**
 *    행이고, 크기는 「우리가 그 PNG 를 몇 dpi 로 렌더했다」는 기록에서 나온다. 자리를 못
 *    찾았다는 것은 「그 칸이 정말 그 그림이었나」를 겹쳐 대조로 확인 못 했다는 뜻이다.
 *    2차 지시서의 요약이 이 갈래를 안 셌다(10,656+2,017+1,025=13,698 인데 mm 는 14,391장) —
 *    차이 693장이 정확히 이 갈래다. 그래서 화면이 이걸 따로 적는다.
 */
const PROOF_LABELS: Record<string, ProofLabel> = {
  bytes: {
    name: "원본 바이트가 같다",
    detail:
      "원본 PDF 에 박혀 있던 이미지와 우리 파일의 바이트가 md5 로 같다. 그 자리가 그 그림인 것이 확정된다.",
    rank: 4,
  },
  "rect+png-dpi": {
    name: "원본 지면과 겹쳐 대조",
    detail:
      "원본 지면의 그 칸을 다시 렌더해 우리 파일과 겹쳐 봤다. 어긋남이 문턱 아래일 때만 통과했다.",
    rank: 3,
  },
  dims: {
    name: "픽셀 치수가 맞는다",
    detail:
      "그 칸을 우리가 잘랐던 dpi 로 렌더하면 픽셀 치수가 디스크 파일과 같다. 바이트까지는 안 봤다.",
    rank: 2,
  },
  "png-dpi": {
    name: "PNG 에 적힌 dpi 로만 구했다",
    detail:
      "원본 지면에서의 자리(rect)를 못 찾았다. 크기는 우리가 그 PNG 를 렌더한 dpi 에서 나온 값이라, 그 칸이 정말 그 그림이었는지는 확인하지 못했다.",
    rank: 1,
  },
};

const UNKNOWN_PROOF: ProofLabel = {
  name: "모르는 증명 갈래",
  detail:
    "원장이 우리가 모르는 `match` 값을 적어 보냈다. 근거의 세기를 모르므로 «안다»고 세지 않는다.",
  rank: 0,
};

export function proofLabel(proof: string | null | undefined): ProofLabel {
  if (!proof) return UNKNOWN_PROOF;
  return PROOF_LABELS[proof] ?? UNKNOWN_PROOF;
}

export interface FigureLedgerEntry {
  /** `/figures/…` — 지면이 쓰는 그 URL. */
  url: string;
  /** **제품 술어를 통과한** 원본 물리 폭(mm). 못 통과하면 `null`. */
  sourceMm: number | null;
  /** 원장에 적혀 있던 값 그대로. 지우면 왜 «모른다»인지 화면에서 못 본다. */
  rawWidthMm: number | null;
  heightMm: number | null;
  proof: string | null;
  kind: string | null;
  nativeXref: boolean | null;
  renderDpi: number | null;
  currentPx: [number, number] | null;
  /** 못 구한 사유. 원장이 사유별로 적어 뒀다. */
  note: string | null;
}

export interface FigureRectLedgerOk {
  ok: true;
  entries: Map<string, FigureLedgerEntry>;
  /** 읽힌 행 수. */
  total: number;
  /** 그중 mm 를 아는 행. */
  withMm: number;
  /** 읽을 수 없어 버린 행 — **조용히 줄지 않게** 센다. */
  dropped: number;
  proofCounts: Record<string, number>;
}

export interface FigureRectLedgerFail {
  ok: false;
  reason: string;
}

export type FigureRectLedger = FigureRectLedgerOk | FigureRectLedgerFail;

const asNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === "string" && value.length > 0 ? value : null;

function asPixels(value: unknown): [number, number] | null {
  if (!Array.isArray(value) || value.length < 2) return null;
  const width = asNumber(value[0]);
  const height = asNumber(value[1]);
  if (width == null || height == null || width <= 0 || height <= 0) return null;
  return [width, height];
}

export function parseFigureRectLedger(raw: string): FigureRectLedger {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "원장을 JSON 으로 못 읽는다 — 파일이 깨졌다." };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { ok: false, reason: "원장의 맨 바깥이 객체가 아니다." };
  }
  const rows = (parsed as Record<string, unknown>)["행"];
  if (!Array.isArray(rows)) {
    const keys = Object.keys(parsed as Record<string, unknown>).slice(0, 6);
    return {
      ok: false,
      reason: `원장 모양이 다르다 — 「행」 배열이 없다. 맨 바깥 키: ${
        keys.length > 0 ? keys.join(", ") : "(없음)"
      }`,
    };
  }
  if (rows.length === 0) {
    return { ok: false, reason: "원장에 「행」이 하나도 없다." };
  }

  const entries = new Map<string, FigureLedgerEntry>();
  const proofCounts: Record<string, number> = {};
  let withMm = 0;
  let dropped = 0;

  for (const row of rows) {
    if (!row || typeof row !== "object" || Array.isArray(row)) {
      dropped += 1;
      continue;
    }
    const record = row as Record<string, unknown>;
    const figure = asString(record["figure"]);
    if (!figure) {
      dropped += 1;
      continue;
    }
    const rawWidthMm = asNumber(record["width_mm"]);
    // 🔴 **제품 술어**로 거른다 — 지면이 안 받는 값을 화면이 받으면 둘이 갈라진다.
    const [checked] = parseFigureSourceMm(
      1,
      rawWidthMm == null ? null : [rawWidthMm],
    );
    const proof = asString(record["match"]);
    if (rawWidthMm != null) {
      withMm += 1;
      const key = proof ?? "(적히지 않음)";
      proofCounts[key] = (proofCounts[key] ?? 0) + 1;
    }
    entries.set(`/figures/${figure}`, {
      url: `/figures/${figure}`,
      sourceMm: checked ?? null,
      rawWidthMm,
      heightMm: asNumber(record["height_mm"]),
      proof,
      kind: asString(record["kind"]),
      nativeXref:
        typeof record["native_xref"] === "boolean"
          ? (record["native_xref"] as boolean)
          : null,
      renderDpi: asNumber(record["render_dpi"]),
      currentPx: asPixels(record["current_px"]),
      note: asString(record["note"]),
    });
  }

  if (entries.size === 0) {
    return {
      ok: false,
      reason: `원장에 「행」은 ${rows.length}개인데 figure 가 있는 행이 하나도 없다.`,
    };
  }
  return {
    ok: true,
    entries,
    total: entries.size,
    withMm,
    dropped,
    proofCounts,
  };
}
