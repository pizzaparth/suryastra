import { defineConfig } from "vite";
import { viteSingleFile } from "vite-plugin-singlefile";

// `npm run build` produces ONE self-contained dist/index.html (JS, CSS, fonts and data inlined)
// so the dashboard opens offline by double-clicking it - no server, no internet.
export default defineConfig({
  plugins: [viteSingleFile()],
  build: { assetsInlineLimit: 100_000_000, chunkSizeWarningLimit: 5000 },
});
