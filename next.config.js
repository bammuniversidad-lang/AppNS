/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSION_APP: 'etapa28-' + new Date().toISOString().slice(0, 10),
  },
};

module.exports = nextConfig;
