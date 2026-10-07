module.exports = {
  testEnvironment: 'node',
  testMatch: ['<rootDir>/apps/user-service/src/__tests__/*.test.ts'],
  transform: { '^.+\\.ts$': ['ts-jest', { tsconfig: '<rootDir>/tsconfig.json' }] },
  moduleNameMapper: {
    '^@shapeshift/shared-utils$': '<rootDir>/packages/shared-utils/src',
    '^@shapeshift/shared-types$': '<rootDir>/packages/shared-types/src',
  },
}
