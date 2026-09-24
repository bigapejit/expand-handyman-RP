// PROTOTYPE (#112): throwaway. The same panel sketch without the staff shell
// or a sign-in, for headless screenshots. The real place to look is
// /prototype/pay-now/panel, inside the shell.
import { Suspense } from "react";

import { PanelPrototype } from "@/components/prototype-pay-now/panel-prototype";

export default function Page() {
  return (
    <div className="p-8">
      <Suspense>
        <PanelPrototype />
      </Suspense>
    </div>
  );
}
