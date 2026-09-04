import type { Config } from 'jest'

const config: Config = {
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/verification/__tests__/setup.ts'],
}

export default config
