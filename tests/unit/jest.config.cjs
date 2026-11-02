'use strict';

module.exports = {
  rootDir: '../..',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/tests/unit/**/*.test.cjs'],
  collectCoverageFrom: [
    '<rootDir>/user/controllers/authController.js',
    '<rootDir>/user/controllers/cartController.js',
    '<rootDir>/user/controllers/orderController.js',
    '<rootDir>/user/controllers/shipperController.js',
    '<rootDir>/user/controllers/pageController.js',
    '<rootDir>/user/controllers/productController.js',
    '<rootDir>/user/controllers/reviewController.js',
    '<rootDir>/user/middlewares/authMiddleware.js',
    '<rootDir>/admin/src/controllers/**/*.js',
    '<rootDir>/admin/src/middleware/**/*.js',
    '<rootDir>/admin/src/service/*.js',
    '<rootDir>/admin/src/service/session/session-service.js',
  ],
  coverageDirectory: '<rootDir>/tests/evidence/unit/coverage',
  coverageReporters: ['text', 'json-summary', 'html'],
  coverageThreshold: {
    global: { lines: 100, statements: 99, functions: 99, branches: 80 },
  },
  clearMocks: true,
  modulePathIgnorePatterns: ['<rootDir>/tests/evidence/'],
};
