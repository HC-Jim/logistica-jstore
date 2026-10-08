// URL del backend Express. El navegador llama a /api/* en el mismo dominio
// y Next.js lo reenvía aquí (sin problemas de CORS).
const API_URL = process.env.API_URL || 'http://localhost:4000';

/** @type {import('next').NextConfig} */
const nextConfig = {
  async rewrites() {
    return [{ source: '/api/:path*', destination: `${API_URL}/api/:path*` }];
  },
};

export default nextConfig;
