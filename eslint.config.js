import tseslint from "typescript-eslint";

export default tseslint.config(
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    ignores: [
      "**/node_modules/",
      "**/dist/",
      "**/coverage/",
      "**/.agent-swarm/**",
      "**/api.d.ts",
    ],
  },
);
