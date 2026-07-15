import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
  Check,
  Copy,
  CopyPlus,
  Edit,
  Eye,
  EyeOff,
  KeyRound,
  Mail,
  Phone,
  Plus,
  StickyNote,
  Trash2,
  UserRound,
} from 'lucide-react';
import * as Tabs from '@radix-ui/react-tabs';
import { Account, Tag } from '../types';
import { Card, CardContent, CardHeader, CardTitle } from './ui/card';
import { Button } from './ui/button';
import { cn } from '../lib/utils';

interface AccountCardProps {
  accounts: Account[];
  onEdit: (account: Account) => void;
  onDelete: (account: Account) => void;
  onCopy?: (account: Account) => void;
  onAddToPlatform?: (account: Account) => void;
  onCopySuccess?: (message: string) => void;
  tags: Tag[];
  globalShowPassword?: boolean;
}

const maskPassword = (password: string) => '•'.repeat(Math.max(6, Math.min(password.length, 12)));

const getTabLabel = (item: Account, index: number, total: number) => {
  const explicitName = item.tabName?.trim();
  if (explicitName) return explicitName;
  const nickname = item.nickname?.trim();
  if (nickname) return nickname;
  if (total === 1 || index === 0) return '主账号';
  return `账号 ${index + 1}`;
};

