import js from "@eslint/js";
import globals from "globals";
import prettierRecommended from "eslint-plugin-prettier/recommended";

export default [
    { ignores: ["types/**"] },
    js.configs.recommended,
    {
        files: ["**/*.js", "**/*.mjs"],
        languageOptions: {
            ecmaVersion: 2022,
            sourceType: "module",
            globals: { ...globals.es2021, ...globals.node },
        },
        rules: {
            "no-empty": ["error", { allowEmptyCatch: false }],
            "no-constant-condition": ["error", { checkLoops: true }],
            "no-unused-vars": ["warn", { argsIgnorePattern: "^_", varsIgnorePattern: "^_" }],
        },
    },
    prettierRecommended,
];
