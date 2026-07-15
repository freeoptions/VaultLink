import { useState, useEffect, useRef } from 'react';
import { Account, STORAGE_KEY, Tag, TAGS_STORAGE_KEY, THEME_STORAGE_KEY } from '../types';
import { invoke } from '@tauri-apps/api/core';
import { DEFAULT_THEME, ThemeConfig, normalizeThemeConfig } from '../lib/theme';

const loadFromFile = async (): Promise<{ accounts: Account[]; tags: Tag[]; theme: ThemeConfig }> => {
  const normalizeAccounts = (accounts: Account[] = []) =>
    accounts.map(account => ({
      ...account,
      tabName: account.tabName?.trim() || undefined,
      isDeleted: account.isDeleted ?? false,
    }));

  const normalizeTags = (tags: Tag[] = []) =>
    tags.map(tag => ({
      ...tag,
      updatedAt: tag.updatedAt ?? tag.createdAt,
      isDeleted: tag.isDeleted ?? false,
    }));

  try {
    const data = await invoke<string>('read_data_file');
    const parsed = JSON.parse(data);
    return {
      accounts: normalizeAccounts(parsed.accounts || []),
      tags: normalizeTags(parsed.tags || []),
      theme: normalizeThemeConfig(parsed.theme),
    };
  } catch {
    // 首次运行或读取失败，尝试从 localStorage 迁移
    const localAccounts = localStorage.getItem(STORAGE_KEY);
    const localTags = localStorage.getItem(TAGS_STORAGE_KEY);
    const localTheme = localStorage.getItem(THEME_STORAGE_KEY);
    const accounts = localAccounts ? JSON.parse(localAccounts) : [];
    const tags = localTags ? JSON.parse(localTags) : [];
    return {
      accounts: normalizeAccounts(accounts),
      tags: normalizeTags(tags),
      theme: normalizeThemeConfig(localTheme ? JSON.parse(localTheme) : null),
    };
  }
};

const saveToFile = (accounts: Account[], tags: Tag[], theme: ThemeConfig) => {
  const data = JSON.stringify({ accounts, tags, theme });
  invoke('write_data_file', { data }).catch(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(accounts));
    localStorage.setItem(TAGS_STORAGE_KEY, JSON.stringify(tags));
    localStorage.setItem(THEME_STORAGE_KEY, JSON.stringify(theme));
  });
};

export const useAccounts = () => {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [tags, setTags] = useState<Tag[]>([]);
  const [theme, setTheme] = useState<ThemeConfig>(DEFAULT_THEME);
  const [isLoading, setIsLoading] = useState(true);
  const accountsRef = useRef<Account[]>([]);
  const tagsRef = useRef<Tag[]>([]);
  const themeRef = useRef<ThemeConfig>(DEFAULT_THEME);
  const hasLoadedOnceRef = useRef(false);

  const refresh = async (options?: { silent?: boolean }) => {
    const shouldKeepCurrentView = Boolean(options?.silent && hasLoadedOnceRef.current);
    if (!shouldKeepCurrentView) {
      setIsLoading(true);
    }
    const { accounts, tags, theme } = await loadFromFile();
    setAccounts(accounts);
    accountsRef.current = accounts;
    const sortedTags = [...tags].sort((a, b) => {
      if (a.order !== undefined && b.order !== undefined) {
        return a.order - b.order;
      }
      if (a.order !== undefined) return -1;
      if (b.order !== undefined) return 1;
      return a.name.localeCompare(b.name, 'zh-CN');
    });
    setTags(sortedTags);
    tagsRef.current = sortedTags;
    setTheme(theme);
    themeRef.current = theme;
    hasLoadedOnceRef.current = true;
    if (!shouldKeepCurrentView) {
      setIsLoading(false);
    }
  };

  const refreshSilently = async () => {
    await refresh({ silent: true });
  };

  useEffect(() => {
    refresh();
  }, []);

  const visibleAccounts = accounts.filter(account => !account.isDeleted);
  const visibleTags = tags.filter(tag => !tag.isDeleted);

  const saveData = (newAccounts: Account[], newTags: Tag[], nextTheme: ThemeConfig = themeRef.current) => {
    accountsRef.current = newAccounts;
    tagsRef.current = newTags;
    themeRef.current = nextTheme;
    setAccounts(newAccounts);
    setTags(newTags);
    setTheme(nextTheme);
    saveToFile(newAccounts, newTags, nextTheme);
  };

  const addAccount = (account: Omit<Account, 'id' | 'createdAt' | 'updatedAt'>) => {
    const newAccount: Account = {
      ...account,
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      isDeleted: false,
    };
    const updated = [newAccount, ...accountsRef.current];
    saveData(updated, tagsRef.current);
    return newAccount;
  };

  const updateAccount = (id: string, updates: Partial<Account>) => {
    const updated = accountsRef.current.map(acc =>
      acc.id === id
        ? { ...acc, ...updates, updatedAt: Date.now() }
        : acc
    );

    const targetAccount = updated.find(acc => acc.id === id);
    const otherAccounts = updated.filter(acc => acc.id !== id);

    if (targetAccount) {
      saveData([targetAccount, ...otherAccounts], tagsRef.current);
    } else {
      saveData(updated, tagsRef.current);
    }
  };

  const deleteAccount = (id: string) => {
    const updated = accountsRef.current.map(acc =>
      acc.id === id
        ? { ...acc, isDeleted: true, updatedAt: Date.now() }
        : acc
    );
    saveData(updated, tagsRef.current);
  };

  const restoreAccount = (id: string) => {
    const updated = accountsRef.current.map(acc =>
      acc.id === id
        ? { ...acc, isDeleted: false, updatedAt: Date.now() }
        : acc
    );
    saveData(updated, tagsRef.current);
  };

  const addTag = (name: string, color: string) => {
    const newTag: Tag = {
      id: crypto.randomUUID(),
      name,
      color,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      order: tagsRef.current.length,
      isDeleted: false,
    };
    const updated = [...tagsRef.current, newTag];
    saveData(accountsRef.current, updated);
    return newTag;
  };

  const updateTag = (id: string, updates: Partial<Omit<Tag, 'id' | 'createdAt'>>) => {
    const updated = tagsRef.current.map(tag =>
      tag.id === id ? { ...tag, ...updates, updatedAt: Date.now() } : tag
    );
    saveData(accountsRef.current, updated);
  };

  const deleteTag = (id: string) => {
    const now = Date.now();
    const updatedTags = tagsRef.current.map(tag =>
      tag.id === id ? { ...tag, isDeleted: true, updatedAt: now } : tag
    );
    const updatedAccounts = accountsRef.current.map(acc => ({
      ...acc,
      tags: acc.tags?.filter(tagId => tagId !== id) || [],
      updatedAt: acc.tags?.includes(id) ? now : acc.updatedAt,
    }));
    saveData(updatedAccounts, updatedTags);
  };

  const reorderTags = (newTags: Tag[]) => {
    saveData(accountsRef.current, newTags);
  };

  const updateTheme = (nextTheme: ThemeConfig) => {
    saveData(accountsRef.current, tagsRef.current, normalizeThemeConfig(nextTheme));
  };

  const getTagById = (id: string) => {
    return visibleTags.find(tag => tag.id === id);
  };

  return {
    accounts: visibleAccounts,
    tags: visibleTags,
    theme,
    isLoading,
    addAccount,
    updateAccount,
    deleteAccount,
    restoreAccount,
    addTag,
    updateTag,
    deleteTag,
    reorderTags,
    updateTheme,
    getTagById,
    refresh,
    refreshSilently,
  };
};
