import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: ['**/node_modules/**', '**/dist/**', '**/coverage/**', 'server/prisma/migrations/**'],
  },
  js.configs.recommended,
  {
    files: ['server/**/*.js', '*.js'],
    languageOptions: { ecmaVersion: 2023, sourceType: 'module', globals: { ...globals.node } },
    rules: { 'no-unused-vars': ['error', { argsIgnorePattern: '^_' }] },
  },
  {
    files: ['server/tests/**/*.js'],
    languageOptions: { globals: { ...globals.node, ...globals.jest } },
  },
  {
    files: ['client/**/*.{js,jsx}'],
    plugins: { react, 'react-hooks': reactHooks },
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    settings: { react: { version: 'detect' } },
    rules: {
      ...react.configs.recommended.rules,
      ...react.configs['jsx-runtime'].rules,
      ...reactHooks.configs.recommended.rules,
      'react/prop-types': 'off',
      'no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['client/**/*.test.{js,jsx}', 'client/src/test/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node, ...globals.jest } },
  },
  {
    files: ['client/*.js'],
    languageOptions: { globals: { ...globals.node } },
  },
  prettier,
];
