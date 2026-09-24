import { Suspense } from "react";

import { StaffPrototype } from "@/components/staff-prototype";

// PROTOTYPE ONLY — throwaway route. See components/staff-prototype.tsx.
export default function StaffPage() {
  return (
    <Suspense>
      <StaffPrototype />
    </Suspense>
  );
}
