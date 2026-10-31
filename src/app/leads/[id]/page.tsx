import { LeadDetailPage } from "@/modules/leads/ui/LeadDetailPage";
import { LeadChatPanel } from "@/modules/messaging/ui/LeadChatPanel";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <LeadDetailPage id={id} chat={<LeadChatPanel leadId={id} />} />;
}
