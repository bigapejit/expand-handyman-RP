import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
const publicRoute = createRouteMatcher([
  "/sign-in(.*)",
  "/sign-up(.*)",
  "/sign/(.*)",
]);
export default clerkMiddleware(async (auth, req) => {
  if (!publicRoute(req)) await auth.protect();
});
export const config = {
  matcher: [
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|mjs|pdf|txt)).*)",
    "/(api|trpc)(.*)",
  ],
};
