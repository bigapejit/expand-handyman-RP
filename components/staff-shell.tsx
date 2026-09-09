"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { UserButton } from "@clerk/nextjs";
import { useConvexAuth, useQuery } from "convex/react";
import { FileText, Users, LockKeyhole } from "lucide-react";
import { api } from "@/convex/_generated/api";
import { Brand } from "./brand";
import { cn } from "@/lib/utils";
export function StaffShell({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const auth = useConvexAuth();
  const access = useQuery(
    api.documents.access,
    auth.isAuthenticated ? {} : "skip",
  );
  return (
    <div className="min-h-dvh md:grid md:grid-cols-[224px_1fr]">
      <aside className="border-b bg-sidebar md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:border-r md:border-b-0">
        <div className="flex items-center justify-between px-6 py-6">
          <Brand />
          <div className="md:hidden">
            <UserButton />
          </div>
        </div>
        <div className="px-3 pb-3">
          <p className="hidden px-3 py-3 text-[10px] font-medium uppercase tracking-widest text-muted-foreground md:block">
            Workspace
          </p>
          <nav className="flex gap-1 md:flex-col">
            {[
              { href: "/", label: "Documents", icon: FileText },
              { href: "/customers", label: "Customers", icon: Users },
            ].map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm text-muted-foreground hover:bg-accent",
                  (item.href === "/"
                    ? path === "/" || path.startsWith("/documents")
                    : path.startsWith(item.href)) &&
                    "bg-accent font-medium text-foreground",
                )}
              >
                <item.icon size={17} />
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
        <div className="mt-auto hidden items-center gap-3 border-t p-5 md:flex">
          <UserButton />
          <div>
            <p className="text-xs font-medium">Staff workspace</p>
            <p className="text-[11px] text-muted-foreground">Expand Handyman</p>
          </div>
        </div>
      </aside>
      <div className="min-w-0">
        {auth.isLoading || access === undefined ? (
          <div className="p-10 text-sm text-muted-foreground">
            Loading your workspace…
          </div>
        ) : access.owner ? (
          children
        ) : (
          <div className="mx-auto max-w-md p-12 text-center">
            <LockKeyhole className="mx-auto mb-4" />
            <h1 className="text-xl font-semibold">Owner access only</h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Sign in with your authorized Expand Handyman account to open this
              workspace.
            </p>
            <div className="mt-5 flex justify-center">
              <UserButton />
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
