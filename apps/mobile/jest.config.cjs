module.exports = {
  preset: 'jest-expo/ios',
  testMatch: ['<rootDir>/tests/**/*.test.ts?(x)', '<rootDir>/src/**/__tests__/**/*.test.ts?(x)'],
  moduleNameMapper: {
    '^([.]{1,2}/.*)[.]js$': '$1',
    '^@mems-life/domain$': '<rootDir>/../../packages/domain/src/index.ts',
  },
  transformIgnorePatterns: [
    'node_modules/(?!((jest-)?react-native|@react-native(-community)?|expo[^/]*|@expo(nent)?/.*|@expo/.*|react-native-safe-area-context|@mems-life/.*)/)',
  ],
};
