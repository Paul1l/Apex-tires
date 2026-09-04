import type { MetadataRoute } from "next";
import { businessConfig } from "@/config/business";

export default function sitemap(): MetadataRoute.Sitemap {
  if (
    businessConfig.deploymentStage !== "production" ||
    !businessConfig.siteUrl
  ) {
    return [];
  }

  return ["", "/shiny", "/diski", "/contacts", "/legal"].map(
    (path) => ({
      url: `${businessConfig.siteUrl}${path}`,
      lastModified: new Date(),
      changeFrequency: path === "" ? "daily" : "weekly",
      priority: path === "" ? 1 : 0.7,
    }),
  );
}
