/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_VERSION_APP: 'etapa39b-' + new Date().toISOString().slice(0, 10),
  },
};

module.exports = nextConfig;
