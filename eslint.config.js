import js from "@eslint/js";
import importX from "eslint-plugin-import-x";
import globals from "globals";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

export default defineConfig([
  globalIgnores(["dist", "coverage", "node_modules"]),
  {
    linterOptions: {
      noInlineConfig: true,
      reportUnusedDisableDirectives: "error",
    },
  },
  {
    files: ["**/*.js"],
    extends: [js.configs.recommended],
    languageOptions: {
      globals: globals.node,
    },
  },
  {
    files: ["**/*.ts"],
    extends: [js.configs.recommended, ...tseslint.configs.strictTypeChecked],
    plugins: {
      "import-x": importX,
    },
    languageOptions: {
      globals: globals.node,
      parser: tseslint.parser,
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      "@typescript-eslint/ban-ts-comment": "error",
      "@typescript-eslint/consistent-type-definitions": ["error", "type"],
      "@typescript-eslint/consistent-type-imports": [
        "error",
        { fixStyle: "inline-type-imports" },
      ],
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-non-null-assertion": "error",
      "@typescript-eslint/no-unnecessary-condition": "error",
      "import-x/no-internal-modules": [
        "error",
        {
          allow: [
            "**/index.js",
            "@modelcontextprotocol/server/stdio",
            "node:**",
            "zod/**",
          ],
        },
      ],
      "no-restricted-syntax": [
        "error",
        {
          selector: "TSAnyKeyword",
          message: "Use unknown and validate it with Zod or a type guard.",
        },
        {
          selector: "TSAsExpression, TSTypeAssertion",
          message:
            "Type assertions are prohibited; fix the type or add a guard.",
        },
        {
          selector: "TSNonNullExpression",
          message:
            "Non-null assertions are prohibited; handle the missing value.",
        },
        {
          selector: "TSInterfaceDeclaration",
          message: "Use a type alias for application types.",
        },
        {
          selector: "FunctionDeclaration",
          message: "Use an arrow function assigned to const.",
        },
        {
          selector: "ExportDefaultDeclaration",
          message: "Default exports are prohibited in TypeScript.",
        },
      ],
    },
  },
]);
