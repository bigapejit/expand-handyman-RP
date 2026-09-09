"use client";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-md p-10">
      <h1 className="text-xl font-semibold">We couldn’t open this page</h1>
      <p className="my-4 text-sm text-muted-foreground">
        Check your connection and try again.
      </p>
      <Button onClick={reset}>Try again</Button>
    </main>
  );
}
