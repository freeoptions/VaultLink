import { useState } from 'react';
import { Tag } from '../types';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from './ui/dialog';
import { Button } from './ui/button';
import { Input } from './ui/input';
import { Label } from './ui/label';
import { Plus, Trash2, Edit2, Check, X, AlertTriangle, GripVertical } from 'lucide-react';

interface TagManagerProps {
  open: boolean;
  onClose: () => void;
  tags: Tag[];
  accounts: Array<{ tags?: string[] }>;
  addTag: (name: string, color: string) => void;
  updateTag: (id: string, updates: Partial<Pick<Tag, 'name' | 'color' | 'order'>>) => void;
  reorderTags: (tags: Tag[]) => void;
  deleteTag: (id: string) => void;
}

const PRESET_COLORS = [
  '#2563eb', // blue
  '#475569', // slate
  '#059669', // green
  '#d97706', // amber
  '#dc2626', // red
  '#c026d3', // fuchsia
  '#0284c7', // sky
  '#65a30d', // lime
  '#ea580c', // orange
  '#4f46e5', // indigo
];

export const TagManager = ({ open, onClose, tags, accounts, addTag, updateTag, reorderTags, deleteTag }: TagManagerProps) => {
  const [newTagName, setNewTagName] = useState('');
  const [selectedColor, setSelectedColor] = useState(PRESET_COLORS[0]);
  const [customColor, setCustomColor] = useState(PRESET_COLORS[0]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState('');
  const [editingColorId, setEditingColorId] = useState<string | null>(null);
  const [deleteConfirmTag, setDeleteConfirmTag] = useState<Tag | null>(null);

  const handleAddTag = () => {
    if (newTagName.trim()) {
      addTag(newTagName.trim(), selectedColor);
      setNewTagName('');
      setSelectedColor(PRESET_COLORS[0]);
    }
  };

  const handleMoveTag = (tagIndex: number, direction: 'up' | 'down') => {
    const newIndex = direction === 'up' ? tagIndex - 1 : tagIndex + 1;
    if (newIndex < 0 || newIndex >= tags.length) return;

    // 创建新的标签数组
    const newTags = [...tags];
    // 交换位置
    [newTags[tagIndex], newTags[newIndex]] = [newTags[newIndex], newTags[tagIndex]];

    // 更新所有标签的 order
    const reorderedTags = newTags.map((tag, index) => ({
      ...tag,
      order: index,
    }));

    reorderTags(reorderedTags);
  };

  const handleSaveEdit = (id: string) => {
    if (editName.trim()) {
      updateTag(id, { name: editName.trim() });
    }
    setEditingId(null);
    setEditName('');
  };

  const handleStartEdit = (tag: Tag) => {
    setEditingId(tag.id);
    setEditName(tag.name);
  };

  const handleStartEditColor = (tag: Tag) => {
    setEditingColorId(tag.id);
    setCustomColor(tag.color);
  };

  const handleSaveColor = () => {
    if (editingColorId) {
      updateTag(editingColorId, { color: customColor });
      setEditingColorId(null);
    }
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const handleDeleteTag = (tag: Tag) => {
    // 检查是否有账号使用了该标签
    const isUsed = accounts.some(account => account.tags?.includes(tag.id));

    if (isUsed) {
      // 有账号使用，显示确认对话框
      setDeleteConfirmTag(tag);
    } else {
      // 没有账号使用，直接删除
      deleteTag(tag.id);
    }
  };

  const confirmDelete = () => {
    if (deleteConfirmTag) {
      deleteTag(deleteConfirmTag.id);
      setDeleteConfirmTag(null);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>管理标签</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {/* 现有标签列表 */}
          <div className="space-y-2">
            <Label>现有标签</Label>
            <div className="space-y-2 max-h-60 overflow-y-auto">
              {tags.map((tag, index) => (
                <div
                  key={tag.id}
                  className="flex items-center gap-2 p-2 rounded-lg border bg-card"
                >
                  <GripVertical className="h-4 w-4 text-muted-foreground cursor-grab" />
                  <div
                    className="w-6 h-6 rounded-full flex-shrink-0 cursor-pointer border-2 border-transparent hover:border-primary transition-all"
                    style={{ backgroundColor: tag.color }}
                    onClick={() => handleStartEditColor(tag)}
                    title="点击修改颜色"
                  />
                  {editingId === tag.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') handleSaveEdit(tag.id);
                          if (e.key === 'Escape') handleCancelEdit();
                        }}
                        className="h-7 text-sm flex-1"
                        autoFocus
                      />
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => handleSaveEdit(tag.id)}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={handleCancelEdit}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : editingColorId === tag.id ? (
                    <div className="flex items-center gap-1 flex-1">
                      <Input
                        type="color"
                        value={customColor}
                        onChange={(e) => setCustomColor(e.target.value)}
                        className="h-7 w-12 flex-shrink-0"
                      />
                      <span className="text-xs text-muted-foreground">{customColor}</span>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={handleSaveColor}
                      >
                        <Check className="h-3 w-3" />
                      </Button>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-7 w-7"
                        onClick={() => setEditingColorId(null)}
                      >
                        <X className="h-3 w-3" />
                      </Button>
                    </div>
                  ) : (
                    <>
                      <span className="flex-1 text-sm">{tag.name}</span>
                      <div className="flex gap-1">
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleMoveTag(index, 'up')}
                          disabled={index === 0}
                          title="上移"
                        >
                          ↑
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleMoveTag(index, 'down')}
                          disabled={index === tags.length - 1}
                          title="下移"
                        >
                          ↓
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7"
                          onClick={() => handleStartEdit(tag)}
                          title="编辑名称"
                        >
                          <Edit2 className="h-3 w-3" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-7 w-7 text-destructive"
                          onClick={() => handleDeleteTag(tag)}
                          title="删除"
                        >
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </>
                  )}
                </div>
              ))}
              {tags.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">
                  还没有标签，添加一个吧
                </p>
              )}
            </div>
          </div>

          {/* 添加新标签 */}
          <div className="space-y-2 pt-2 border-t">
            <Label>添加新标签</Label>
            <div className="flex gap-2">
              <Input
                placeholder="标签名称..."
                value={newTagName}
                onChange={(e) => setNewTagName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag();
                }}
              />
              <Button
                onClick={handleAddTag}
                disabled={!newTagName.trim()}
                size="icon"
              >
                <Plus className="h-4 w-4" />
              </Button>
            </div>
            <div>
              <Label className="text-xs text-muted-foreground">选择颜色</Label>
              <div className="flex gap-2 mt-1 flex-wrap items-center">
                {PRESET_COLORS.map(color => (
                  <button
                    key={color}
                    className={`w-6 h-6 rounded-full border-2 transition-all ${
                      selectedColor === color ? 'scale-110 border-primary' : 'border-transparent'
                    }`}
                    style={{ backgroundColor: color }}
                    onClick={() => setSelectedColor(color)}
                  />
                ))}
                <div className="flex items-center gap-1 ml-2">
                  <Input
                    type="color"
                    value={customColor}
                    onChange={(e) => {
                      setCustomColor(e.target.value);
                      setSelectedColor(e.target.value);
                    }}
                    className="h-6 w-8 p-0 cursor-pointer"
                    title="自定义颜色"
                  />
                  <span className="text-xs text-muted-foreground">{customColor}</span>
                </div>
              </div>
            </div>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            关闭
          </Button>
        </DialogFooter>
      </DialogContent>

      {/* 删除确认对话框 */}
      <Dialog open={!!deleteConfirmTag} onOpenChange={(open) => !open && setDeleteConfirmTag(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-5 w-5 text-destructive" />
              </div>
              <DialogTitle>删除标签</DialogTitle>
            </div>
            <DialogDescription className="pt-2">
              确定要删除标签 <span className="font-semibold text-foreground">"{deleteConfirmTag?.name}"</span> 吗？
              <br />
              使用该标签的账号将自动移除该标签。
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDeleteConfirmTag(null)}>
              取消
            </Button>
            <Button variant="destructive" onClick={confirmDelete}>
              确认删除
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Dialog>
  );
};
