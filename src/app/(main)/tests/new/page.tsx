import { AppChrome } from "@/components/chrome/AppChrome";
import { GenerateSetup } from "@/components/test/GenerateSetup";

export default async function NewTestPage({
  searchParams,
}: {
  searchParams: Promise<{ classId?: string; studentId?: string }>;
}) {
  const query = await searchParams;
  return (
    <AppChrome>
      <GenerateSetup
        initialClassId={query.classId}
        initialStudentId={query.studentId}
      />
    </AppChrome>
  );
}
