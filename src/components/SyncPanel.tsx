import { useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import {
  Check,
  Edit3,
  LaptopMinimal,
  Loader2,
  Monitor,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  Wifi,
  X,
} from 'lucide-react';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';
import { Button } from './ui/button';
import { Card, CardContent } from './ui/card';
import { Input } from './ui/input';

interface SyncPanelProps {
  open: boolean;
  onClose: () => void;
  onSynced: () => Promise<void> | void;
}

interface DeviceInfo {
  id: string;
  name: string;
  device_type: string;
  ip: string;
}

interface SyncSummary {
  addedAccounts: number;
  updatedAccounts: number;
  deletedAccounts: number;
  addedTags: number;
  updatedTags: number;
  deletedTags: number;
  updatedTheme?: number;
}

type SyncStatus = 'working' | 'success' | 'error';

interface SyncFeedback {
  status: SyncStatus;
  title: string;
  detail: string;
  targetLabel?: string;
  summary?: SyncSummary;
}

interface SyncNoticePayload {
  sourceIp: string;
  sourceDeviceName: string;
  message: string;
  summary?: SyncSummary;
}

interface SyncOperationResult {
  message: string;
  summary?: SyncSummary;
}

const emptySummary = (): SyncSummary => ({
  addedAccounts: 0,
  updatedAccounts: 0,
  deletedAccounts: 0,
  addedTags: 0,
  updatedTags: 0,
  deletedTags: 0,
  updatedTheme: 0,
});

const isLanIpv4 = (ip: string) => {
  const parts = ip.split('.');
  return parts.length === 4 && parts.every((part) => {
    if (!/^\d{1,3}$/.test(part)) return false;
    const value = Number(part);
    return value >= 0 && value <= 255;
  });
};

const deviceIcon = (type: string) =>
  type === 'Windows' ? (
    <Monitor className="theme-primary-text h-4 w-4 shrink-0" />
  ) : (
    <Smartphone className="theme-primary-text h-4 w-4 shrink-0" />
  );

const feedbackClassName = (status: SyncStatus) => {
  if (status === 'success') {
    return 'border-emerald-200 bg-emerald-50 text-emerald-900';
  }
  if (status === 'error') {
    return 'border-red-200 bg-red-50 text-red-900';
  }
  return 'theme-feedback-info';
};

const feedbackIcon = (status: SyncStatus) => {
  if (status === 'success') {
    return <ShieldCheck className="h-4 w-4" />;
  }
  if (status === 'error') {
    return <ShieldAlert className="h-4 w-4" />;
  }
  return <Loader2 className="h-4 w-4 animate-spin" />;
};

const describeSummary = (summary: SyncSummary) => {
  const lines: string[] = [];
  const accountTouched = summary.addedAccounts + summary.updatedAccounts;
  const tagTouched = summary.addedTags + summary.updatedTags;

  if (accountTouched > 0) {
    lines.push(
      `账号 ${accountTouched} 条：新增 ${summary.addedAccounts}，更新 ${summary.updatedAccounts}，删除 ${summary.deletedAccounts}`,
    );
  }

  if (tagTouched > 0) {
    lines.push(
      `标签 ${tagTouched} 条：新增 ${summary.addedTags}，更新 ${summary.updatedTags}，删除 ${summary.deletedTags}`,
    );
  }

  if ((summary.updatedTheme ?? 0) > 0) {
    lines.push('主题设置已更新');
  }

  if (lines.length === 0) {
    return '本次同步未发现需要变更的数据。';
  }

  return lines.join('；');
};

export const SyncPanel = ({ open, onClose, onSynced }: SyncPanelProps) => {
  const [currentDevice, setCurrentDevice] = useState<DeviceInfo | null>(null);
  const [devices, setDevices] = useState<DeviceInfo[]>([]);
  const [isScanning, setIsScanning] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [isSyncing, setIsSyncing] = useState(false);
  const [isEditingName, setIsEditingName] = useState(false);
  const [deviceNameInput, setDeviceNameInput] = useState('');
  const [isSavingName, setIsSavingName] = useState(false);
  const [manualIp, setManualIp] = useState('');
  const [syncFeedback, setSyncFeedback] = useState<SyncFeedback | null>(null);

  const bodyRef = useRef<HTMLDivElement | null>(null);

  const nearbyDevices = useMemo(() => {
    const seen = new Set<string>();
    return devices.filter((device) => {
      if (device.id === currentDevice?.id || seen.has(device.id) || !isLanIpv4(device.ip)) {
        return false;
      }
      seen.add(device.id);
      return true;
    });
  }, [devices, currentDevice?.id]);

  useEffect(() => {
    if (!currentDevice || isEditingName) {
      return;
    }
    setDeviceNameInput(currentDevice.name);
  }, [currentDevice, isEditingName]);

  useEffect(() => {
    if (!syncFeedback) {
      return;
    }
    bodyRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }, [syncFeedback]);

  useEffect(() => {
    if (!open) {
      setIsScanning(false);
      setDevices([]);
      setSyncMessage('');
      setSyncFeedback(null);
      return;
    }

    let disposed = false;
    let interval: ReturnType<typeof setInterval> | undefined;

    const loadAndScan = async () => {
      try {
        setSyncMessage('正在搜索同一 WiFi 下的设备...');

        const device = await invoke<DeviceInfo>('get_device_info');
        if (disposed) return;
        setCurrentDevice(device);
        setDeviceNameInput(device.name);

        const discovered = await invoke<DeviceInfo[]>('start_sync_discovery');
        if (disposed) return;

        setDevices(discovered);
        setIsScanning(true);
        setSyncMessage('已开始发现设备，附近设备会自动出现在这里。');

        interval = setInterval(async () => {
          try {
            const current = await invoke<DeviceInfo[]>('get_discovered_devices');
            if (!disposed) {
              setDevices(current);
            }
          } catch (err) {
            console.error('Failed to get discovered devices:', err);
          }
        }, 2500);
      } catch (err) {
        if (!disposed) {
          setSyncMessage(`搜索失败：${String(err)}`);
          setIsScanning(false);
        }
      }
    };

    void loadAndScan();

    return () => {
      disposed = true;
      if (interval) {
        clearInterval(interval);
      }
      setIsScanning(false);
      setDevices([]);
    };
  }, [open]);

  useEffect(() => {
    if (!open) {
      return;
    }

    let disposed = false;
    let unlisten: UnlistenFn | undefined;

    const attachListener = async () => {
      unlisten = await listen<SyncNoticePayload>('sync-notice', async (event) => {
        if (disposed) {
          return;
        }

        const payload = event.payload;
        const targetLabel = payload.sourceDeviceName || payload.sourceIp;
        const summary = payload.summary ?? emptySummary();
        setSyncMessage(`同步完成：${payload.message}`);
        setSyncFeedback({
          status: 'success',
          title: '收到同步',
          detail: `${targetLabel} 刚刚把最新数据同步到了当前设备。${describeSummary(summary)}`,
          targetLabel,
          summary,
        });
        await onSynced();
      });
    };

    void attachListener();

    return () => {
      disposed = true;
      if (unlisten) {
        void unlisten();
      }
    };
  }, [open, onSynced]);

  const handleRescan = async () => {
    setIsScanning(true);
    setSyncMessage('正在重新搜索局域网设备...');
    try {
      await invoke('stop_sync_discovery');
      const discovered = await invoke<DeviceInfo[]>('start_sync_discovery');
      setDevices(discovered);
      setSyncMessage('已重新开始搜索。');
    } catch (err) {
      setSyncMessage(`重新搜索失败：${String(err)}`);
      setIsScanning(false);
    }
  };

  const handleSaveDeviceName = async () => {
    const trimmed = deviceNameInput.trim();
    if (!trimmed) {
      setSyncMessage('设备名称不能为空。');
      return;
    }

    setIsSavingName(true);
    try {
      const renamed = await invoke<DeviceInfo>('set_device_name', { name: trimmed });
      setCurrentDevice(renamed);
      setDeviceNameInput(renamed.name);
      setIsEditingName(false);
      setSyncMessage('设备名称已更新，重新搜索后其他设备会看到新名称。');
      await handleRescan();
    } catch (err) {
      setSyncMessage(`重命名失败：${String(err)}`);
    } finally {
      setIsSavingName(false);
    }
  };

  const handleSync = async (targetIp: string, targetLabel: string) => {
    setIsSyncing(true);
    setSyncMessage(`正在与 ${targetLabel} 同步，请稍候...`);
    setSyncFeedback({
      status: 'working',
      title: '正在同步',
      detail: `正在与 ${targetLabel} 建立连接并合并数据，这一步可能持续几秒钟。`,
      targetLabel,
    });

    try {
      const result = await invoke<SyncOperationResult>('request_sync_from_device', { targetIp });
      await onSynced();
      const summary = result.summary ?? emptySummary();

      setSyncMessage(`同步完成：${result.message}`);
      setSyncFeedback({
        status: 'success',
        title: '同步完成',
        detail: `${targetLabel} 已完成同步。${describeSummary(summary)}`,
        targetLabel,
        summary,
      });
    } catch (err) {
      const message = String(err);
      setSyncMessage(`同步失败：${message}`);
      setSyncFeedback({
        status: 'error',
        title: '同步失败',
        detail: `与 ${targetLabel} 同步时发生错误：${message}`,
        targetLabel,
      });
    } finally {
      setIsSyncing(false);
    }
  };

  const handleDeviceSyncClick = async (device: DeviceInfo) => {
    await handleSync(device.ip, device.name);
  };

  const handleManualSync = async () => {
    const targetIp = manualIp.trim();
    if (!isLanIpv4(targetIp)) {
      setSyncMessage('请输入对方设备显示的局域网 IPv4 地址，例如 192.168.1.7。');
      setSyncFeedback({
        status: 'error',
        title: '地址无效',
        detail: '手动同步前需要输入正确的局域网 IPv4 地址，例如 192.168.1.7。',
      });
      return;
    }

    if (currentDevice?.ip === targetIp) {
      setSyncMessage('不能同步当前设备，请输入另一台设备的 IP。');
      setSyncFeedback({
        status: 'error',
        title: '不能同步自己',
        detail: '这个 IP 是当前设备地址，请输入另一台设备在同步面板中显示的 IP。',
      });
      return;
    }

    await handleSync(targetIp, targetIp);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && onClose()}>
      <DialogContent className="app-sheet border-slate-200 bg-white">
        <div ref={bodyRef} className="app-sheet-body min-w-0 overflow-x-hidden">
          <DialogHeader className="min-w-0 px-5 pb-2 pt-5 text-left">
            <DialogTitle className="flex min-w-0 items-center gap-2 text-slate-950">
              <Wifi className="theme-primary-text h-5 w-5 shrink-0" />
              <span className="truncate">局域网同步</span>
            </DialogTitle>
            <DialogDescription className="max-w-full text-slate-500">
              Windows 和 Android 连接同一个 WiFi 后，附近设备会自动出现，点击即可双向合并数据。
            </DialogDescription>
          </DialogHeader>

          <div className="grid min-w-0 gap-3 px-5 py-3">
            {syncFeedback && (
              <div
                className={`sticky top-0 z-20 rounded-xl border px-3 py-3 text-sm shadow-sm ${feedbackClassName(syncFeedback.status)}`}
              >
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 shrink-0">{feedbackIcon(syncFeedback.status)}</div>
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">{syncFeedback.title}</p>
                    <p className="mt-1 leading-6">{syncFeedback.detail}</p>
                  </div>
                </div>
              </div>
            )}

            <Card className="theme-info-card min-w-0 shadow-none">
              <CardContent className="min-w-0 space-y-3 p-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="theme-primary-text flex min-w-0 items-center gap-2 text-sm font-medium">
                    <ShieldCheck className="h-4 w-4 shrink-0" />
                    <span className="truncate">当前设备</span>
                  </div>
                  <div className="theme-primary-text flex shrink-0 items-center gap-2 text-xs">
                    {isScanning && <Loader2 className="h-3 w-3 animate-spin" />}
                    {isScanning ? '发现中' : '未搜索'}
                  </div>
                </div>

                {currentDevice ? (
                  <div className="min-w-0 rounded-lg border border-[var(--app-primary-border)] bg-white px-3 py-3 text-sm">
                    <div className="flex min-w-0 items-center gap-2">
                      <LaptopMinimal className="theme-primary-text h-4 w-4 shrink-0" />
                      {isEditingName ? (
                        <Input
                          value={deviceNameInput}
                          onChange={(event) => setDeviceNameInput(event.target.value)}
                          maxLength={32}
                          className="h-9 min-w-0 flex-1 bg-white"
                        />
                      ) : (
                        <span className="min-w-0 flex-1 truncate font-medium text-slate-950">
                          {currentDevice.name}
                        </span>
                      )}

                      {isEditingName ? (
                        <div className="flex shrink-0 items-center gap-1">
                          <Button
                            type="button"
                            size="icon"
                            className="h-8 w-8"
                            disabled={isSavingName}
                            onClick={handleSaveDeviceName}
                            title="保存设备名称"
                          >
                            {isSavingName ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                          </Button>
                          <Button
                            type="button"
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => {
                              setIsEditingName(false);
                              setDeviceNameInput(currentDevice.name);
                            }}
                            title="取消重命名"
                          >
                            <X className="h-4 w-4" />
                          </Button>
                        </div>
                      ) : (
                        <Button
                          type="button"
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 shrink-0"
                          onClick={() => setIsEditingName(true)}
                          title="重命名设备"
                        >
                          <Edit3 className="h-4 w-4" />
                        </Button>
                      )}
                    </div>
                    <div className="mt-2 grid min-w-0 gap-1 text-xs text-slate-500 sm:grid-cols-2">
                      <span className="min-w-0 truncate">类型：{currentDevice.device_type}</span>
                      <span className="min-w-0 truncate">IP：{currentDevice.ip}</span>
                    </div>
                  </div>
                ) : (
                  <p className="theme-primary-text text-sm">暂时无法读取当前设备信息。</p>
                )}
              </CardContent>
            </Card>

            <Card className="min-w-0 border-slate-200 shadow-none">
              <CardContent className="min-w-0 space-y-4 p-4">
                <div className="flex min-w-0 items-center justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate font-medium text-slate-950">附近设备</h3>
                    <p className="text-xs leading-5 text-slate-500">无需配对码，点击设备即可开始同步。</p>
                  </div>
                  <Button
                    onClick={handleRescan}
                    className="theme-primary-action shrink-0 gap-2"
                    disabled={isSyncing}
                  >
                    {isScanning ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                    重搜
                  </Button>
                </div>

                {syncMessage && (
                  <div className="min-w-0 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
                    {syncMessage}
                  </div>
                )}

                <div className="grid min-w-0 gap-2 rounded-lg border border-dashed border-slate-300 bg-slate-50 p-3 sm:grid-cols-[1fr_auto]">
                  <Input
                    value={manualIp}
                    onChange={(event) => setManualIp(event.target.value)}
                    inputMode="decimal"
                    placeholder="手动输入对方 IP，例如 192.168.1.7"
                    className="min-w-0 bg-white"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={isSyncing}
                    onClick={handleManualSync}
                    className="border-slate-200 bg-white"
                  >
                    {isSyncing ? '同步中' : '手动同步'}
                  </Button>
                </div>

                <div className="min-w-0 space-y-3">
                  {nearbyDevices.length > 0 ? (
                    nearbyDevices.map((device) => (
                      <div
                        key={device.id}
                        className="flex min-w-0 items-center justify-between gap-3 rounded-lg border border-slate-200 bg-white px-3 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex min-w-0 items-center gap-2 font-medium text-slate-950">
                            {deviceIcon(device.device_type)}
                            <span className="min-w-0 truncate">{device.name}</span>
                          </div>
                          <p className="mt-1 min-w-0 truncate text-xs text-slate-500">
                            {device.device_type} · {device.ip}
                          </p>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={isSyncing}
                          onClick={() => handleDeviceSyncClick(device)}
                          className="shrink-0 border-slate-200"
                        >
                          {isSyncing && syncFeedback?.targetLabel === device.name ? '同步中' : '同步'}
                        </Button>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
                      还没有发现可同步设备。请确认两端都已打开，并连接到同一个 WiFi。
                    </p>
                  )}
                </div>
              </CardContent>
            </Card>

            <Card className="min-w-0 border-slate-200 bg-slate-50 shadow-none">
              <CardContent className="space-y-2 p-4 text-sm leading-6 text-slate-600">
                <div className="flex items-center gap-2 font-medium text-slate-950">
                  <RefreshCw className="theme-primary-text h-4 w-4 shrink-0" />
                  同步规则
                </div>
                <p>同一账号按最近更新时间合并；删除操作会同步到另一端；同步前会自动备份当前数据。</p>
              </CardContent>
            </Card>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};
