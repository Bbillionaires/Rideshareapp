// Runs before the test framework is installed (Jest's setupFiles). Points
// every test at a dedicated test database so the suite never touches
// whatever DATABASE_URL a developer has configured for local dev use.
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgresql://postgres:postgres@localhost:5432/rideshareapp_test?schema=public";
