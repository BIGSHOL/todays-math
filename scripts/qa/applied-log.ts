/**
 * **실제로 갱신한 행만** 단계별로 따로 남긴다 (되돌리기용).
 *
 * 왜 단계별로 나누나: 트랙 C 가 1차 4,629행과 2차 214행을 한 파일에 섞었다가
 * 되돌릴 때 어느 쪽 것인지 못 가른 적이 있다. 단계마다 파일을 따로 두면
 * **그 단계만 정확히 되돌릴 수 있다.**
 *
 * 드라이런 산출물(`reports/`)과 달리 이건 **커밋한다** — `reports/` 는 gitignore 라
 * 다른 컴퓨터에서 되돌릴 수 없기 때문이다.
 */
import { mkdir, writeFile } from "node:fs/promises";

const DIR = "scripts/qa/applied";

export interface AppliedRow {
  id: string;
  externalId: string | null;
  before: string;
  after: string;
}

/**
 * @param phase 단계 이름. 파일명이 된다 (`phase1-glyph` → `applied/phase1-glyph.json`).
 * @param tool  어느 도구가 썼는지. 되돌릴 때 무엇으로 되돌리는지 알아야 한다.
 * @param rows  **실제로 update 가 나간 행만.** 건너뛴 행은 넣지 마라.
 */
export async function writeAppliedLog(
  phase: string,
  tool: string,
  rows: AppliedRow[],
): Promise<string> {
  await mkdir(DIR, { recursive: true });
  const path = `${DIR}/${phase}.json`;
  await writeFile(
    path,
    JSON.stringify(
      {
        phase,
        tool,
        appliedAt: new Date().toISOString(),
        count: rows.length,
        rows,
      },
      null,
      1,
    ),
    "utf-8",
  );
  return path;
}
