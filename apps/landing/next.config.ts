import type { NextConfig } from "next";

const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  output: "standalone",
  async redirects() {
    return [
      { source: "/app", destination: appUrl, permanent: false },
      {
        source: "/auth/signup",
        destination: `${appUrl.replace(/\/$/, "")}/?mode=signin`,
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
