import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV !== "production";

// Produkce: statický export, který servíruje přímo Fastify (jeden origin, jeden kontejner).
// Dev: `next dev` a /api se přeposílá na lokální API.
const nextConfig: NextConfig = {
  output: isDev ? undefined : "export",
  trailingSlash: true,
  images: { unoptimized: true },
  ...(isDev && {
    async rewrites() {
      return [{ source: "/api/:path*", destination: `${process.env.API_URL ?? "http://127.0.0.1:8080"}/api/:path*` }];
    },
  }),
};

export default nextConfig;
