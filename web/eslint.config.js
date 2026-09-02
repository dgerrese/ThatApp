import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      // sw.ts is excluded from tsconfig.json and typed under tsconfig.worker.json
      // instead (it needs the WebWorker lib, not DOM), and the unit tests under
      // tsconfig.test.json; an array project lets eslint find whichever one each
      // file belongs to.
      parserOptions: {
        project: ["./tsconfig.json", "./tsconfig.worker.json", "./tsconfig.test.json"],
      },
    },
    plugins: { "@typescript-eslint": tseslint },
    rules: {
      ...tseslint.configs.recommended.rules,
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
      "no-console": ["warn", { allow: ["warn", "error"] }],
      // tsc (run separately via `make tsc`) already checks this against the DOM lib;
      // eslint's static no-undef has no knowledge of ambient browser globals and
      // false-positives on them (documented typescript-eslint caveat).
      "no-undef": "off",
    },
  },
];
