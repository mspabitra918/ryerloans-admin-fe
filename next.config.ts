import type { NextConfig } from "next";

/**
 * §8.1: "/admin — noindex, nofollow + blocked in robots.txt".
 *
 * The header is set here rather than only in page metadata so it also covers
 * API-shaped routes, redirects and anything served before React renders — a
 * <meta> tag is only honoured on documents a crawler actually parses.
 */
const nextConfig: NextConfig = {
  poweredByHeader: false,

  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "no-referrer" },
          {
            // The portal renders borrower PII; a referrer or an embedded frame
            // leaking it to a third party is the failure mode this closes.
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=(), interest-cohort=()",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
