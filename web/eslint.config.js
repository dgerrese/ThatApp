import js from "@eslint/js";
import tseslint from "@typescript-eslint/eslint-plugin";
import tsparser from "@typescript-eslint/parser";

export default [
  js.configs.recommended,
  {
    // Typed linting reads tsconfig, and the unit tests are outside its
    // `include` — see the header of src/format.test.ts. Both exclusions are
    // #51's to resolve; until then a file eslint cannot type-check is a file it
    // should not pretend to.
    ignores: ["src/**/*.test.ts"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      // sw.ts is excluded from tsconfig.json and typed under tsconfig.worker.json
      // instead (it needs the WebWorker lib, not DOM); an array project lets
      // eslint find whichever one each file belongs to.
      parserOptions: { project: ["./tsconfig.json", "./tsconfig.worker.json"] },
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
