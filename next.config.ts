import type { NextConfig } from "next";

const config: NextConfig = {
  serverExternalPackages: ["pdfjs-dist", "@napi-rs/canvas", "busboy", "yauzl"],
  async rewrites() {
    return process.env.VERCEL
      ? []
      : [{ source: "/api/edit-text-worker", destination: "/api/edit-text" }];
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default config;
