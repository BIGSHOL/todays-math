import { db } from "@/lib/db";
import { serializeTestProblemItem } from "@/lib/serializers";

export async function loadTestProblemItems(testId: string) {
  const rows = await db.testProblem.findMany({
    where: { testId },
    include: { problem: true },
    orderBy: { orderIndex: "asc" },
  });
  return rows.map(serializeTestProblemItem);
}
