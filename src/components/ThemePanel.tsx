import { useEffect, useMemo, useState } from 'react';
import { Check, Palette } from 'lucide-react';
import { Button } from './ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import {
  PRESET_THEMES,
  ThemeConfig,
  ThemePresetId,
  buildThemeTokens,
  normalizeThemeConfig,
} from '../lib/theme';
import { cn } from '../lib/utils';

interface ThemePanelProps {
  open: boolean;
  theme: ThemeConfig;
  onClose: () => void;
  onSave: (theme: ThemeConfig) => void;
}

const CUSTOM_PRESET_ID: ThemePresetId = 'custom';

export const ThemePanel = ({ open, theme, onClose, onSave }: ThemePanelProps) => {
  const [selectedPresetId, setSelectedPresetId] = useState<ThemePresetId>(theme.presetId);
  const [customColor, setCustomColor] = useState(theme.primaryColor);

  useEffect(() => {
    if (!open) return;
    setSelectedPresetId(theme.presetId);
    setCustomColor(theme.primaryColor);
  }, [open, theme]);

  const previewTheme = useMemo(() => {
    const preset = PRESET_THEMES.find((item) => item.id === selectedPresetId);
    return normalizeThemeConfig({
      presetId: selectedPresetId,
      primaryColor: preset?.primaryColor || customColor,
      updatedAt: theme.updatedAt,
    });
  }, [customColor, selectedPresetId, theme.updatedAt]);

  const previewTokens = buildThemeTokens(previewTheme).cssVars;

  const handleSave = () => {
    onSave({
      ...previewTheme,
      updatedAt: Date.now(),
    });
    onClose();
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="sm:max-w-[560px]">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Palette className="h-5 w-5 text-[var(--app-primary)]" />
            主题颜色
          </DialogTitle>
          <DialogDescription>
            选择一个浅色主题，或者用自定义颜色调成你喜欢的样子。
          </DialogDescription>
        </DialogHeader>

        <div className="grid gap-4 py-2">
          <div className="grid gap-2 sm:grid-cols-2">
            {PRESET_THEMES.map((preset) => {
              const active = selectedPresetId === preset.id;
              return (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => {
                    setSelectedPresetId(preset.id);
                    setCustomColor(preset.primaryColor);
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-xl border p-3 text-left transition-all',
                    active
                      ? 'border-[var(--app-primary)] bg-[var(--app-primary-soft)] shadow-sm'
                      : 'border-slate-200 bg-white hover:border-[var(--app-primary-border)] hover:bg-slate-50',
                  )}
                >
                  <span
                    className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-white shadow-sm"
                    style={{ backgroundColor: preset.primaryColor }}
                  >
                    {active && <Check className="h-4 w-4" />}
                  </span>
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-slate-950">{preset.label}</span>
                    <span className="mt-0.5 block text-xs text-slate-500">{preset.description}</span>
                  </span>
                </button>
              );
            })}
          </div>

          <div
            className={cn(
              'rounded-xl border p-3',
              selectedPresetId === CUSTOM_PRESET_ID
                ? 'border-[var(--app-primary)] bg-[var(--app-primary-soft)]'
                : 'border-slate-200 bg-white',
            )}
          >
            <button
              type="button"
              onClick={() => setSelectedPresetId(CUSTOM_PRESET_ID)}
              className="flex w-full items-center justify-between gap-3 text-left"
            >
              <span>
                <span className="block text-sm font-semibold text-slate-950">自定义颜色</span>
                <span className="mt-0.5 block text-xs text-slate-500">自己选择主按钮和高亮颜色</span>
              </span>
              <input
                type="color"
                value={customColor}
                onChange={(event) => {
                  setSelectedPresetId(CUSTOM_PRESET_ID);
                  setCustomColor(event.target.value);
                }}
                className="h-9 w-12 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                title="选择自定义颜色"
              />
            </button>
          </div>

          <div
            className="rounded-xl border border-slate-200 p-4"
            style={{
              background: previewTokens['--app-card-header'],
            }}
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-slate-950">预览效果</p>
                <p className="mt-1 text-xs text-slate-500">主按钮、选中标签和弹窗高亮会跟随这个颜色。</p>
              </div>
              <span
                className="rounded-full px-3 py-1.5 text-sm font-semibold shadow-sm"
                style={{
                  background: previewTokens['--app-primary'],
                  color: previewTokens['--app-primary-contrast'],
                  boxShadow: `0 10px 22px ${previewTokens['--app-primary-shadow']}`,
                }}
              >
                主按钮
              </span>
            </div>
          </div>
        </div>

        <DialogFooter className="gap-2">
          <Button type="button" variant="outline" onClick={onClose}>
            取消
          </Button>
          <Button type="button" className="theme-primary-action" onClick={handleSave}>
            保存主题
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
