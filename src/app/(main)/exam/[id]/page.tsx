import { RoundDetail } from "@/components/exam/RoundDetail";

export default async function ExamRoundPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <RoundDetail roundId={id} />;
}
