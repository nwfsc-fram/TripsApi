module.exports = {
  moduleNameMapper: {
    "^lodash-es/(.*)$": "./node_modules/lodash/$1"
  },
  preset: 'ts-jest',
  testEnvironment: 'node',
};