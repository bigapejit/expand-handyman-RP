// PROTOTYPE (#112): throwaway. The front door: where each sketch is.
export default function Page() {
  const link = "underline underline-offset-2 hover:text-fuchsia-700";
  return (
    <main className="mx-auto max-w-xl space-y-6 p-8 font-sans text-sm text-slate-800">
      <h1 className="text-xl font-semibold">Pay now prototype, ticket #112</h1>
      <ol className="list-decimal space-y-3 pl-5">
        <li>
          <a className={link} href="/prototype/pay-now/link">
            The invoice link
          </a>
          : three places Pay now could sit (A, B, C), four readings of the invoice. Press a way
          to pay to walk it through a stand-in checkout.
        </li>
        <li>
          <a className={link} href="/prototype/pay-now/approved">
            The signing link right after signing
          </a>
          : email only, or a way to pay the deposit on the spot (A, B, C).
        </li>
        <li>
          <a className={link} href="/prototype/pay-now/panel">
            The invoice panel
          </a>
          , in the staff shell (sign in as usual): the payment block for each kind of payment
          (A, B).
        </li>
      </ol>
      <p className="text-slate-500">
        The purple bar flips variants; the arrow keys do too. Nothing here saves.
      </p>
    </main>
  );
}
