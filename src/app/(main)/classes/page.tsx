import { AppChrome } from "@/components/chrome/AppChrome";
import { ClassManage } from "@/components/class/ClassManage";
import type { UnitNode } from "@/lib/units/groupUnits";

export default async function ClassesPage() {
  let units: UnitNode[] = [];
  try {
    const { db } = await import("@/lib/db");
    units = await db.unit.findMany({
      orderBy: { orderIndex: "asc" },
      select: {
        id: true,
        grade: true,
        chapter: true,
        section: true,
        orderIndex: true,
      },
    });
  } catch {
    units = [];
  }

  return (
    <AppChrome>
      <ClassManage units={units} />
    </AppChrome>
  );
}
