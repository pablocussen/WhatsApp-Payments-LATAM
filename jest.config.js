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
      branches: 90,
      functions: 75,
      lines: 70,
      statements: 70,
    },
  },
  coverageDirectory: 'coverage',
  coverageProvider: 'v8',
  verbose: true,
};

module.exports = config;
