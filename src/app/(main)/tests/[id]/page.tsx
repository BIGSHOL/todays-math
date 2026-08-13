import { AppChrome } from "@/components/chrome/AppChrome";
import { TestReview } from "@/components/test/TestReview";

export default async function TestReviewPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <AppChrome>
      <TestReview testId={id} />
    </AppChrome>
  );
}
