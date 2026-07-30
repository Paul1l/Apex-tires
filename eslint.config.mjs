import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypeScript from "eslint-config-next/typescript";

const eslintConfiguration = [
  ...nextCoreWebVitals,
  ...nextTypeScript,
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "outputs/**",
      "work/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
    ],
    rules: {
      // Browser hydration and resetting modal state intentionally happen after
      // mount; these effects synchronize React with browser-only state.
      "react-hooks/set-state-in-effect": "off",
    },
  },
];

export default eslintConfiguration;
