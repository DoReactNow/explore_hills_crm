import { EmployeeDetailPage } from "@/modules/identity/ui/EmployeeDetailPage";

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <EmployeeDetailPage id={id} />;
}
