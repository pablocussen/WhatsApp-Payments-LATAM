/** @type {import('jest').Config} */
const config = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  testMatch: ['**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  collectCoverageFrom: [
    'src/**/*.ts',
    '!src/config/environment.ts',
    '!src/api/server.ts',
  ],
  coverageThreshold: {
    global: {
      branches: 100,
      functions: 100,
      lines: 100,
      statements: 100,
    },
  },
  coverageReporters: ['text', 'lcov', 'html'],
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  // Run serially to avoid SIGTERM on resource-constrained environments
  // (many test suites with HTTP servers + bcrypt run in parallel cause OOM)
  runInBand: true,
  verbose: true,
};

module.exports = config;
