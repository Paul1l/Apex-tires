import type { NextConfig } from "next";
import { PHASE_DEVELOPMENT_SERVER } from "next/constants";
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

// Preview (demo prices): every response, including non-HTML (assets, API
// JSON), is noindex. robots.txt allows crawling on preview so robots can
// read it.
const previewIndexingHeaders =
  businessConfig.deploymentStage === "production"
    ? []
    : [{ key: "X-Robots-Tag", value: "noindex, nofollow" }];

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
    return [
      { source: "/:path*", headers: [...securityHeaders, ...previewIndexingHeaders] },
      // Product photos uploaded in the admin (app/uploads/[...path]): never
      // a document, even if a file slipped past the content check. Listed
      // after the baseline rule: for the same key the last matching rule wins.
      {
        source: "/uploads/:path*",
        headers: [{ key: "Content-Security-Policy", value: "default-src 'none'; sandbox; frame-ancestors 'none'" }],
      },
    ];
  },
};

// Wrangler bindings for local development only (`next dev`), as documented by
// @opennextjs/cloudflare. Calling it during `next build` or `next start` would
// spawn workerd inside the production Node.js process (VDS) and make
// getCloudflareContext return wrangler's env instead of the container env.
// The Cloudflare worker gets its context from the OpenNext worker entrypoint.
export default function createNextConfig(phase: string): NextConfig {
  if (phase === PHASE_DEVELOPMENT_SERVER) {
    void initOpenNextCloudflareForDev();
  }
  return nextConfig;
}
