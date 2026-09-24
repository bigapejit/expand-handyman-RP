// PROTOTYPE (#130): throwaway. Money landing in the bank matched to
// invoices, in the staff shell so it reads against the real sidebar and
// header. `?variant=A|B|C`, `?mode=confirm|auto`, `?relay=ok|login`.
import { Suspense } from "react";

import { MoneyInPrototype } from "@/components/prototype-money-in/money-in-prototype";

export default function Page() {
  return (
    <Suspense>
      <MoneyInPrototype />
    </Suspense>
  );
}
