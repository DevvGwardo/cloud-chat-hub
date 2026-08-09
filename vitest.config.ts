import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react-swc";
import path from "path";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    include: ["src/**/*.{test,spec}.{ts,tsx}", "server/**/*.{test,spec}.{ts,tsx}", "electron/**/*.{test,spec}.{ts,tsx}"],
    coverage: {
      provider: "v8",
      // Include the units actually under test — not just server/**. The
      // coverage gap let MCP discovery and MessageBubble regressions slip
      // through with no signal. (mcp-connect.ts was removed in a dead-code
      // pass; MessageBubble remains the one frontend unit worth gating.)
      include: [
        "server/**/*.ts",
        "src/components/chat/MessageBubble.tsx",
      ],
      exclude: ["server/scripts/**", "server/__tests__/**"],
      thresholds: {
        // Floor enforced in CI (`vitest run --coverage`): current coverage
        // hovers around 46%, so 40% is a real regression gate with headroom
        // instead of a target that was never enabled because it already failed.
        lines: 40,
      },
    },
  },
  resolve: {
    alias: { "@": path.resolve(__dirname, "./src") },
  },
});
