import react from "@vitejs/plugin-react"
import { defineConfig } from "vite"

// Some wallet libraries import Node.js built-ins ("events", "buffer").
// Point them at their browser versions so the app runs in the browser.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      events: "events/",
      buffer: "buffer/",
    },
  },
  define: {
    global: "globalThis",
  },
})
