import eslint from '@eslint/js';
import angular from 'angular-eslint';
import tseslint from 'typescript-eslint';
import { config as baseConfig } from './base.js';

/**
 * A custom ESLint configuration for applications that use Angular.
 * Consumers extend the `ts` and `html` blocks with their own component/
 * directive selector prefix rules — the prefix is app-specific.
 *
 * @type {{
 *   ts: import("eslint").Linter.Config[],
 *   html: import("eslint").Linter.Config[],
 * }}
 * */
export const angularConfig = {
  ts: tseslint.config(
    ...baseConfig,
    eslint.configs.recommended,
    ...tseslint.configs.recommended,
    ...tseslint.configs.stylistic,
    ...angular.configs.tsRecommended,
    {
      files: ['**/*.ts'],
      processor: angular.processInlineTemplates,
    },
  ),
  html: tseslint.config(
    ...angular.configs.templateRecommended,
    ...angular.configs.templateAccessibility,
  ),
};
