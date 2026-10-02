import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Bundle the invoice PDF brand images (read from disk at runtime) into the
  // serverless functions so they are available on Vercel.
  outputFileTracingIncludes: {
    "/api/**": ["./src/lib/pdf/assets/**"],
  },
  // Keep the Browserbase SDK and Playwright out of the server bundle — they
  // are plain runtime dependencies (no bundling-safe guarantee) for the live
  // Mercedes connector.
  serverExternalPackages: ["playwright-core", "@browserbasehq/sdk"],
};

export default nextConfig;
