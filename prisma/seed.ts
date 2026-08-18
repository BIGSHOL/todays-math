/**
 * Prisma 시드 — Unit(교육과정 단원) 테이블 적재 (T0.3)
 *
 * 데이터 원본: prisma/seed-data/units.ts (CURRICULUM_UNITS)
 *   — eywa(C:\Creative\eywa\src\features\onescreen\curriculum.ts) 손검증 데이터를 이관·통합.
 *
 * 실행: `npx prisma db seed` (내부적으로 package.json의 `prisma.seed` 설정을 사용)
 *   또는 `npm run db:seed`.
 *   ⚠️ T0.3 시점에는 실행하지 않는다 — DB 마이그레이션/연결 확정 후 실행할 것.
 *
 * Idempotent 전략:
 *   Unit 테이블에 orderIndex 등 자연 유니크 제약이 없어(schema.prisma는 T0.2 소관 — 이 태스크에서
 *   임의로 변경하지 않음) Prisma `upsert`/`createMany({ skipDuplicates })`를 안전하게 쓸 수 없다.
 *   대신 "이미 데이터가 있으면 전량 skip" 전략을 쓴다 — Unit은 Progress/Problem/Test가
 *   `onDelete: Restrict`로 참조하므로(schema.prisma) 서비스 운영 이후에는 삭제 후 재삽입도 위험하다.
 *   교육과정 데이터가 바뀌는 경우(예: 개정 교육과정 반영)는 이 스크립트를 확장하기보다
 *   전용 마이그레이션 스크립트를 별도로 작성하는 것을 권장한다.
 *
 *   향후 개선 제안(T0.2/차기 마이그레이션 담당자용): `Unit.orderIndex`에 `@unique`(또는
 *   `@@unique([grade, chapter, section])`)를 추가하면 `createMany({ skipDuplicates: true })` 또는
 *   `upsert` 기반의 진짜 증분 재시드가 가능해진다.
 */
import { PrismaClient } from "@prisma/client";

// Node 네이티브 TS 실행(strip-types)은 상대 경로에 확장자 명시가 필수
import { CURRICULUM_UNITS } from "./seed-data/units.ts";
import { buildUnitCodePrefixes } from "../src/lib/problemCode.ts";

const prisma = new PrismaClient();

async function seedUnits(): Promise<void> {
  const existingCount = await prisma.unit.count();
  if (existingCount > 0) {
    console.log(
      `[seed:unit] 이미 ${existingCount}건이 존재합니다 — idempotent 정책에 따라 스킵합니다.`,
    );
    return;
  }

  // 문항 코드(D-53)의 «뜻» 부분을 같이 넣는다. 규칙은 `src/lib/problemCode.ts` 한 곳이고
  // 여기서는 그 산출물만 싣는다 — 이 값이 없으면 그 단원의 문항은 코드를 못 받는다
  // (DB 트리거가 조용히 넘어가지 않고 멈춘다).
  const result = await prisma.unit.createMany({
    data: buildUnitCodePrefixes(CURRICULUM_UNITS).map((unit) => ({
      grade: unit.grade,
      chapter: unit.chapter,
      section: unit.section,
      orderIndex: unit.orderIndex,
      problemCodePrefix: unit.prefix,
    })),
  });
  console.log(
    `[seed:unit] ${result.count}건 적재 완료 (총 ${CURRICULUM_UNITS.length}건 중).`,
  );
}

async function main(): Promise<void> {
  await seedUnits();
}

main()
  .catch((error: unknown) => {
    console.error("[seed] 실패:", error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
