// PROTOTYPE (#112): throwaway. The invoice panel's payment block, in the
// staff shell so it reads against the real sidebar and header.
import { Suspense } from "react";

import { PanelPrototype } from "@/components/prototype-pay-now/panel-prototype";

export default function Page() {
  return (
    <Suspense>
      <PanelPrototype />
    </Suspense>
  );
}
