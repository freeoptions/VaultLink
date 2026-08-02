import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronUp,
  Eye,
  EyeOff,
  Palette,
  Plus,
  Search,
  Shield,
  SlidersHorizontal,
  Tag as TagIcon,
  Wifi,
  X,
} from 'lucide-react';
import { useAccounts } from './hooks/useAccounts';
import { Account } from './types';
import { AccountCard } from './components/AccountCard';
import { AccountForm } from './components/AccountForm';
import { TagManager } from './components/TagManager';
import { SyncPanel } from './components/SyncPanel';
import { ThemePanel } from './components/ThemePanel';
import { Button } from './components/ui/button';
import { Input } from './components/ui/input';
import { Card, CardContent } from './components/ui/card';
import { ThemeConfig, applyThemeToDocument } from './lib/theme';
import { matchesSearchQuery } from './lib/pinyinSearch';

type AccountFormSubmitData = {
  platform: string;
  accounts: Array<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'platform'> & { sourceId?: string }>;
};

function App() {
  const {
    accounts,
    tags,
    isLoading,
    addAccount,
    addAccounts,
    updateAccount,
    deleteAccount,
    restoreAccount,
    addTag,
    updateTag,
    deleteTag,
    reorderTags,
    theme,
    updateTheme,
    refreshSilently,
  } = useAccounts();

  const [showForm, setShowForm] = useState(false);
  const [editAccount, setEditAccount] = useState<Account | null>(null);
  const [appendNewAccountInForm, setAppendNewAccountInForm] = useState(false);
  const [showTagManager, setShowTagManager] = useState(false);
  const [showSyncPanel, setShowSyncPanel] = useState(false);
  const [showThemePanel, setShowThemePanel] = useState(false);
  const [toast, setToast] = useState<{ message: string; show: boolean }>({ message: '', show: false });
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTagIds, setSelectedTagIds] = useState<string[]>([]);
  const [sortBy, setSortBy] = useState<'platform' | 'createdAt'>('platform');
  const [globalShowPassword, setGlobalShowPassword] = useState(false);
  const [isMobileLayout, setIsMobileLayout] = useState(false);
  const [showScrollButtons, setShowScrollButtons] = useState(false);
  const [recentAccountId, setRecentAccountId] = useState<string | null>(null);
  const [deleteConfirmAccount, setDeleteConfirmAccount] = useState<Account | null>(null);
  const [lastDeletedAccount, setLastDeletedAccount] = useState<Account | null>(null);
  const [showUndoToast, setShowUndoToast] = useState(false);
  const [undoCountdown, setUndoCountdown] = useState(10);
  const [hasEnteredMainView, setHasEnteredMainView] = useState(false);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const mainContentRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleResize = () => setIsMobileLayout(window.innerWidth < 768);
    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  useEffect(() => {
    applyThemeToDocument(theme);
  }, [theme]);

  useEffect(() => {
    if (!isLoading) {
      setHasEnteredMainView(true);
    }
  }, [isLoading]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'f') {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  useEffect(() => {
    const mainContent = mainContentRef.current;
    if (!mainContent) return;

    const handleScroll = () => {
      const { scrollHeight, clientHeight } = mainContent;
      setShowScrollButtons(scrollHeight > clientHeight + 10);
    };

    mainContent.addEventListener('scroll', handleScroll);
    handleScroll();
    return () => mainContent.removeEventListener('scroll', handleScroll);
  }, [accounts]);

  const filteredAndSortedAccounts = useMemo(() => {
    let filtered = accounts;
    const query = searchQuery.trim();

    if (query) {
      filtered = filtered.filter((account) =>
        [account.platform, account.tabName, account.username, account.email, account.nickname]
          .filter((value): value is string => Boolean(value))
          .some((value) => matchesSearchQuery(value, query))
      );
    }

    if (selectedTagIds.length > 0) {
      filtered = filtered.filter((account) => selectedTagIds.every((tag) => account.tags?.includes(tag)));
    }

    return [...filtered].sort((a, b) => {
      if (recentAccountId) {
        if (a.id === recentAccountId) return -1;
        if (b.id === recentAccountId) return 1;
      }

      if (sortBy === 'platform') {
        return a.platform.localeCompare(b.platform);
      }
      return b.createdAt - a.createdAt;
    });
  }, [accounts, searchQuery, selectedTagIds, sortBy, recentAccountId]);

  const groupedAccounts = useMemo(() => {
    const groups = new Map<string, Account[]>();

    filteredAndSortedAccounts.forEach((account) => {
      const key = account.platform.trim().toLowerCase() || '__empty_platform__';
      const current = groups.get(key) || [];
      current.push(account);
      groups.set(key, current);
    });

    return Array.from(groups.values()).map((group) =>
      [...group].sort((a, b) => a.createdAt - b.createdAt || a.updatedAt - b.updatedAt)
    );
  }, [filteredAndSortedAccounts, recentAccountId]);

  const scrollToTop = () => {
    mainContentRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const scrollToBottom = () => {
    mainContentRef.current?.scrollTo({ top: mainContentRef.current.scrollHeight, behavior: 'smooth' });
  };

  const handleAddAccount = (data: AccountFormSubmitData) => {
    const accountItems = data.accounts.map((item) => {
      const accountData = { ...item };
      delete accountData.sourceId;

      return {
        platform: data.platform,
        ...accountData,
      };
    });
    const newAccounts = addAccounts(accountItems);

    setRecentAccountId(newAccounts[0]?.id ?? null);
    setTimeout(() => scrollToTop(), 100);
  };

  const handleEditAccount = (account: Account) => {
    setAppendNewAccountInForm(false);
    setEditAccount(account);
    setShowForm(true);
  };

  const handleAddToPlatform = (account: Account) => {
    setAppendNewAccountInForm(true);
    setEditAccount(account);
    setShowForm(true);
  };

  const handleDeleteAccount = (account: Account) => {
    setDeleteConfirmAccount(account);
  };

  const confirmDelete = () => {
    if (!deleteConfirmAccount) return;

    setLastDeletedAccount(deleteConfirmAccount);
    deleteAccount(deleteConfirmAccount.id);
    setDeleteConfirmAccount(null);
    setShowUndoToast(true);
    setUndoCountdown(10);

    const timer = setInterval(() => {
      setUndoCountdown((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          setShowUndoToast(false);
          return 10;
        }
        return prev - 1;
      });
    }, 1000);
  };

  const undoDelete = () => {
    if (!lastDeletedAccount) return;

    restoreAccount(lastDeletedAccount.id);
    setShowUndoToast(false);
    setLastDeletedAccount(null);
  };

  const handleCopyAccount = (account: Account) => {
    setAppendNewAccountInForm(false);
    setEditAccount({
      ...account,
      id: '',
    } as Account);
    setShowForm(true);
  };

  const handleUpdateAccount = (data: AccountFormSubmitData) => {
    if (!editAccount) return;

    let latestAccountId = editAccount.id || null;
    const currentGroup = accounts.filter((account) => account.platform === editAccount.platform);
    const syncedGroupTags = data.accounts[0]?.tags || [];

    if (!editAccount.id) {
      data.accounts.forEach((item) => {
        const accountData = { ...item };
        delete accountData.sourceId;
        const newAccount = addAccount({
          platform: data.platform,
          ...accountData,
          tags: syncedGroupTags,
        });
        latestAccountId = newAccount.id;
      });
    } else {
      const existingGroup = currentGroup.length > 0 ? currentGroup : [editAccount];
      const existingById = new Map(existingGroup.map((account) => [account.id, account]));
      const keptExistingIds = new Set<string>();

      data.accounts.forEach((item) => {
        const sourceId = item.sourceId;
        const accountData = { ...item };
        delete accountData.sourceId;
        const existingAccount = sourceId ? existingById.get(sourceId) : undefined;
        if (existingAccount) {
          updateAccount(existingAccount.id, {
            platform: data.platform,
            ...accountData,
            tags: syncedGroupTags,
          });
          latestAccountId = existingAccount.id;
          keptExistingIds.add(existingAccount.id);
        } else {
          const newAccount = addAccount({
            platform: data.platform,
            ...accountData,
            tags: syncedGroupTags,
          });
          latestAccountId = newAccount.id;
        }
      });

      existingGroup.forEach((account) => {
        if (!keptExistingIds.has(account.id)) {
          deleteAccount(account.id);
        }
      });
    }

    if (latestAccountId) {
      setRecentAccountId(latestAccountId);
    }
    setEditAccount(null);
    setAppendNewAccountInForm(false);
    setTimeout(() => scrollToTop(), 100);
  };

  const handleCloseForm = () => {
    setShowForm(false);
    setEditAccount(null);
    setAppendNewAccountInForm(false);
  };

  const showToast = (message: string) => {
    setToast({ message, show: true });
    setTimeout(() => setToast({ message: '', show: false }), 2000);
  };

  const toggleTag = (tagId: string) => {
    setSelectedTagIds((current) =>
      current.includes(tagId) ? current.filter((id) => id !== tagId) : [...current, tagId]
    );
  };

  const handleUpdateTheme = (nextTheme: ThemeConfig) => {
    updateTheme(nextTheme);
    showToast('主题颜色已保存');
  };

  if (isLoading && !hasEnteredMainView) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="text-center">
          <div className="theme-logo-mark mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-2xl">
            <Shield className="h-7 w-7 animate-pulse" />
          </div>
          <p className="text-sm font-medium text-slate-600">正在加载保险库...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app-shell h-screen overflow-hidden text-slate-950">
      <div className="flex h-full flex-col">
        <header className="app-header z-20 flex-shrink-0 border-b border-slate-200/70 backdrop-blur-xl">
          <div className="safe-top mx-auto max-w-7xl px-5 pb-4 md:px-6">
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="theme-logo-mark flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-2xl">
                  <Shield className="h-5 w-5" />
                </div>
                <div className="min-w-0">
                  <h1 className="truncate text-[22px] font-semibold leading-6 tracking-normal text-slate-950 md:text-2xl">VaultLink</h1>
                  <p className="mt-1 truncate text-xs text-slate-500 md:text-sm">
                    {accounts.length} 个账号 · 本地加密存储 · 局域网同步
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-2">
                {!isMobileLayout && (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setShowSyncPanel(true)} className="gap-2 border-slate-200 bg-white">
                      <Wifi className="h-4 w-4" />
                      同步
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowTagManager(true)} className="gap-2 border-slate-200 bg-white">
                      <TagIcon className="h-4 w-4" />
                      标签
                    </Button>
                    <Button variant="outline" size="sm" onClick={() => setShowThemePanel(true)} className="gap-2 border-slate-200 bg-white">
                      <Palette className="h-4 w-4" />
                      主题
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setGlobalShowPassword(!globalShowPassword)}
                      className="gap-2 border-slate-200 bg-white"
                      title={globalShowPassword ? '隐藏所有密码' : '显示所有密码'}
                    >
                      {globalShowPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      {globalShowPassword ? '隐藏' : '显示'}
                    </Button>
                  </>
                )}
                <Button
                  size="icon"
                  onClick={() => {
                    setAppendNewAccountInForm(false);
                    setShowForm(true);
                  }}
                  className="theme-primary-action h-10 w-10 rounded-full md:h-9 md:w-auto md:rounded-md md:px-3"
                >
                  <Plus className="h-4 w-4" />
                  {!isMobileLayout && '添加账号'}
                </Button>
              </div>
            </div>
          </div>
        </header>

        <main ref={mainContentRef} className="app-main flex-1 overflow-y-auto px-5 pt-4 md:px-6 md:pb-8">
          <div className="mx-auto max-w-7xl">
            <Card className="mb-4 overflow-hidden border-slate-200/80 bg-white shadow-none">
              <CardContent className="space-y-3 p-3.5 md:p-4">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <Input
                    ref={searchInputRef}
                    placeholder="搜索平台、账号、邮箱或昵称，也支持拼音"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="theme-search-input h-12 rounded-xl border-slate-200 pl-10 pr-10 text-[15px] shadow-none"
                  />
                  {searchQuery && (
                    <button
                      onClick={() => setSearchQuery('')}
                      className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-md text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-700"
                      title="清空搜索"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2 pb-1">
                  <Button
                    variant={selectedTagIds.length === 0 ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setSelectedTagIds([])}
                    className={selectedTagIds.length === 0 ? 'theme-primary-pill h-9 rounded-full px-4 shadow-none' : 'h-9 rounded-full border-slate-200 bg-white px-4'}
                  >
                    全部
                  </Button>

                  {tags.map((tag) => (
                    <button
                      key={tag.id}
                      onClick={() => toggleTag(tag.id)}
                      className={`h-9 flex-shrink-0 rounded-full border px-3 text-sm font-medium transition-all ${
                        selectedTagIds.includes(tag.id)
                          ? 'border-transparent text-white shadow-sm'
                          : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50'
                      }`}
                      style={{ backgroundColor: selectedTagIds.includes(tag.id) ? tag.color : undefined }}
                    >
                      {tag.name}
                    </button>
                  ))}

                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setSortBy(sortBy === 'platform' ? 'createdAt' : 'platform')}
                    className="h-9 flex-shrink-0 gap-2 rounded-full border-slate-200 bg-white px-4 shadow-none md:ml-auto"
                  >
                    <SlidersHorizontal className="h-4 w-4" />
                    {sortBy === 'platform' ? '按平台' : '按时间'}
                  </Button>
                </div>
              </CardContent>
            </Card>

            {groupedAccounts.length > 0 ? (
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {groupedAccounts.map((group) => (
                  <AccountCard
                    key={group.map((item) => item.id).join('-')}
                    accounts={group}
                    onEdit={handleEditAccount}
                    onDelete={handleDeleteAccount}
                    onCopy={handleCopyAccount}
                    onAddToPlatform={handleAddToPlatform}
                    onCopySuccess={showToast}
                    tags={tags}
                    globalShowPassword={globalShowPassword}
                  />
                ))}
              </div>
            ) : (
              <Card className="border-slate-200/80 bg-white shadow-none">
                <CardContent className="flex min-h-[420px] flex-col items-center justify-center px-6 py-12 text-center">
                  <div className="theme-primary-soft-icon mb-5 flex h-14 w-14 items-center justify-center rounded-full">
                    <Shield className="h-7 w-7" />
                  </div>
                  <h3 className="mb-2 text-xl font-semibold text-slate-950">
                    {searchQuery || selectedTagIds.length > 0 ? '没有匹配的账号' : '还没有账号'}
                  </h3>
                  <p className="mb-6 max-w-[260px] text-sm leading-6 text-slate-500">
                    {searchQuery || selectedTagIds.length > 0
                      ? '换个关键词或清空标签筛选试试。'
                      : '添加第一个账号后，它会安全保存在本地数据文件中。'}
                  </p>
                  {!searchQuery && selectedTagIds.length === 0 && (
                    <Button onClick={() => setShowForm(true)} className="theme-primary-action h-11 rounded-full gap-2 px-5">
                      <Plus className="h-4 w-4" />
                      添加账号
                    </Button>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </main>

        <footer className="fixed bottom-0 left-0 right-0 z-20 border-t border-slate-200/80 bg-white/95 backdrop-blur-xl md:static">
          <div className="app-bottom-nav mx-auto flex max-w-7xl items-center justify-between px-5 pt-2 md:px-6">
            {isMobileLayout ? (
              <>
                <Button variant="ghost" size="sm" className="h-12 flex-1 flex-col gap-1 rounded-xl text-slate-600 hover:bg-slate-100" onClick={() => setShowTagManager(true)}>
                  <TagIcon className="h-5 w-5" />
                  <span className="text-[11px]">标签</span>
                </Button>
                <Button variant="ghost" size="sm" className="theme-mobile-active h-12 flex-1 flex-col gap-1 rounded-xl" onClick={() => setShowSyncPanel(true)}>
                  <Wifi className="h-5 w-5" />
                  <span className="text-[11px]">同步</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-12 flex-1 flex-col gap-1 rounded-xl text-slate-600 hover:bg-slate-100" onClick={() => setShowThemePanel(true)}>
                  <Palette className="h-5 w-5" />
                  <span className="text-[11px]">主题</span>
                </Button>
                <Button variant="ghost" size="sm" className="h-12 flex-1 flex-col gap-1 rounded-xl text-slate-600 hover:bg-slate-100" onClick={() => setGlobalShowPassword(!globalShowPassword)}>
                  {globalShowPassword ? <EyeOff className="h-5 w-5" /> : <Eye className="h-5 w-5" />}
                  <span className="text-[11px]">{globalShowPassword ? '隐藏' : '显示'}</span>
                </Button>
              </>
            ) : (
              <p className="w-full text-center text-sm text-slate-500">所有数据仅保存在本地，请定期备份。</p>
            )}
          </div>
        </footer>
      </div>

      <AccountForm
        open={showForm}
        onClose={handleCloseForm}
        onSubmit={editAccount ? handleUpdateAccount : handleAddAccount}
        editAccount={editAccount}
        appendNewAccount={appendNewAccountInForm}
        tags={tags}
        relatedAccounts={
          editAccount?.id
            ? accounts.filter((account) => account.platform === editAccount.platform)
            : editAccount
              ? [editAccount]
              : []
        }
      />

      <TagManager
        open={showTagManager}
        onClose={() => setShowTagManager(false)}
        tags={tags}
        accounts={accounts}
        addTag={addTag}
        updateTag={updateTag}
        deleteTag={deleteTag}
        reorderTags={reorderTags}
      />

      <SyncPanel open={showSyncPanel} onClose={() => setShowSyncPanel(false)} onSynced={refreshSilently} />

      <ThemePanel
        open={showThemePanel}
        onClose={() => setShowThemePanel(false)}
        theme={theme}
        onSave={handleUpdateTheme}
      />

      {showScrollButtons && (
        <>
          <button
            onClick={scrollToBottom}
            className="fixed bottom-20 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-lg transition-colors hover:bg-slate-50"
            title="到底部"
          >
            <ChevronDown className="h-5 w-5" />
          </button>
          <button
            onClick={scrollToTop}
            className="fixed bottom-32 right-4 z-30 flex h-11 w-11 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-600 shadow-lg transition-colors hover:bg-slate-50"
            title="回顶部"
          >
            <ChevronUp className="h-5 w-5" />
          </button>
        </>
      )}

      {deleteConfirmAccount && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/35 px-4 backdrop-blur-sm">
          <div className="w-full max-w-md rounded-xl border border-slate-200 bg-white p-5 shadow-2xl animate-scale-in">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
                <AlertTriangle className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-slate-950">确认删除</h3>
                <p className="text-sm text-slate-500">删除后可在 10 秒内撤销</p>
              </div>
            </div>
            <div className="mb-4 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm">
              <p><span className="font-medium">平台：</span>{deleteConfirmAccount.platform}</p>
              <p><span className="font-medium">账号：</span>{deleteConfirmAccount.username}</p>
              {deleteConfirmAccount.nickname && <p><span className="font-medium">昵称：</span>{deleteConfirmAccount.nickname}</p>}
            </div>
            <div className="flex gap-2">
              <Button variant="outline" className="flex-1 border-slate-200" onClick={() => setDeleteConfirmAccount(null)}>
                取消
              </Button>
              <Button variant="destructive" className="flex-1" onClick={confirmDelete}>
                删除
              </Button>
            </div>
          </div>
        </div>
      )}

      {toast.show && (
        <div className="fixed left-1/2 top-24 z-50 flex -translate-x-1/2 items-center gap-2.5 rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-slate-900 shadow-xl animate-fade-in-out">
          <div className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full bg-emerald-600">
            <Check className="h-3 w-3 text-white" />
          </div>
          <span className="text-sm font-medium">{toast.message}</span>
        </div>
      )}

      {showUndoToast && (
        <div className="fixed bottom-24 left-1/2 z-50 flex -translate-x-1/2 items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-slate-900 shadow-xl animate-slide-up">
          <Check className="h-4 w-4 text-emerald-600" />
          <span className="text-sm font-medium">账号已删除</span>
          <span className="text-xs text-slate-500">({undoCountdown}s)</span>
          <Button size="sm" variant="outline" className="ml-1 border-slate-200" onClick={undoDelete}>
            撤销
          </Button>
        </div>
      )}
    </div>
  );
}

export default App;
