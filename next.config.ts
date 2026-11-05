import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  // Keep pdfjs/pdf-parse unbundled so the pdf.worker.mjs file resolves
  // correctly from node_modules at runtime (Turbopack cannot bundle it).
  serverExternalPackages: ["pdfjs-dist", "pdf-parse"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
