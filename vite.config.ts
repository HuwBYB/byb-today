import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: { enabled: true }, // lets you test install while developing
      workbox: {
        navigateFallbackDenylist: [/^\/api\//],
        globPatterns: ["**/*.{js,css,html,ico,png,svg,webp,jpg,jpeg}"],
        maximumFileSizeToCacheInBytes: 3_000_000, // allow up to ~3MB assets to be precached (temporary)
      },
      // Files that should be copied as-is (iOS uses the apple-touch icon tag)
      includeAssets: [
        "icons/app-icon-120.png",
        "icons/app-icon-152.png",
        "icons/app-icon-167.png",
        "icons/app-icon-180.png"
      ],
      manifest: {
        name: "BYB",
        short_name: "BYB",
        start_url: "/",
        scope: "/",
        display: "standalone",
        background_color: "#ffffff",
        theme_color: "#111827",
        icons: [
          // standard
          { src: "/icons/app-icon-192.png",  sizes: "192x192",  type: "image/png" },
          { src: "/icons/app-icon-256.png",  sizes: "256x256",  type: "image/png" },
          { src: "/icons/app-icon-384.png",  sizes: "384x384",  type: "image/png" },
          { src: "/icons/app-icon-512.png",  sizes: "512x512",  type: "image/png" },

          // maskable (Android adaptive icons)
          { src: "/icons/app-icon-maskable-192.png", sizes: "192x192",  type: "image/png", purpose: "maskable" },
          { src: "/icons/app-icon-maskable-256.png", sizes: "256x256",  type: "image/png", purpose: "maskable" },
          { src: "/icons/app-icon-maskable-512.png", sizes: "512x512",  type: "image/png", purpose: "maskable" },

          // optional large (some stores/devices use these)
          { src: "/icons/app-icon-1024.png",          sizes: "1024x1024", type: "image/png" },
          { src: "/icons/app-icon-1024-maskable.png", sizes: "1024x1024", type: "image/png", purpose: "maskable" },

          // iOS size also listed for completeness (Safari mainly uses <link rel="apple-touch-icon">)
          { src: "/icons/app-icon-180.png", sizes: "180x180", type: "image/png" }
        ],
      },
    }),
  ],
});
