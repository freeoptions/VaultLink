import { strict as assert } from 'node:assert';
import {
  DEFAULT_THEME,
  PRESET_THEMES,
  buildThemeTokens,
  normalizeThemeConfig,
} from '../src/lib/theme';

assert.equal(PRESET_THEMES.length, 5);
assert.equal(PRESET_THEMES[0].label, '浅蓝');

const fallbackTheme = normalizeThemeConfig(null);
assert.deepEqual(fallbackTheme, DEFAULT_THEME);

const customTheme = normalizeThemeConfig({
  presetId: 'custom',
  primaryColor: '#fbbf24',
  updatedAt: 123,
});
assert.equal(customTheme.presetId, 'custom');
assert.equal(customTheme.primaryColor, '#fbbf24');
assert.equal(customTheme.updatedAt, 123);

const invalidTheme = normalizeThemeConfig({
  presetId: 'custom',
  primaryColor: 'red',
  updatedAt: 456,
});
assert.deepEqual(invalidTheme, DEFAULT_THEME);

const presetTheme = normalizeThemeConfig({
  presetId: 'mint',
  primaryColor: '#111111',
  updatedAt: 789,
});
assert.equal(presetTheme.primaryColor, '#34d399');
assert.equal(presetTheme.updatedAt, 789);

const tokens = buildThemeTokens(customTheme);
assert.equal(tokens.cssVars['--app-primary'], '#fbbf24');
assert.equal(tokens.cssVars['--primary-foreground'], '222 47% 11%');
assert.ok(tokens.cssVars['--app-primary-soft'].startsWith('#'));
assert.notEqual(tokens.cssVars['--app-primary-soft'], tokens.cssVars['--app-primary']);
