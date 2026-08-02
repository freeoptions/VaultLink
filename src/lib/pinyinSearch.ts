import { pinyin } from 'pinyin-pro';

type PinyinSearchText = {
  full: string;
  initials: string;
};

const pinyinSearchCache = new Map<string, PinyinSearchText>();

function getPinyinSearchText(value: string): PinyinSearchText {
  const cached = pinyinSearchCache.get(value);
  if (cached) return cached;

  const searchableText = {
    full: pinyin(value, {
      toneType: 'none',
      v: true,
      separator: '',
      nonZh: 'consecutive',
    }).toLowerCase(),
    initials: pinyin(value, {
      pattern: 'initial',
      toneType: 'none',
      v: true,
      type: 'array',
    }).join('').toLowerCase(),
  };

  pinyinSearchCache.set(value, searchableText);
  return searchableText;
}

/**
 * Matches literal text first, then full pinyin or initials for Chinese values.
 * Spaces in a pinyin query are ignored, so both "wei xin" and "weixin" work.
 */
export function matchesSearchQuery(value: string, query: string): boolean {
  const normalizedValue = value.toLowerCase();
  const normalizedQuery = query.trim().toLowerCase();

  if (!normalizedQuery || normalizedValue.includes(normalizedQuery)) return true;

  // Keep English and numeric searches on the original literal-match path.
  if (!/[\u3400-\u9fff]/.test(value) || !/^[a-z0-9\s]+$/i.test(normalizedQuery)) {
    return false;
  }

  const normalizedPinyinQuery = normalizedQuery.replace(/\s+/g, '');
  if (!normalizedPinyinQuery) return false;

  const searchableText = getPinyinSearchText(value);
  return searchableText.full.includes(normalizedPinyinQuery)
    || searchableText.initials.includes(normalizedPinyinQuery);
}
