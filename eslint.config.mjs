import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores([
    ".next/**",
    "artifacts/**",
    "cache/**",
    "out/**",
    "build/**",
    "test/contracts/**",
    "scripts/**/*.cjs",
    "hardhat.config.cjs",
    "next-env.d.ts",
  ]),
]);
