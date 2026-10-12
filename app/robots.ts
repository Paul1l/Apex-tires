import type { MetadataRoute } from "next";
import { businessConfig } from "@/config/business";

export default function robots(): MetadataRoute.Robots {
  if (businessConfig.deploymentStage !== "production") {
    // Preview stand with demo prices. Crawling stays allowed on purpose: a
    // `Disallow: /` would stop robots from loading pages and reading the
    // `noindex, nofollow` meta tag (app/layout.tsx), so a linked URL could
    // still be indexed without a snippet. No sitemap on preview.
    return { rules: { userAgent: "*", allow: "/" } };
  }

  return {
    rules: {
      userAgent: "*",
      // CSS/JS (/_next/static/), images (/assets/, /icon.svg) and the first
      // catalog pages (/, /shiny, /diski — no query string) stay crawlable.
      allow: "/",
      // `/*?*` keeps parameter duplicates (?cart=open, UTM tags, ?_rsc=) out
      // of the crawl budget. When the catalog gets crawlable pagination
      // (?page=N links with self-referencing canonical), add
      // `allow: ["/", "/*?page="]`: the longer rule wins in Google and Yandex.
      disallow: ["/admin", "/api/", "/account", "/checkout", "/cart", "/*?*"],
    },
    sitemap: businessConfig.siteUrl
      ? `${businessConfig.siteUrl.replace(/\/+$/, "")}/sitemap.xml`
      : undefined,
  };
}
