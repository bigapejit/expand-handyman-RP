import type { NextConfig } from "next";
const config: NextConfig = {
  // The default bottom-left badge sits on the sidebar's account card.
  devIndicators: { position: "bottom-right" },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      // PROTOTYPE (#112): the sketches may be framed by their own phone-width
      // page (app/prototype/pay-now/phone) for headless screenshots. Never
      // ships: the branch is thrown away.
      {
        source: "/prototype/:path*",
        headers: [{ key: "X-Frame-Options", value: "SAMEORIGIN" }],
      },
    ];
  },
};
export default config;
