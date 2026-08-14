import { connection } from "next/server";

import { AppChrome } from "@/components/chrome/AppChrome";
import { ClassManage } from "@/components/class/ClassManage";
import { db } from "@/lib/db";

export default async function ClassesPage() {
  await connection();

  const units = await db.unit.findMany({
    orderBy: { orderIndex: "asc" },
    select: {
      id: true,
      grade: true,
      chapter: true,
      section: true,
      orderIndex: true,
    },
  });

  return (
    <AppChrome>
      <ClassManage units={units} />
    </AppChrome>
  );
}
