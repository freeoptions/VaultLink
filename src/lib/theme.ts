export type ThemePresetId = 'soft-blue' | 'mint' | 'lavender' | 'rose' | 'pearl' | 'custom';

export interface ThemeConfig {
  presetId: ThemePresetId;
  primaryColor: string;
  updatedAt: number;
}

export interface ThemePreset {
  id: Exclude<ThemePresetId, 'custom'>;
  label: string;
  description: string;
  primaryColor: string;
}

type Rgb = {
  r: number;
  g: number;
  b: number;
};

export const PRESET_THEMES: ThemePreset[] = [
  {
    id: 'soft-blue',
    label: '浅蓝',
    description: '清爽、安静',
    primaryColor: '#60a5fa',
  },
  {
    id: 'mint',
    label: '薄荷',
    description: '轻盈、柔和',
    primaryColor: '#34d399',
  },
  {
    id: 'lavender',
    label: '浅紫',
    description: '温柔、干净',
    primaryColor: '#a78bfa',
  },
  {
    id: 'rose',
    label: '浅粉',
    description: '柔暖、不刺眼',
    primaryColor: '#fb7185',
  },
  {
    id: 'pearl',
    label: '浅灰',
    description: '克制、耐看',
    primaryColor: '#64748b',
  },
];

export const DEFAULT_THEME: ThemeConfig = {
  presetId: 'soft-blue',
  primaryColor: '#60a5fa',
  updatedAt: 0,
};

const HEX_COLOR_RE = /^#?([0-9a-f]{6})$/i;

const normalizeHex = (value: unknown): string | null => {
  if (typeof value !== 'string') return null;
  const match = value.trim().match(HEX_COLOR_RE);
  return match ? `#${match[1].toLowerCase()}` : null;
};

const getPreset = (id: unknown) =>
  PRESET_THEMES.find((preset) => preset.id === id);

export const normalizeThemeConfig = (theme: Partial<ThemeConfig> | null | undefined): ThemeConfig => {
  if (!theme) {
    return DEFAULT_THEME;
  }

  const updatedAt = Number.isFinite(theme.updatedAt) ? Number(theme.updatedAt) : Date.now();
  const preset = getPreset(theme.presetId);

  if (preset) {
    return {
      presetId: preset.id,
      primaryColor: preset.primaryColor,
      updatedAt,
    };
  }

  if (theme.presetId === 'custom') {
    const customColor = normalizeHex(theme.primaryColor);
    if (customColor) {
      return {
        presetId: 'custom',
        primaryColor: customColor,
        updatedAt,
      };
    }
  }

  return DEFAULT_THEME;
};

const hexToRgb = (hex: string): Rgb => {
  const value = hex.replace('#', '');
  return {
    r: parseInt(value.slice(0, 2), 16),
    g: parseInt(value.slice(2, 4), 16),
    b: parseInt(value.slice(4, 6), 16),
  };
};

const rgbToHex = ({ r, g, b }: Rgb) =>
  `#${[r, g, b].map((value) => Math.round(value).toString(16).padStart(2, '0')).join('')}`;

const mix = (base: Rgb, target: Rgb, amount: number): Rgb => ({
  r: base.r + (target.r - base.r) * amount,
  g: base.g + (target.g - base.g) * amount,
  b: base.b + (target.b - base.b) * amount,
});

const rgbToHsl = ({ r, g, b }: Rgb) => {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    switch (max) {
      case red:
        h = (green - blue) / delta + (green < blue ? 6 : 0);
        break;
      case green:
        h = (blue - red) / delta + 2;
        break;
      default:
        h = (red - green) / delta + 4;
        break;
    }
    h /= 6;
  }

  return {
    h: Math.round(h * 360),
    s: Math.round(s * 100),
    l: Math.round(l * 100),
  };
};

const luminance = ({ r, g, b }: Rgb) => {
  const channel = (value: number) => {
    const normalized = value / 255;
    return normalized <= 0.03928
      ? normalized / 12.92
      : ((normalized + 0.055) / 1.055) ** 2.4;
  };

  return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
};

const readableTextColor = (rgb: Rgb) => (luminance(rgb) > 0.48 ? '#0f172a' : '#ffffff');

const readableTextHsl = (rgb: Rgb) => (luminance(rgb) > 0.48 ? '222 47% 11%' : '0 0% 100%');

const rgba = ({ r, g, b }: Rgb, alpha: number) =>
  `rgba(${Math.round(r)}, ${Math.round(g)}, ${Math.round(b)}, ${alpha})`;

export const buildThemeTokens = (theme: Partial<ThemeConfig> | null | undefined) => {
  const normalizedTheme = normalizeThemeConfig(theme);
  const primary = hexToRgb(normalizedTheme.primaryColor);
  const hsl = rgbToHsl(primary);
  const white = { r: 255, g: 255, b: 255 };
  const black = { r: 0, g: 0, b: 0 };
  const primaryLightness = Math.min(56, Math.max(42, hsl.l - 10));
  const soft = mix(primary, white, 0.84);
  const softer = mix(primary, white, 0.93);
  const border = mix(primary, white, 0.62);
  const hover = mix(primary, black, 0.12);
  const active = mix(primary, black, 0.2);
  const ink = mix(primary, black, 0.44);

  return {
    theme: normalizedTheme,
    cssVars: {
      '--background': `${hsl.h} 48% 98%`,
      '--primary': `${hsl.h} ${Math.min(82, Math.max(42, hsl.s))}% ${primaryLightness}%`,
      '--primary-foreground': readableTextHsl(primary),
      '--ring': `${hsl.h} ${Math.min(82, Math.max(42, hsl.s))}% ${primaryLightness}%`,
      '--accent': `${hsl.h} 86% 95%`,
      '--accent-foreground': `${hsl.h} 46% 28%`,
      '--app-bg': rgbToHex(softer),
      '--app-header-bg': rgba(softer, 0.95),
      '--app-input-bg': rgbToHex(mix(primary, white, 0.96)),
      '--app-primary': normalizedTheme.primaryColor,
      '--app-primary-hover': rgbToHex(hover),
      '--app-primary-active': rgbToHex(active),
      '--app-primary-soft': rgbToHex(soft),
      '--app-primary-softer': rgbToHex(softer),
      '--app-primary-border': rgbToHex(border),
      '--app-primary-ink': rgbToHex(ink),
      '--app-primary-contrast': readableTextColor(primary),
      '--app-primary-shadow': rgba(primary, 0.18),
      '--app-primary-shadow-strong': rgba(primary, 0.26),
      '--app-primary-focus': rgba(primary, 0.22),
      '--app-card-header': `linear-gradient(180deg, ${rgba(soft, 0.82)}, rgba(255, 255, 255, 0.96))`,
      '--app-sidebar-bg': `linear-gradient(180deg, ${rgba(soft, 0.78)}, rgba(248, 250, 252, 0.96))`,
      '--app-primary-gradient': `linear-gradient(135deg, ${rgbToHex(active)}, ${normalizedTheme.primaryColor})`,
    },
  };
};

export const applyThemeToDocument = (
  theme: Partial<ThemeConfig> | null | undefined,
  root: HTMLElement = document.documentElement,
) => {
  const { cssVars, theme: normalizedTheme } = buildThemeTokens(theme);
  Object.entries(cssVars).forEach(([name, value]) => {
    root.style.setProperty(name, value);
  });
  return normalizedTheme;
};
