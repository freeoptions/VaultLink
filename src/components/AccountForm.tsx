import { type FormEvent, useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Plus, Tag as TagIcon, X } from 'lucide-react';
import { Account, Tag } from '../types';
import { cn } from '../lib/utils';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Textarea } from './ui/textarea';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from './ui/dialog';

type AccountItemFormData = {
  key: string;
  tabName: string;
  username: string;
  nickname: string;
  password: string;
  email: string;
  phone: string;
  notes: string;
  tags: string[];
};

type AccountFormSubmitData = {
  platform: string;
  accounts: Array<Omit<Account, 'id' | 'createdAt' | 'updatedAt' | 'platform'> & { sourceId?: string }>;
};

interface AccountFormProps {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: AccountFormSubmitData) => void;
  editAccount?: Account | null;
  appendNewAccount?: boolean;
  tags: Tag[];
  relatedAccounts?: Account[];
}

const createEmptyAccountItem = (): AccountItemFormData => ({
  key: crypto.randomUUID(),
  tabName: '',
  username: '',
  nickname: '',
  password: '',
  email: '',
  phone: '',
  notes: '',
  tags: [],
});

const buildItemFromAccount = (account?: Account | null): AccountItemFormData => ({
  key: account?.id || crypto.randomUUID(),
  tabName: account?.tabName || '',
  username: account?.username || '',
  nickname: account?.nickname || '',
  password: account?.password || '',
  email: account?.email || '',
  phone: account?.phone || '',
  notes: account?.notes || '',
  tags: account?.tags || [],
});

const isMeaningfulItem = (item: AccountItemFormData) =>
  Boolean(
    item.tabName.trim() ||
      item.username.trim() ||
      item.nickname.trim() ||
      item.password.trim() ||
      item.email.trim() ||
      item.phone.trim() ||
      item.notes.trim() ||
      item.tags.length > 0,
  );

