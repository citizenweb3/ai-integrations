import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  transpilePackages: ["@bizdev/db", "@bizdev/shared"]
};

export default nextConfig;
