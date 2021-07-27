module.exports = {
  transformIgnorePatterns: ["./node_modules/?!lodash-es"],
  transform: {
    '^.+\.(ts|html)$': 'ts-jest',
    '^.+\.js$': 'babel-jest'
    },
  preset: 'ts-jest',
  testEnvironment: 'node',
};