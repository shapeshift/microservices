import type { Config } from 'jest'

const config: Config = {
  rootDir: '.',
  testRegex: '.*\\.test\\.ts$',
  transform: { '^.+\\.ts$': ['ts-jest', { isolatedModules: true }] },
  moduleFileExtensions: ['ts', 'js', 'json'],
  testEnvironment: 'node',
}

export default config
