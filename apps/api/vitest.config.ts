import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
    // `*.int.test.ts` matches the include above, and must not run here: the
    // integration suite needs a real database and truncates it between tests.
    // It has its own config, its own DATABASE_URL_TEST, and its own command.
    exclude: [...configDefaults.exclude, "src/**/*.int.test.ts"],
  },
});
