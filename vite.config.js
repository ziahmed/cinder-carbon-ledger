import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// If you deploy to GitHub Pages at https://<user>.github.io/<repo>/,
// uncomment the line below and set it to "/<repo>/".
// Vercel and Netlify need no base change.
export default defineConfig({
  plugins: [react()],
  // base: "/cinder-carbon-ledger/",
});
