import { StaffShell } from "@/components/staff-shell";
import { Dashboard } from "@/components/dashboard";
import { auth } from '@clerk/nextjs/server';
export default async function Page() {
  await auth.protect();
  return (
    <StaffShell>
      <Dashboard />
    </StaffShell>
  );
}
