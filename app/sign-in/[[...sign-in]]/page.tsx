import { SignIn } from "@clerk/nextjs";
import { Brand } from "@/components/brand";
export default function Page() {
  return (
    <main className="grid min-h-dvh place-content-center gap-8 bg-muted/40 p-6">
      <Brand />
      <SignIn
        routing="path"
        path="/sign-in"
        signUpUrl="/sign-up"
        fallbackRedirectUrl="/"
      />
      <p className="text-center text-xs text-muted-foreground">
        Expand Handyman · Owner access
      </p>
    </main>
  );
}
