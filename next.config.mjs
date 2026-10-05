/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "export",
  // GitHub Pages 项目站点使用仓库子路径；本地开发默认仍使用根路径。
  basePath: process.env.NEXT_PUBLIC_BASE_PATH || "",
  trailingSlash: true,
  images: {
    unoptimized: true,
  },
};

export default nextConfig;