export const AccountCard = ({
  accounts,
  onEdit,
  onDelete,
  onCopy,
  onAddToPlatform,
  onCopySuccess,
  tags,
  globalShowPassword = false,
}: AccountCardProps) => {
  const [showPassword, setShowPassword] = useState(false);
  const [copiedField, setCopiedField] = useState<string | null>(null);
  const [activeAccountId, setActiveAccountId] = useState(accounts[0]?.id ?? '');

  useEffect(() => {
    if (!accounts.some((account) => account.id === activeAccountId)) {
      setActiveAccountId(accounts[0]?.id ?? '');
    }
    setShowPassword(false);
  }, [accounts, activeAccountId]);

  const account = useMemo(
    () => accounts.find((item) => item.id === activeAccountId) ?? accounts[0],
    [accounts, activeAccountId],
  );

  const accountTags = ((account?.tags || []) as string[])
    .map((tagId) => tags.find((tag) => tag.id === tagId))
    .filter((tag): tag is Tag => tag !== undefined);

  const activeLabel = account
    ? getTabLabel(account, accounts.findIndex((item) => item.id === account.id), accounts.length)
    : '';

  const copyToClipboard = async (text: string, fieldName: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedField(fieldName);
      onCopySuccess?.(`${fieldName}已复制`);
      setTimeout(() => setCopiedField(null), 1600);
    } catch {
      onCopySuccess?.(`${fieldName}复制失败`);
    }
  };

  const CopyButton = ({ value, fieldName }: { value: string; fieldName: string }) => (
    <Button
      variant="ghost"
      size="icon"
      className="h-8 w-8 flex-shrink-0 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
      onClick={() => copyToClipboard(value, fieldName)}
      title={`复制${fieldName}`}
    >
      {copiedField === fieldName ? <Check className="h-4 w-4 text-emerald-600" /> : <Copy className="h-4 w-4" />}
    </Button>
  );

  const FieldBlock = ({
    icon,
    label,
    value,
    copyValue,
    mono,
    action,
  }: {
    icon?: ReactNode;
    label: string;
    value: ReactNode;
    copyValue?: string;
    mono?: boolean;
    action?: ReactNode;
  }) => (
    <div className="rounded-lg border border-slate-200/80 bg-[#f8faf9] p-3">
      <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
        {icon}
        {label}
      </div>
      <div className="flex min-w-0 items-center gap-1">
        <span
          className={cn(
            'min-w-0 flex-1 truncate text-sm font-semibold text-slate-950',
            mono && 'font-mono tracking-wide',
          )}
        >
          {value}
        </span>
        {action}
        {copyValue && <CopyButton value={copyValue} fieldName={label} />}
      </div>
    </div>
  );

  if (!account) {
    return null;
  }

  return (
    <Card className="theme-card overflow-hidden border-slate-200 bg-white shadow-sm transition-all duration-200 hover:shadow-md">
      <CardHeader className="theme-card-header space-y-3 border-b border-slate-100 p-4">
        <div className="flex min-w-0 items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <CardTitle className="truncate text-lg font-semibold tracking-normal text-slate-950">
              {account.platform}
            </CardTitle>
            <p className="mt-1 truncate text-sm text-slate-500">
              {accounts.length > 1 ? `已合并 ${accounts.length} 个账号 · 当前：${activeLabel}` : `当前：${activeLabel}`}
            </p>
          </div>

          <div className="flex flex-shrink-0 items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              className="h-8 w-8 rounded-lg border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950"
              onClick={() => onEdit(account)}
              title="编辑"
            >
              <Edit className="h-4 w-4" />
            </Button>
            {onCopy && (
              <Button
                variant="outline"
                size="icon"
                className="h-8 w-8 rounded-lg border-slate-200 bg-white text-slate-500 hover:bg-slate-50 hover:text-slate-950"
                onClick={() => onCopy(account)}
                title="复制为新账号"
              >
                <CopyPlus className="h-4 w-4" />
              </Button>
            )}
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-lg text-slate-400 hover:bg-red-50 hover:text-red-600"
              onClick={() => onDelete(account)}
              title="删除当前 Tab 账号"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        </div>

        <Tabs.Root value={account.id} onValueChange={setActiveAccountId}>
          <Tabs.List className="flex gap-2 overflow-x-auto pb-0.5">
            {accounts.map((item, index) => (
              <Tabs.Trigger
                key={item.id}
                value={item.id}
                className="theme-tab-trigger h-8 max-w-[116px] flex-shrink-0 truncate rounded-full border border-slate-200 bg-white px-3 text-xs font-medium text-slate-600 transition-all"
                title={getTabLabel(item, index, accounts.length)}
              >
                {getTabLabel(item, index, accounts.length)}
              </Tabs.Trigger>
            ))}
            {onAddToPlatform && (
              <button
                type="button"
                onClick={() => onAddToPlatform(account)}
                className="theme-outline-icon flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full border border-dashed bg-white transition-colors"
                title={`在 ${account.platform} 下新增账号 Tab`}
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            )}
          </Tabs.List>
        </Tabs.Root>

        {accountTags.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {accountTags.map((tag) => (
              <span
                key={tag.id}
                className="inline-flex h-6 items-center rounded-full px-2 text-xs font-medium text-white"
                style={{ backgroundColor: tag.color }}
              >
                {tag.name}
              </span>
            ))}
          </div>
        )}
      </CardHeader>

      <CardContent className="space-y-2.5 p-4">
        <FieldBlock
          icon={<UserRound className="h-3.5 w-3.5" />}
          label="账号"
          value={account.username}
          copyValue={account.username}
        />

        <FieldBlock
          icon={<KeyRound className="h-3.5 w-3.5" />}
          label="密码"
          mono
          value={globalShowPassword || showPassword ? account.password : maskPassword(account.password)}
          copyValue={account.password}
          action={
            !globalShowPassword ? (
              <Button
                variant="ghost"
                size="icon"
                className="h-8 w-8 flex-shrink-0 rounded-lg text-slate-500 hover:bg-slate-200/70 hover:text-slate-900"
                onClick={() => setShowPassword((value) => !value)}
                title={showPassword ? '隐藏密码' : '显示密码'}
              >
                {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
              </Button>
            ) : null
          }
        />

        {account.email && (
          <FieldBlock
            icon={<Mail className="h-3.5 w-3.5" />}
            label="邮箱"
            value={account.email}
            copyValue={account.email}
          />
        )}

        {account.phone && (
          <FieldBlock
            icon={<Phone className="h-3.5 w-3.5" />}
            label="手机号"
            value={account.phone}
            copyValue={account.phone}
          />
        )}

        {account.notes && (
          <div className="rounded-lg border border-slate-200/80 bg-[#f8faf9] p-3">
            <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">
              <StickyNote className="h-3.5 w-3.5" />
              备注
            </div>
            <div className="flex items-start gap-2">
              <span className="max-h-24 min-w-0 flex-1 overflow-y-auto whitespace-pre-wrap break-words text-sm leading-6 text-slate-600">
                {account.notes}
              </span>
              <CopyButton value={account.notes} fieldName="备注" />
            </div>
          </div>
        )}

        {onAddToPlatform && (
          <button
            type="button"
            onClick={() => onAddToPlatform(account)}
            className="theme-dashed-action flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-dashed text-sm font-semibold transition-colors"
          >
            <Plus className="h-4 w-4" />
            在 {account.platform} 下新增一个账号 Tab
          </button>
        )}
      </CardContent>
    </Card>
  );
};
