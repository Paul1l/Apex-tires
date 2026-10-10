import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { businessConfig } from "./config/business";
import { assertProductionBusinessConfig } from "./config/business-validation";

assertProductionBusinessConfig(businessConfig);

// Baseline security headers for every route, applied by `next start` (VDS)
// and by the OpenNext worker (Cloudflare) from the routes manifest. The CSP
// only restricts framing, <base>, form targets and plugins: script-src and
// img-src stay open until a nonce-based policy for Next.js and Yandex Metrika
// is introduced (product images are data:image/svg+xml URLs).
// Keep in sync with public/_headers (static assets on Cloudflare).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  {
    key: "Content-Security-Policy",
    value: "frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'",
  },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), payment=()",
  },
];

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  poweredByHeader: false,
  images: {
    unoptimized: true,
  },
  experimental: {
    useTypeScriptCli: true,
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
