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
  Star,
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
import { flushPendingDataWrites } from '../hooks/useAccounts';

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
  port: number;
  last_seen_at: number;
}

interface SavedDevice {
  id: string;
  name: string;
  alias?: string;
  device_type: string;
  ip: string;
  port: number;
  favorite: boolean;
  lastSeenAt: number;
  lastSyncedAt?: number;
}

interface ListedDevice extends DeviceInfo {
  online: boolean;
  favorite: boolean;
  displayName: string;
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

const SAVED_DEVICES_KEY = 'vaultlink_sync_saved_devices';

const loadSavedDevices = (): Record<string, SavedDevice> => {
  try {
    const value = localStorage.getItem(SAVED_DEVICES_KEY);
    return value ? JSON.parse(value) : {};
  } catch {
    return {};
  }
};

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
  const [savedDevices, setSavedDevices] = useState<Record<string, SavedDevice>>(loadSavedDevices);
  const [editingPeerId, setEditingPeerId] = useState<string | null>(null);
  const [peerAliasInput, setPeerAliasInput] = useState('');

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

  const listedDevices = useMemo<ListedDevice[]>(() => {
    const onlineIds = new Set(nearbyDevices.map((device) => device.id));
    const online = nearbyDevices.map((device) => {
      const saved = savedDevices[device.id];
      return {
        ...device,
        online: true,
        favorite: saved?.favorite ?? false,
        displayName: saved?.alias?.trim() || device.name,
      };
    });
    const offlineFavorites = Object.values(savedDevices)
      .filter((device) => device.favorite && !onlineIds.has(device.id))
      .map((device) => ({
        id: device.id,
        name: device.name,
        device_type: device.device_type,
        ip: device.ip,
        port: device.port,
        last_seen_at: device.lastSeenAt,
        online: false,
        favorite: true,
        displayName: device.alias?.trim() || device.name,
      }));

    return [...online, ...offlineFavorites].sort((left, right) => {
      if (left.favorite !== right.favorite) return left.favorite ? -1 : 1;
      if (left.online !== right.online) return left.online ? -1 : 1;
      return left.displayName.localeCompare(right.displayName, 'zh-CN');
    });
  }, [nearbyDevices, savedDevices]);

