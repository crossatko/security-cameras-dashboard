// https://nuxt.com/docs/api/configuration/nuxt-config
export default defineNuxtConfig({
  compatibilityDate: "2025-07-15",
  devtools: { enabled: true },
  ssr: false,
  modules: ["@nuxtjs/tailwindcss"],
  build: {
    transpile: ["hls.js"],
  },
  vite: {
    optimizeDeps: {
      include: ["hls.js"],
    },
  },
  nitro: {
    storage: {
      streams: {
        driver: 'fs',
        base: './public/streams'
      }
    }
  },
  routeRules: {
    '/streams/**': {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
      },
    },
  },
});
