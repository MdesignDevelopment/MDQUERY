/** @type {import('next').NextConfig} */
const nextConfig = {
  // 'standalone' output is only for the self-hosted Docker path (see Dockerfile).
  // Vercel has its own build/output pipeline — this must stay unset there.
  ...(process.env.VERCEL ? {} : { output: 'standalone' }),
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
