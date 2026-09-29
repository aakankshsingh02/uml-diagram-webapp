import fsd from "@feature-sliced/steiger-plugin";
import { defineConfig } from "steiger";

// FSD architecture linter: `npm run lint:fsd`
export default defineConfig([
  ...fsd.configs.recommended,
  {
    rules: {
      // Single-page app: every feature has exactly one consumer (pages/chat) today.
      // Re-enable once a second page exists.
      "fsd/insignificant-slice": "off",
    },
  },
]);
