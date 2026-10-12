module.exports = {
  testEnvironment: 'node',
  testMatch: [
    '<rootDir>/apps/user-service/src/onramper/*.test.ts',
    '<rootDir>/packages/shared-utils/src/auth/client-ip.test.ts',
  ],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@shapeshift/shared-utils$': '<rootDir>/packages/shared-utils/src',
    '^@shapeshift/shared-types$': '<rootDir>/packages/shared-types/src',
  },
}
