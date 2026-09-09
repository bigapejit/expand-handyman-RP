import { SignUp } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
export default function Page() {
  return (
    <main className="grid min-h-dvh place-content-center gap-8 p-6">
      <Brand />
      <SignUp
        routing="path"
        path="/sign-up"
        signInUrl="/sign-in"
        fallbackRedirectUrl="/"
      />
    </main>
  );
}
