import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Don't advertise the framework in response headers.
  poweredByHeader: false,
  // Baseline security headers for the whole app (private shop tool: nothing
  // of ours should ever be framed or sniffed).
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
    ];
  },
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
