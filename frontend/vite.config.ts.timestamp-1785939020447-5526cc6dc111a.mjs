// vite.config.ts
import { sveltekit } from "file:///home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/node_modules/@sveltejs/kit/src/exports/vite/index.js";
import { defineConfig } from "file:///home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/node_modules/vite/dist/node/index.js";
import wasm from "file:///home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/node_modules/vite-plugin-wasm/exports/import.mjs";
import topLevelAwait from "file:///home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/node_modules/vite-plugin-top-level-await/exports/import.mjs";
var vite_config_default = defineConfig({
  plugins: [wasm(), topLevelAwait(), sveltekit()],
  test: {
    alias: {
      "argon2-browser": "/home/vale/_GITHUB/ValentinHerrmann/BlindGrade/frontend/tests/mocks/argon2Mock.ts"
    }
  },
  worker: {
    format: "es"
  },
  optimizeDeps: {
    exclude: ["argon2-browser"],
    include: ["texlyre-busytex"]
  },
  ssr: {
    external: ["argon2-browser"]
  },
  build: {
    target: "es2022",
    rollupOptions: {
      external: [/.*\.wasm$/],
      output: {
        entryFileNames: "assets/[name]-[hash].js",
        chunkFileNames: "assets/[name]-[hash].js",
        assetFileNames: "assets/[name]-[hash][extname]"
      }
    }
  },
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: true
      }
    }
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcudHMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCIvaG9tZS92YWxlL19HSVRIVUIvVmFsZW50aW5IZXJybWFubi9CbGluZEdyYWRlL2Zyb250ZW5kXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ZpbGVuYW1lID0gXCIvaG9tZS92YWxlL19HSVRIVUIvVmFsZW50aW5IZXJybWFubi9CbGluZEdyYWRlL2Zyb250ZW5kL3ZpdGUuY29uZmlnLnRzXCI7Y29uc3QgX192aXRlX2luamVjdGVkX29yaWdpbmFsX2ltcG9ydF9tZXRhX3VybCA9IFwiZmlsZTovLy9ob21lL3ZhbGUvX0dJVEhVQi9WYWxlbnRpbkhlcnJtYW5uL0JsaW5kR3JhZGUvZnJvbnRlbmQvdml0ZS5jb25maWcudHNcIjtpbXBvcnQgeyBzdmVsdGVraXQgfSBmcm9tICdAc3ZlbHRlanMva2l0L3ZpdGUnO1xuaW1wb3J0IHsgZGVmaW5lQ29uZmlnIH0gZnJvbSAndml0ZSc7XG5pbXBvcnQgd2FzbSBmcm9tICd2aXRlLXBsdWdpbi13YXNtJztcbmltcG9ydCB0b3BMZXZlbEF3YWl0IGZyb20gJ3ZpdGUtcGx1Z2luLXRvcC1sZXZlbC1hd2FpdCc7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIHBsdWdpbnM6IFt3YXNtKCksIHRvcExldmVsQXdhaXQoKSwgc3ZlbHRla2l0KCldLFxuICB0ZXN0OiB7XG4gICAgYWxpYXM6IHtcbiAgICAgICdhcmdvbjItYnJvd3Nlcic6ICcvaG9tZS92YWxlL19HSVRIVUIvVmFsZW50aW5IZXJybWFubi9CbGluZEdyYWRlL2Zyb250ZW5kL3Rlc3RzL21vY2tzL2FyZ29uMk1vY2sudHMnLFxuICAgIH0sXG4gIH0sXG4gIHdvcmtlcjoge1xuICAgIGZvcm1hdDogJ2VzJyxcbiAgfSxcbiAgb3B0aW1pemVEZXBzOiB7XG4gICAgZXhjbHVkZTogWydhcmdvbjItYnJvd3NlciddLFxuICAgIGluY2x1ZGU6IFsndGV4bHlyZS1idXN5dGV4J10sXG4gIH0sXG4gIHNzcjoge1xuICAgIGV4dGVybmFsOiBbJ2FyZ29uMi1icm93c2VyJ10sXG4gIH0sXG4gIGJ1aWxkOiB7XG4gICAgdGFyZ2V0OiAnZXMyMDIyJyxcbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBleHRlcm5hbDogWy8uKlxcLndhc20kL10sXG4gICAgICBvdXRwdXQ6IHtcbiAgICAgICAgZW50cnlGaWxlTmFtZXM6ICdhc3NldHMvW25hbWVdLVtoYXNoXS5qcycsXG4gICAgICAgIGNodW5rRmlsZU5hbWVzOiAnYXNzZXRzL1tuYW1lXS1baGFzaF0uanMnLFxuICAgICAgICBhc3NldEZpbGVOYW1lczogJ2Fzc2V0cy9bbmFtZV0tW2hhc2hdW2V4dG5hbWVdJyxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbiAgc2VydmVyOiB7XG4gICAgcG9ydDogNTE3MyxcbiAgICBwcm94eToge1xuICAgICAgJy9hcGknOiB7XG4gICAgICAgIHRhcmdldDogJ2h0dHA6Ly9sb2NhbGhvc3Q6ODAwMCcsXG4gICAgICAgIGNoYW5nZU9yaWdpbjogdHJ1ZSxcbiAgICAgIH0sXG4gICAgfSxcbiAgfSxcbn0pO1xuIl0sCiAgIm1hcHBpbmdzIjogIjtBQUF1VixTQUFTLGlCQUFpQjtBQUNqWCxTQUFTLG9CQUFvQjtBQUM3QixPQUFPLFVBQVU7QUFDakIsT0FBTyxtQkFBbUI7QUFFMUIsSUFBTyxzQkFBUSxhQUFhO0FBQUEsRUFDMUIsU0FBUyxDQUFDLEtBQUssR0FBRyxjQUFjLEdBQUcsVUFBVSxDQUFDO0FBQUEsRUFDOUMsTUFBTTtBQUFBLElBQ0osT0FBTztBQUFBLE1BQ0wsa0JBQWtCO0FBQUEsSUFDcEI7QUFBQSxFQUNGO0FBQUEsRUFDQSxRQUFRO0FBQUEsSUFDTixRQUFRO0FBQUEsRUFDVjtBQUFBLEVBQ0EsY0FBYztBQUFBLElBQ1osU0FBUyxDQUFDLGdCQUFnQjtBQUFBLElBQzFCLFNBQVMsQ0FBQyxpQkFBaUI7QUFBQSxFQUM3QjtBQUFBLEVBQ0EsS0FBSztBQUFBLElBQ0gsVUFBVSxDQUFDLGdCQUFnQjtBQUFBLEVBQzdCO0FBQUEsRUFDQSxPQUFPO0FBQUEsSUFDTCxRQUFRO0FBQUEsSUFDUixlQUFlO0FBQUEsTUFDYixVQUFVLENBQUMsV0FBVztBQUFBLE1BQ3RCLFFBQVE7QUFBQSxRQUNOLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLFFBQ2hCLGdCQUFnQjtBQUFBLE1BQ2xCO0FBQUEsSUFDRjtBQUFBLEVBQ0Y7QUFBQSxFQUNBLFFBQVE7QUFBQSxJQUNOLE1BQU07QUFBQSxJQUNOLE9BQU87QUFBQSxNQUNMLFFBQVE7QUFBQSxRQUNOLFFBQVE7QUFBQSxRQUNSLGNBQWM7QUFBQSxNQUNoQjtBQUFBLElBQ0Y7QUFBQSxFQUNGO0FBQ0YsQ0FBQzsiLAogICJuYW1lcyI6IFtdCn0K