  const persistSavedDevices = (next: Record<string, SavedDevice>) => {
    setSavedDevices(next);
    localStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(next));
  };

  const rememberDevice = (device: DeviceInfo) => {
    if (device.id === currentDevice?.id) return;
    setSavedDevices((previous) => {
      const existing = previous[device.id];
      const next = {
        ...previous,
        [device.id]: {
          id: device.id,
          name: device.name,
          alias: existing?.alias,
          device_type: device.device_type,
          ip: device.ip,
          port: device.port,
          favorite: existing?.favorite ?? false,
          lastSeenAt: device.last_seen_at || Date.now(),
          lastSyncedAt: existing?.lastSyncedAt,
        },
      };
      localStorage.setItem(SAVED_DEVICES_KEY, JSON.stringify(next));
      return next;
    });
  };

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
    let scanTimer: ReturnType<typeof setTimeout> | undefined;

    const loadAndScan = async () => {
      try {
        setIsScanning(true);
        setSyncMessage('正在搜索同一 WiFi 下的设备...');

        const device = await invoke<DeviceInfo>('get_device_info');
        if (disposed) return;
        setCurrentDevice(device);
        setDeviceNameInput(device.name);

        await invoke('get_sync_server_status');

        const favoriteIps = Object.values(loadSavedDevices())
          .filter((item) => item.favorite && item.ip)
          .map((item) => item.ip);
        const [discovered, knownDevices] = await Promise.all([
          invoke<DeviceInfo[]>('start_sync_discovery'),
          favoriteIps.length > 0
            ? invoke<DeviceInfo[]>('probe_known_devices', { targetIps: favoriteIps })
            : Promise.resolve([]),
        ]);
        if (disposed) return;

        const combined = [...discovered, ...knownDevices];
        setDevices(Array.from(new Map(combined.map((item) => [item.id, item])).values()));
        combined.filter((item) => item.id !== device.id).forEach(rememberDevice);
        setSyncMessage('已开始发现设备，附近设备会自动出现在这里。');
        scanTimer = setTimeout(() => setIsScanning(false), 3500);

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
      if (scanTimer) {
        clearTimeout(scanTimer);
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
    let unlistenNotice: UnlistenFn | undefined;
    let unlistenDevice: UnlistenFn | undefined;
    let unlistenDiscoveryError: UnlistenFn | undefined;

    const attachListener = async () => {
      const stopNotice = await listen<SyncNoticePayload>('sync-notice', (event) => {
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
      });
      if (disposed) {
        void stopNotice();
        return;
      }
      unlistenNotice = stopNotice;

      const stopDevice = await listen<DeviceInfo>('sync-device-seen', (event) => {
        if (disposed || event.payload.id === currentDevice?.id) {
          return;
        }
        const device = event.payload;
        setDevices((previous) => {
          const next = previous.filter((item) => item.id !== device.id);
          return [...next, device];
        });
        rememberDevice(device);
        setIsScanning(false);
        setSyncMessage(`已发现 ${device.name}`);
      });
      if (disposed) {
        void stopDevice();
      } else {
        unlistenDevice = stopDevice;
      }

      const stopDiscoveryError = await listen<string>('sync-discovery-error', (event) => {
        if (!disposed) {
          setIsScanning(false);
          setSyncMessage(`搜索失败：${event.payload}`);
        }
      });
      if (disposed) {
        void stopDiscoveryError();
      } else {
        unlistenDiscoveryError = stopDiscoveryError;
      }
    };

    void attachListener();

    return () => {
      disposed = true;
      if (unlistenNotice) {
        void unlistenNotice();
      }
      if (unlistenDevice) {
        void unlistenDevice();
      }
      if (unlistenDiscoveryError) {
        void unlistenDiscoveryError();
      }
    };
  }, [open, currentDevice?.id]);

  const handleRescan = async () => {
    setIsScanning(true);
    setSyncMessage('正在重新搜索局域网设备...');
    try {
      const favoriteIps = Object.values(savedDevices)
        .filter((item) => item.favorite && item.ip)
        .map((item) => item.ip);
      const [discovered, knownDevices] = await Promise.all([
        invoke<DeviceInfo[]>('start_sync_discovery'),
        favoriteIps.length > 0
          ? invoke<DeviceInfo[]>('probe_known_devices', { targetIps: favoriteIps })
          : Promise.resolve([]),
      ]);
      const combined = [...discovered, ...knownDevices];
      setDevices(Array.from(new Map(combined.map((item) => [item.id, item])).values()));
      combined.forEach(rememberDevice);
      setSyncMessage(combined.length > 1 ? '已更新附近设备。' : '正在继续搜索附近设备...');
      setTimeout(() => setIsScanning(false), 2500);
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
      await flushPendingDataWrites();
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
      const matchedDevice = Object.values(savedDevices).find((device) => device.ip === targetIp);
      if (matchedDevice) {
        persistSavedDevices({
          ...savedDevices,
          [matchedDevice.id]: { ...matchedDevice, lastSyncedAt: Date.now() },
        });
      }
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
    const saved = savedDevices[device.id];
    await handleSync(device.ip, saved?.alias?.trim() || device.name);
  };

  const toggleFavorite = (device: ListedDevice) => {
    const existing = savedDevices[device.id];
    persistSavedDevices({
      ...savedDevices,
      [device.id]: {
        id: device.id,
        name: device.name,
        alias: existing?.alias,
        device_type: device.device_type,
        ip: device.ip,
        port: device.port,
        favorite: !device.favorite,
        lastSeenAt: device.last_seen_at || existing?.lastSeenAt || Date.now(),
        lastSyncedAt: existing?.lastSyncedAt,
      },
    });
  };

  const startEditingPeer = (device: ListedDevice) => {
    setEditingPeerId(device.id);
    setPeerAliasInput(savedDevices[device.id]?.alias || device.name);
  };

  const savePeerAlias = (device: ListedDevice) => {
    const alias = peerAliasInput.trim();
    const existing = savedDevices[device.id];
    persistSavedDevices({
      ...savedDevices,
      [device.id]: {
        id: device.id,
        name: device.name,
        alias: alias && alias !== device.name ? alias : undefined,
        device_type: device.device_type,
        ip: device.ip,
        port: device.port,
        favorite: existing?.favorite ?? false,
        lastSeenAt: device.last_seen_at || existing?.lastSeenAt || Date.now(),
        lastSyncedAt: existing?.lastSyncedAt,
      },
    });
    setEditingPeerId(null);
    setPeerAliasInput('');
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
                    {isScanning ? '发现中' : '自动发现已开启'}
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

                <div className="min-w-0 space-y-3">
                  {listedDevices.length > 0 ? (
                    listedDevices.map((device) => (
                      <div
                        key={device.id}
                        className={`min-w-0 rounded-xl border px-3 py-3 transition-colors ${
                          device.online
                            ? 'border-slate-200 bg-white hover:border-[var(--app-primary-border)]'
                            : 'border-slate-200 bg-slate-50'
                        }`}
                      >
                        <div className="flex min-w-0 items-center gap-3">
                          <div className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${
                            device.online ? 'theme-primary-soft-icon' : 'bg-slate-200 text-slate-500'
                          }`}>
                            {deviceIcon(device.device_type)}
                          </div>
                          <div className="min-w-0 flex-1">
                            {editingPeerId === device.id ? (
                              <div className="flex min-w-0 items-center gap-1">
                                <Input
                                  value={peerAliasInput}
                                  onChange={(event) => setPeerAliasInput(event.target.value)}
                                  onKeyDown={(event) => {
                                    if (event.key === 'Enter') savePeerAlias(device);
                                    if (event.key === 'Escape') setEditingPeerId(null);
                                  }}
                                  maxLength={32}
                                  autoFocus
                                  className="h-8 min-w-0 bg-white"
                                />
                                <Button size="icon" className="h-8 w-8" onClick={() => savePeerAlias(device)} title="保存备注名">
                                  <Check className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => setEditingPeerId(null)} title="取消">
                                  <X className="h-4 w-4" />
                                </Button>
                              </div>
                            ) : (
                              <div className="flex min-w-0 items-center gap-2">
                                <span className={`min-w-0 truncate font-medium ${device.online ? 'text-slate-950' : 'text-slate-500'}`}>
                                  {device.displayName}
                                </span>
                                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${device.online ? 'bg-emerald-500' : 'bg-slate-300'}`} />
                              </div>
                            )}
                            <p className="mt-1 min-w-0 truncate text-xs text-slate-500">
                              {device.online ? `${device.device_type} · ${device.ip}` : '收藏设备 · 当前离线'}
                            </p>
                          </div>
                          {editingPeerId !== device.id && (
                            <div className="flex shrink-0 items-center gap-1">
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-500"
                                onClick={() => toggleFavorite(device)}
                                title={device.favorite ? '取消收藏' : '收藏设备'}
                              >
                                <Star className={`h-4 w-4 ${device.favorite ? 'fill-amber-400 text-amber-500' : ''}`} />
                              </Button>
                              <Button
                                type="button"
                                size="icon"
                                variant="ghost"
                                className="h-8 w-8 text-slate-500"
                                onClick={() => startEditingPeer(device)}
                                title="设置备注名"
                              >
                                <Edit3 className="h-4 w-4" />
                              </Button>
                              <Button
                                size="sm"
                                variant="outline"
                                disabled={isSyncing || !device.online}
                                onClick={() => handleDeviceSyncClick(device)}
                                className="ml-1 shrink-0 border-slate-200 bg-white"
                              >
                                {isSyncing && syncFeedback?.targetLabel === device.displayName ? '同步中' : device.online ? '同步' : '离线'}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    ))
                  ) : (
                    <p className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-4 text-sm leading-6 text-slate-500">
                      还没有发现可同步设备。请确认两端都已打开，并连接到同一个 WiFi。
                    </p>
                  )}
                </div>

                <details className="group rounded-lg border border-dashed border-slate-300 bg-slate-50 px-3 py-2">
                  <summary className="cursor-pointer select-none text-sm text-slate-600">手动输入 IP</summary>
                  <div className="mt-3 grid min-w-0 gap-2 sm:grid-cols-[1fr_auto]">
                    <Input
                      value={manualIp}
                      onChange={(event) => setManualIp(event.target.value)}
                      inputMode="decimal"
                      placeholder="例如 192.168.1.7"
                      className="min-w-0 bg-white"
                    />
                    <Button
                      type="button"
                      variant="outline"
                      disabled={isSyncing}
                      onClick={handleManualSync}
                      className="border-slate-200 bg-white"
                    >
                      {isSyncing ? '同步中' : '同步'}
                    </Button>
                  </div>
                </details>
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
