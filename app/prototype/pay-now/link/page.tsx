// PROTOTYPE (#112): throwaway. The invoice link with Pay now on it.
import { Suspense } from "react";

import { LinkPrototype } from "@/components/prototype-pay-now/link-prototype";

export default function Page() {
  return (
    <Suspense>
      <LinkPrototype />
    </Suspense>
  );
}
