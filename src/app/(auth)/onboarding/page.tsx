import { connection } from "next/server";

import { OnboardingForm } from "@/components/onboarding/OnboardingForm";
import { db } from "@/lib/db";

export default async function OnboardingPage() {
  await connection();

  const units = await db.unit.findMany({
    orderBy: { orderIndex: "asc" },
    select: { id: true, grade: true, chapter: true, section: true },
  });

  return <OnboardingForm units={units} />;
}
