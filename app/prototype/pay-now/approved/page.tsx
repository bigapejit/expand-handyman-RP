// PROTOTYPE (#112): throwaway. The signing link the moment after signing.
import { Suspense } from "react";

import { ApprovedPrototype } from "@/components/prototype-pay-now/approved-prototype";

export default function Page() {
  return (
    <Suspense>
      <ApprovedPrototype />
    </Suspense>
  );
}
