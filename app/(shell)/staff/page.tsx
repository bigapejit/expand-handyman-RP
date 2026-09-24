import { PageHeader } from "@/components/page-header";
import { StaffPage } from "@/components/staff-page";

export default function Page() {
  return (
    <StaffPage
      header={
        <PageHeader
          title="Staff"
          description="Invite-only. Anyone you invite gets the whole console; nobody else can even create an account."
        />
      }
    />
  );
}
