import type { MetadataRoute } from "next";

/**
 * Private shop tool — keep it out of search engines (it sits behind
 * APP_PASSWORD on the public internet anyway).
 */
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", disallow: "/" }],
  };
}