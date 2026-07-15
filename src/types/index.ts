export interface Account {
  id: string;
  platform: string;
  tabName?: string;
  username: string;
  nickname?: string;
  password: string;
  email?: string;
  phone?: string;
  notes?: string;
  createdAt: number;
  updatedAt: number;
  tags?: string[];
  isDeleted?: boolean;
}

export interface Tag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
  updatedAt: number;
  order?: number;
  isDeleted?: boolean;
}

export const STORAGE_KEY = 'my_account_manager_data';
export const TAGS_STORAGE_KEY = 'my_account_manager_tags';
export const THEME_STORAGE_KEY = 'vaultlink_theme';
