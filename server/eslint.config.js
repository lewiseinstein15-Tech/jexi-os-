/**
 * JEXI OS — ESLint flat config (Phase 2).
 *
 * Philosophy: fail CI on REAL bugs (undefined vars, redeclaration, unsafe
 * patterns), tolerate style noise as warnings so the 48k-line codebase can be
 * linted today without a rewrite. Style enforcement (prettier) is a
 * follow-up; this catches what actually breaks the server.
 */
import js from '@eslint/js';
import globals from 'globals';

export default [
  {
    ignores: ['node_modules/**', 'dist/**', 'public/**', 'data/**', 'jexi-workspace/**', 'android/**', 'jexi-agents/**'],
  },
  {
    files: ['**/*.js', '**/*.mjs'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: {
        ...globals.node,
        ...globals.browser,
        ...globals.es2022,
      },
    },
    rules: {
      // Recommended baseline, tuned for this codebase's style.
      ...js.configs.recommended.rules,

      // ── Error-level: real bugs only ──────────────────────────────
      'no-undef': 'error',
      'no-redeclare': 'error',
      'no-const-assign': 'error',
      'no-dupe-args': 'error',
      'no-dupe-keys': 'error',
      'no-dupe-class-members': 'error',
      'no-cond-assign': 'error',
      'no-func-assign': 'error',
      'no-import-assign': 'error',
      'no-new-symbol': 'error',
      'no-obj-calls': 'error',
      'no-sparse-arrays': 'error',
      'no-unexpected-multiline': 'error',
      'no-unsafe-finally': 'error',
      'no-unsafe-negation': 'error',
      'no-unreachable': 'error',
      'use-isnan': 'error',
      'valid-typeof': 'error',
      'no-compare-neg-zero': 'error',
      'no-this-before-super': 'error',

      // ── Warning-level: style / hygiene (does not fail CI) ─────────
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
      'no-constant-condition': ['warn', { checkLoops: false }],
      'no-empty': 'warn',
      'no-useless-escape': 'warn',
      'no-async-promise-executor': 'warn',
      'no-prototype-builtins': 'off',
      'no-control-regex': 'off',
      'no-extra-boolean-cast': 'off',
      'no-case-declarations': 'off',
      'no-fallthrough': 'off',
      'no-unused-private-class-members': 'off',

      // ── Off: stylistic noise in this codebase (not real bugs) ─────
      'no-useless-assignment': 'off',
      'preserve-caught-error': 'off',
      'no-constant-binary-expression': 'off',
      'no-sequences': 'off',
    },
  },
];
