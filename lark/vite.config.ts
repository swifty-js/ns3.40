import { defineConfig, type Plugin } from "vite";
import { larkMvcPlugin } from "@lark.js/mvc/vite";
import tailwindcss from "@tailwindcss/vite";
import { execSync } from "node:child_process";
import { join } from "node:path";

function parseFlowmonitor(): Plugin {
  return {
    name: "parse-flowmonitor",
    buildStart() {
      execSync("node scripts/parse-flowmonitor.mjs", {
        cwd: import.meta.dirname,
        stdio: "inherit",
      });
    },
  };
}

export default defineConfig({
  base: "/ns3.40/",
  plugins: [parseFlowmonitor(), larkMvcPlugin(), tailwindcss()],
  resolve: {
    alias: {
      "@": join(import.meta.dirname, "src"),
    },
  },
});
