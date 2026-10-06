/** @type {import('jest').Config} */
module.exports = {
  preset: "ts-jest",
  testEnvironment: "node",
  rootDir: ".",
  testMatch: ["<rootDir>/tests/**/*.test.ts"],
  setupFiles: ["<rootDir>/tests/env.ts"],
  // Financial integration tests share one Postgres database and reset it
  // between tests (see tests/helpers/db.ts) — running suites in parallel
  // workers would race on that shared state, so force one at a time.
  maxWorkers: 1,
  testTimeout: 30000,
};
