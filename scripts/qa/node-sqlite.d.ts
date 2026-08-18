/**
 * `node:sqlite` 최소 타입 선언.
 *
 * Node 22+ 에 내장된 모듈인데 이 저장소의 `@types/node` 는 20 대라 선언이 없다
 * (`@types/node` 를 올리면 Next/Prisma 쪽 타입까지 함께 움직이므로, 스크립트 하나 때문에
 * 올리지 않는다). 여기서 **쓰는 만큼만** 선언한다 — 읽기 전용 조회 두 가지뿐이다.
 *
 * 쓰는 곳: `scripts/qa/verify-external-id-referent.ts` (testchanger `exam_index.db` 대조).
 */
declare module "node:sqlite" {
  export interface StatementSync {
    all(...params: unknown[]): unknown[];
    get(...params: unknown[]): unknown;
  }

  export class DatabaseSync {
    constructor(path: string, options?: { readOnly?: boolean });
    prepare(sql: string): StatementSync;
    close(): void;
  }
}
