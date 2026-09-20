import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 打包用：输出 standalone 产物（见 docker/frontend.Dockerfile）
  output: "standalone",
  async rewrites() {
    // 本地开发默认 localhost:8000；容器内由 compose 注入 BACKEND_ORIGIN=http://backend:8000
    const backend = process.env.BACKEND_ORIGIN || "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
