'use client';

import { useState, useEffect, useRef } from 'react';
import { Heart, ChevronDown, FolderPlus, Check, Loader2 } from 'lucide-react';
import { favoriteFolderAPI, subscriptionAPI } from '@/lib/api';
import { FavoriteFolder } from '@/types';

interface FavoriteFolderSelectProps {
  articleId: number;
  isFavorited: boolean;
  currentFolderId?: number;
  onFavoriteChange: (isFavorited: boolean, folderId?: number) => void;
}

export default function FavoriteFolderSelect({
  articleId,
  isFavorited,
  currentFolderId,
  onFavoriteChange,
}: FavoriteFolderSelectProps) {
  const [folders, setFolders] = useState<FavoriteFolder[]>([]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState('');
  const [creatingFolder, setCreatingFolder] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const currentFolder = folders.find((f) => f.id === currentFolderId);
  const defaultFolder = folders.find((f) => f.is_default);

  useEffect(() => {
    if (dropdownOpen && folders.length === 0) {
      loadFolders();
    }
  }, [dropdownOpen]);

  useEffect(() => {
    if (showNewFolder) {
      inputRef.current?.focus();
    }
  }, [showNewFolder]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
        setShowNewFolder(false);
        setNewFolderName('');
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  async function loadFolders() {
    setLoading(true);
    try {
      const res = await favoriteFolderAPI.getFolders();
      setFolders(res.data.data || res.data);
    } catch {
      // silent
    } finally {
      setLoading(false);
    }
  }

  async function handleQuickFavorite() {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      if (isFavorited) {
        await subscriptionAPI.removeSubscription(articleId);
        onFavoriteChange(false);
      } else {
        const folderId = defaultFolder?.id;
        await subscriptionAPI.addSubscription(articleId, folderId);
        onFavoriteChange(true, folderId);
      }
    } catch {
      // silent
    } finally {
      setActionLoading(false);
    }
  }

  async function handleSelectFolder(folder: FavoriteFolder) {
    if (actionLoading) return;
    setActionLoading(true);
    try {
      if (isFavorited && currentFolderId === folder.id) {
        await subscriptionAPI.removeSubscription(articleId);
        onFavoriteChange(false);
      } else {
        if (isFavorited) {
          await subscriptionAPI.moveSubscription(articleId, folder.id);
        } else {
          await subscriptionAPI.addSubscription(articleId, folder.id);
        }
        onFavoriteChange(true, folder.id);
      }
      setDropdownOpen(false);
    } catch {
      // silent
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCreateFolder() {
    const name = newFolderName.trim();
    if (!name || creatingFolder) return;
    setCreatingFolder(true);
    try {
      const res = await favoriteFolderAPI.createFolder(name);
      const newFolder = res.data.data || res.data;
      setFolders((prev) => [...prev, newFolder]);
      setNewFolderName('');
      setShowNewFolder(false);
      await handleSelectFolder(newFolder);
    } catch {
      // silent
    } finally {
      setCreatingFolder(false);
    }
  }

  const buttonLabel = isFavorited && currentFolder ? currentFolder.name : '收藏';

  return (
    <div ref={containerRef} className="relative inline-flex">
      <button
        onClick={handleQuickFavorite}
        disabled={actionLoading}
        className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-sm font-medium rounded-l-lg border transition-colors ${
          isFavorited
            ? 'bg-red-500/10 text-red-400 border-red-500/30 hover:bg-red-500/20'
            : 'bg-gray-800 text-gray-300 border-gray-700 hover:bg-gray-700 hover:text-white'
        } disabled:opacity-50`}
      >
        {actionLoading ? (
          <Loader2 className="w-4 h-4 animate-spin" />
        ) : (
          <Heart className={`w-4 h-4 ${isFavorited ? 'fill-current' : ''}`} />
        )}
        <span>{buttonLabel}</span>
      </button>

      <button
        onClick={() => setDropdownOpen(!dropdownOpen)}
        className="inline-flex items-center px-1.5 py-1.5 text-sm border-l-0 rounded-r-lg border transition-colors bg-gray-800 text-gray-400 border-gray-700 hover:bg-gray-700 hover:text-white"
      >
        <ChevronDown
          className={`w-4 h-4 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
        />
      </button>

      {dropdownOpen && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-gray-900 border border-gray-700 rounded-lg shadow-xl z-50 overflow-hidden">
          {loading ? (
            <div className="flex items-center justify-center py-4">
              <Loader2 className="w-5 h-5 animate-spin text-gray-400" />
            </div>
          ) : (
            <>
              <div className="max-h-60 overflow-y-auto">
                {folders.map((folder) => (
                  <button
                    key={folder.id}
                    onClick={() => handleSelectFolder(folder)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-left hover:bg-gray-800 transition-colors"
                  >
                    <span className="text-base">{folder.icon || '📁'}</span>
                    <span className="flex-1 text-gray-200 truncate">{folder.name}</span>
                    {currentFolderId === folder.id && isFavorited && (
                      <Check className="w-4 h-4 text-blue-400 shrink-0" />
                    )}
                    {folder.article_count != null && (
                      <span className="text-xs text-gray-500">{folder.article_count}</span>
                    )}
                  </button>
                ))}
                {folders.length === 0 && (
                  <div className="px-3 py-3 text-sm text-gray-500 text-center">
                    暂无收藏夹
                  </div>
                )}
              </div>

              <div className="border-t border-gray-700">
                {showNewFolder ? (
                  <div className="flex items-center gap-1 px-2 py-1.5">
                    <input
                      ref={inputRef}
                      type="text"
                      value={newFolderName}
                      onChange={(e) => setNewFolderName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') handleCreateFolder();
                        if (e.key === 'Escape') {
                          setShowNewFolder(false);
                          setNewFolderName('');
                        }
                      }}
                      placeholder="新建收藏夹名称..."
                      className="flex-1 bg-transparent text-sm text-gray-200 placeholder-gray-500 outline-none px-1 py-0.5"
                      disabled={creatingFolder}
                    />
                    <button
                      onClick={handleCreateFolder}
                      disabled={!newFolderName.trim() || creatingFolder}
                      className="p-1 text-blue-400 hover:text-blue-300 disabled:opacity-40"
                    >
                      {creatingFolder ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Check className="w-4 h-4" />
                      )}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => setShowNewFolder(true)}
                    className="w-full flex items-center gap-2 px-3 py-2 text-sm text-gray-400 hover:text-gray-200 hover:bg-gray-800 transition-colors"
                  >
                    <FolderPlus className="w-4 h-4" />
                    <span>新建收藏夹</span>
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}
