import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      // enable in dev so you can test install on a phone at your dev URL
      devOptions: { enabled: true },
      workbox: {
        // don't cache your API routes
        navigateFallbackDenylist: [/^\/api\//],
      },
      includeAssets: [
        "icons/favicon.ico",
        "icons/apple-touch-icon.png",
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
          // standard icons
          { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
          { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
          // maskable (Android adaptive)
          { src: "/icons/maskable-192.png", sizes: "192x192", type: "image/png", purpose: "maskable" },
          { src: "/icons/maskable-512.png", sizes: "512x512", type: "image/png", purpose: "maskable" },
          // iOS home screen icon (Safari still prefers this)
          { src: "/icons/apple-touch-icon.png", sizes: "180x180", type: "image/png" },
        ],
      },
    }),
  ],
});
