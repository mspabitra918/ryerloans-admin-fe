import { DetailView } from "@/components/applications/DetailView";

export default async function ApplicationDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  return <DetailView applicationId={id} />;
}
