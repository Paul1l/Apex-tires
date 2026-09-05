import type { MetadataRoute } from "next";
import { businessConfig } from "@/config/business";

export default function robots(): MetadataRoute.Robots {
  if (businessConfig.deploymentStage !== "production") {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/admin", "/api/", "/account", "/checkout", "/cart", "/*?*"] },
    sitemap: businessConfig.siteUrl
      ? `${businessConfig.siteUrl}/sitemap.xml`
      : undefined,
  };
}
