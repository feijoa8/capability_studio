import type { NextConfig } from "next";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  outputFileTracingRoot: path.join(__dirname, "../.."),
  async redirects() {
    return [
      { source: "/app", destination: appUrl, permanent: false },
      {
        source: "/auth/signup",
        destination: `${appUrl.replace(/\/$/, "")}/`,
        permanent: false,
      },
      {
        source: "/auth/login",
        destination: `${appUrl.replace(/\/$/, "")}/`,
        permanent: false,
      },
    ];
  },
};

export default nextConfig;
