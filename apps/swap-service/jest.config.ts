import type { Config } from 'jest'

const config: Config = {
  rootDir: 'src',
  testRegex: '.*\\.test\\.ts$',
  transform: { '^.+\\.ts$': 'ts-jest' },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
  setupFiles: ['<rootDir>/verification/__tests__/setup.ts'],
  // @shapeshiftoss/contracts reaches lodash-es, which ships esm that ts-jest will not transform
  moduleNameMapper: { '^lodash-es$': 'lodash', '^lodash-es/(.*)$': 'lodash/$1' },
}

export default config