export const AccountForm = ({
  open,
  onClose,
  onSubmit,
  editAccount,
  appendNewAccount = false,
  tags,
  relatedAccounts = [],
}: AccountFormProps) => {
  const relatedAccountsMap = useMemo(() => {
    const source = relatedAccounts.length > 0
      ? relatedAccounts
      : editAccount
        ? [editAccount]
        : [];

    const unique = new Map<string, Account>();
    source.forEach((account) => {
      if (account.id) {
        unique.set(account.id, account);
      }
    });

    return Array.from(unique.values());
  }, [editAccount, relatedAccounts]);

  const buildFormState = () => {
    if (relatedAccountsMap.length > 0) {
      return {
        platform: relatedAccountsMap[0].platform || '',
        items: relatedAccountsMap.map((account) => buildItemFromAccount(account)),
      };
    }

    if (editAccount) {
      return {
        platform: editAccount.platform || '',
        items: [buildItemFromAccount(editAccount)],
      };
    }

    return {
      platform: '',
      items: [createEmptyAccountItem()],
    };
  };

  const [platform, setPlatform] = useState('');
  const [items, setItems] = useState<AccountItemFormData[]>([createEmptyAccountItem()]);
  const [activeKey, setActiveKey] = useState('');
  const [showUnsavedAlert, setShowUnsavedAlert] = useState(false);
  const [formError, setFormError] = useState('');
  const initialDataRef = useRef<string>('');

  useEffect(() => {
    if (!open) return;

    const state = buildFormState();
    const nextItems = appendNewAccount && state.platform
      ? [...state.items, createEmptyAccountItem()]
      : state.items;
    const nextActiveKey = appendNewAccount && nextItems.length > 0
      ? nextItems[nextItems.length - 1].key
      : nextItems[0]?.key || '';

    setPlatform(state.platform);
    setItems(nextItems);
    setActiveKey(nextActiveKey);
    setFormError('');
    initialDataRef.current = JSON.stringify({ platform: state.platform, items: nextItems });
  }, [open, editAccount, relatedAccountsMap, appendNewAccount]);

  const activeIndex = items.findIndex((item) => item.key === activeKey);
  const activeItem = activeIndex >= 0 ? items[activeIndex] : items[0];

  const getDefaultTabName = (index: number) => {
    if (items.length === 1 || index === 0) return '主账号';
    return `账号 ${index + 1}`;
  };

  const getCardTitle = (item: AccountItemFormData, index: number) =>
    item.tabName.trim() || item.nickname.trim() || getDefaultTabName(index);

  const getCardDetail = (item: AccountItemFormData) =>
    item.username.trim() || item.email.trim() || item.phone.trim() || '未填写账号信息';

  const hasUnsavedChanges = () => {
    const current = JSON.stringify({ platform, items });
    return current !== initialDataRef.current;
  };

  const updateItem = (key: string, updates: Partial<AccountItemFormData>) => {
    setFormError('');
    setItems((current) =>
      current.map((item) => (item.key === key ? { ...item, ...updates } : item))
    );
  };

  const updateActiveItem = (updates: Partial<AccountItemFormData>) => {
    if (!activeItem) return;
    updateItem(activeItem.key, updates);
  };

  const addSubAccount = () => {
    const newItem = createEmptyAccountItem();
    setItems((current) => [...current, newItem]);
    setActiveKey(newItem.key);
    setFormError('');
  };

  const removeSubAccount = (key: string) => {
    if (items.length <= 1) return;

    const removedIndex = items.findIndex((item) => item.key === key);
    const nextItems = items.filter((item) => item.key !== key);
    setItems(nextItems);
    if (activeKey === key) {
      const nextIndex = Math.max(0, Math.min(removedIndex, nextItems.length - 1));
      setActiveKey(nextItems[nextIndex]?.key || '');
    }
  };

  const toggleTag = (tagId: string) => {
    if (!activeItem) return;
    updateActiveItem({
      tags: activeItem.tags.includes(tagId)
        ? activeItem.tags.filter((id) => id !== tagId)
        : [...activeItem.tags, tagId],
    });
  };

  const handleForceClose = () => {
    setPlatform('');
    const emptyItem = createEmptyAccountItem();
    setItems([emptyItem]);
    setActiveKey(emptyItem.key);
    setFormError('');
    initialDataRef.current = '';
    onClose();
  };

  const handleClose = () => {
    if (hasUnsavedChanges()) {
      setShowUnsavedAlert(true);
      return;
    }
    handleForceClose();
  };

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();

    const trimmedPlatform = platform.trim();
    if (!trimmedPlatform) {
      setFormError('请先填写软件名称。');
      return;
    }

    const meaningfulItems = items.filter(isMeaningfulItem);
    const submitItems = meaningfulItems.length > 0 ? meaningfulItems : items;

    const submitData: AccountFormSubmitData = {
      platform: trimmedPlatform,
      accounts: submitItems.map((item) => ({
        sourceId: item.key,
        tabName: item.tabName.trim() || undefined,
        username: item.username.trim() || '暂无',
        nickname: item.nickname.trim() || undefined,
        password: item.password || '暂无',
        email: item.email.trim() || undefined,
        phone: item.phone.trim() || undefined,
        notes: item.notes.trim() || undefined,
        tags: item.tags,
        isDeleted: false,
      })),
    };

    onSubmit(submitData);
    handleForceClose();
  };

  const title = appendNewAccount && editAccount
    ? `新增 ${editAccount.platform} 账号`
    : editAccount?.id
      ? '编辑账号'
      : editAccount
        ? '添加新账号（复制）'
        : '添加账号';

  const description = appendNewAccount && editAccount
    ? '已为当前软件打开一个空白账号 Tab，填写后保存全部账号。'
    : editAccount?.id
      ? '同一个软件下的多个账号会集中在左侧工作区。'
      : '先填写软件名称，再用账号工作区连续添加多个账号 Tab。';

  return (
    <>
      <Dialog open={open} onOpenChange={(nextOpen) => !nextOpen && handleClose()}>
        <DialogContent className="account-form-dialog border-white/70 bg-white p-0 shadow-[0_28px_80px_rgba(15,23,42,0.18)]">
          <DialogHeader className="account-form-header border-b border-slate-200 px-5 py-5 text-left sm:px-6">
            <DialogTitle className="text-2xl font-semibold text-slate-950">{title}</DialogTitle>
            <DialogDescription className="text-slate-500">{description}</DialogDescription>
          </DialogHeader>

          <form onSubmit={handleSubmit} autoComplete="off" data-form-type="other" className="min-h-0">
            <input type="text" name="username_trap" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
            <input type="password" name="password_trap" style={{ display: 'none' }} tabIndex={-1} autoComplete="off" />
            <input type="text" style={{ display: 'none' }} autoComplete="off" />
            <input type="password" style={{ display: 'none' }} autoComplete="off" />

            <div className="account-form-layout">
              <aside className="account-form-sidebar">
                <div className="mb-4 flex items-center justify-between gap-3">
                  <h3 className="text-sm font-semibold text-slate-950">账号工作区</h3>
                  <span className="theme-primary-soft-icon rounded-full px-2.5 py-1 text-xs font-semibold">
                    {items.length} 个
                  </span>
                </div>

                <div className="grid gap-2">
                  {items.map((item, index) => {
                    const isActive = item.key === activeKey;

                    return (
                      <div
                        key={item.key}
                        role="button"
                        tabIndex={0}
                        onClick={() => setActiveKey(item.key)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' || event.key === ' ') {
                            event.preventDefault();
                            setActiveKey(item.key);
                          }
                        }}
                        className={cn(
                          'account-form-subcard',
                          isActive && 'account-form-subcard-active',
                        )}
                      >
                        <span className="account-form-subindex">{index === 0 ? '主' : index + 1}</span>
                        <span className="min-w-0 flex-1 text-left">
                          <span className="block truncate text-sm font-semibold">
                            {getCardTitle(item, index)}
                          </span>
                          <span className={cn('mt-1 block truncate text-xs', isActive ? 'text-white/72' : 'text-slate-500')}>
                            {getCardDetail(item)}
                          </span>
                        </span>
                        {items.length > 1 && (
                          <button
                            type="button"
                            onClick={(event) => {
                              event.stopPropagation();
                              removeSubAccount(item.key);
                            }}
                            className={cn(
                              'account-form-delete',
                              isActive ? 'text-white/72 hover:bg-white/15 hover:text-white' : 'text-slate-400 hover:bg-slate-200 hover:text-slate-700',
                            )}
                            title="删除这个账号 Tab"
                          >
                            <X className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })}

                  <button type="button" onClick={addSubAccount} className="account-form-add-tab">
                    <Plus className="h-4 w-4" />
                    新增账号 Tab
                  </button>
                </div>
              </aside>

              <section className="account-form-main">
                <div className="account-form-tabs">
                  {items.map((item, index) => (
                    <button
                      key={item.key}
                      type="button"
                      onClick={() => setActiveKey(item.key)}
                      className={cn(
                        'account-form-tab',
                        item.key === activeKey && 'account-form-tab-active',
                      )}
                    >
                      {getCardTitle(item, index)}
                    </button>
                  ))}
                  <button type="button" onClick={addSubAccount} className="account-form-tab account-form-tab-add">
                    <Plus className="h-3.5 w-3.5" />
                    新增
                  </button>
                </div>

                {formError && (
                  <div className="mb-4 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-sm font-medium text-amber-900">
                    {formError}
                  </div>
                )}

                <div className="account-form-grid">
                  <div className="grid gap-2">
                    <label htmlFor="platform" className="text-sm font-medium text-slate-800">
                      软件名称 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="platform"
                      name="platform"
                      placeholder="例如：GitHub、Google、Netflix"
                      value={platform}
                      onChange={(e) => {
                        setFormError('');
                        setPlatform(e.target.value);
                      }}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="tabName" className="text-sm font-medium text-slate-800">
                      Tab 名称
                    </label>
                    <Input
                      id="tabName"
                      name="tabName"
                      placeholder={activeIndex <= 0 ? '主账号' : `账号 ${activeIndex + 1}`}
                      value={activeItem?.tabName || ''}
                      onChange={(e) => updateActiveItem({ tabName: e.target.value })}
                      autoComplete="off"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="username" className="text-sm font-medium text-slate-800">
                      账号 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="username"
                      name="username"
                      placeholder="用户名、手机号或邮箱"
                      value={activeItem?.username || ''}
                      onChange={(e) => updateActiveItem({ username: e.target.value })}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="nickname" className="text-sm font-medium text-slate-800">
                      昵称
                    </label>
                    <Input
                      id="nickname"
                      name="nickname"
                      placeholder="账号昵称或备注名"
                      value={activeItem?.nickname || ''}
                      onChange={(e) => updateActiveItem({ nickname: e.target.value })}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="password" className="text-sm font-medium text-slate-800">
                      密码 <span className="text-destructive">*</span>
                    </label>
                    <Input
                      id="password"
                      name="password"
                      type="text"
                      placeholder="密码"
                      value={activeItem?.password || ''}
                      onChange={(e) => updateActiveItem({ password: e.target.value })}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="email" className="text-sm font-medium text-slate-800">
                      邮箱
                    </label>
                    <Input
                      id="email"
                      name="email"
                      type="email"
                      placeholder="绑定邮箱"
                      value={activeItem?.email || ''}
                      onChange={(e) => updateActiveItem({ email: e.target.value })}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label htmlFor="phone" className="text-sm font-medium text-slate-800">
                      手机号
                    </label>
                    <Input
                      id="phone"
                      name="phone"
                      type="tel"
                      placeholder="绑定手机号"
                      value={activeItem?.phone || ''}
                      onChange={(e) => updateActiveItem({ phone: e.target.value })}
                      autoComplete="off"
                      data-form-type="other"
                      data-lpignore="true"
                      className="h-11 rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>

                  <div className="grid gap-2">
                    <label className="flex items-center gap-1 text-sm font-medium text-slate-800">
                      <TagIcon className="h-4 w-4" />
                      标签
                    </label>
                    {tags.length > 0 ? (
                      <div className="flex min-h-11 flex-wrap items-center gap-2">
                        {tags.map((tag) => (
                          <button
                            key={tag.id}
                            type="button"
                            onClick={() => toggleTag(tag.id)}
                            className={cn(
                              'rounded-full border px-3 py-1.5 text-sm font-medium transition-all',
                              activeItem?.tags.includes(tag.id)
                                ? 'border-transparent text-white shadow-sm'
                                : 'border-slate-200 bg-white text-slate-600 hover:bg-slate-50',
                            )}
                            style={{
                              backgroundColor: activeItem?.tags.includes(tag.id) ? tag.color : undefined,
                            }}
                          >
                            {tag.name}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <p className="flex h-11 items-center rounded-lg border border-dashed border-slate-200 bg-slate-50 px-3 text-sm text-slate-500">
                        暂无标签，请先在标签管理中添加。
                      </p>
                    )}
                  </div>

                  <div className="account-form-wide grid gap-2">
                    <label htmlFor="notes" className="text-sm font-medium text-slate-800">
                      备注
                    </label>
                    <Textarea
                      id="notes"
                      placeholder="其他需要记录的信息..."
                      value={activeItem?.notes || ''}
                      onChange={(e) => updateActiveItem({ notes: e.target.value })}
                      rows={4}
                      autoComplete="off"
                      data-lpignore="true"
                      className="min-h-[96px] rounded-lg border-slate-200 bg-white shadow-sm"
                      readOnly
                      onFocus={(e) => e.currentTarget.removeAttribute('readonly')}
                    />
                  </div>
                </div>
              </section>
            </div>

            <DialogFooter className="account-form-footer gap-2 border-t border-slate-200 bg-white/95 px-5 py-4 sm:px-6">
              <Button type="button" variant="outline" className="border-slate-200 bg-white" onClick={handleClose}>
                取消
              </Button>
              <Button type="submit" className="theme-primary-action">
                {editAccount ? '保存全部账号' : '添加账号'}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={showUnsavedAlert} onOpenChange={setShowUnsavedAlert}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-500/10">
                <AlertTriangle className="h-5 w-5 text-amber-500" />
              </div>
              <DialogTitle>未保存的修改</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              您有未保存的修改，确定要放弃吗？
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setShowUnsavedAlert(false);
                handleForceClose();
              }}
            >
              放弃修改
            </Button>
            <Button className="theme-primary-action" onClick={() => setShowUnsavedAlert(false)}>
              继续编辑
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
};
