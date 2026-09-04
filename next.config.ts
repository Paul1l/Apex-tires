import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";
import { businessConfig } from "./config/business";
import { assertProductionBusinessConfig } from "./config/business-validation";

assertProductionBusinessConfig(businessConfig);

const nextConfig: NextConfig = {
  agentRules: false,
  reactStrictMode: true,
  images: {
    unoptimized: true,
  },
  experimental: {
    useTypeScriptCli: true,
  },
};

export default nextConfig;

initOpenNextCloudflareForDev();
