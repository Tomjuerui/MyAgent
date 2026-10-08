import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Docker 打包用：输出 standalone 产物（见 docker/frontend.Dockerfile）
  output: "standalone",
  // 关掉左下角的 Next.js 开发工具浮层（只在 dev 出现，且它自身的主题开关不影响应用）
  devIndicators: false,
  async rewrites() {
    // 本地开发默认 localhost:8000；容器内由 compose 注入 BACKEND_ORIGIN=http://backend:8000
    const backend = process.env.BACKEND_ORIGIN || "http://localhost:8000";
    // ERP 数据台反代：本地开发直连 8081，容器内由 compose 注入 ERP_ORIGIN=http://mock-erp:8081
    const erp = process.env.ERP_ORIGIN || "http://localhost:8081";
    return [
      {
        source: "/api/:path*",
        destination: `${backend}/api/:path*`,
      },
      {
        source: "/erp-api/:path*",
        destination: `${erp}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
