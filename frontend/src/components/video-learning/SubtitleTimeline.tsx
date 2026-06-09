'use client';

import { FormEvent, MouseEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Edit3, Languages, Loader2, Plus, Save, Trash2, X } from 'lucide-react';
import { translationAPI, videoLessonAPI } from '@/lib/api';
import { VideoSubtitle } from '@/types';
import { formatDuration } from './VideoLessonCard';

interface SubtitleTimelineProps {
  lessonId: number;
  subtitles: VideoSubtitle[];
  activeSubtitleId?: number;
  onSeek: (seconds: number) => void;
  onSubtitlesChange: (subtitles: VideoSubtitle[]) => void;
  onWordClick: (word: string, subtitle: VideoSubtitle, position: { x: number; y: number }) => void;
}

type SubtitleDisplayMode = 'english' | 'chinese' | 'bilingual';

export default function SubtitleTimeline({
  lessonId,
  subtitles,
  activeSubtitleId,
  onSeek,
  onSubtitlesChange,
  onWordClick,
}: SubtitleTimelineProps) {
  const activeRef = useRef<HTMLButtonElement | null>(null);
  const [mode, setMode] = useState<SubtitleDisplayMode>('bilingual');
  const [editingId, setEditingId] = useState<number | null>(null);
  const [savingId, setSavingId] = useState<number | null>(null);
  const [translatingId, setTranslatingId] = useState<number | null>(null);
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({
    start_seconds: 0,
    end_seconds: 1,
    text: '',
    translation: '',
  });

  useEffect(() => {
    if (activeRef.current) {
      activeRef.current.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }
  }, [activeSubtitleId]);

  const activeSubtitle = useMemo(
    () => subtitles.find((subtitle) => subtitle.id === activeSubtitleId),
    [activeSubtitleId, subtitles]
  );

  const startEdit = (subtitle: VideoSubtitle) => {
    setEditingId(subtitle.id);
    setAdding(false);
    setForm({
      start_seconds: subtitle.start_seconds,
      end_seconds: subtitle.end_seconds,
      text: subtitle.text,
      translation: subtitle.translation || '',
    });
  };

  const startAdd = () => {
    const start = activeSubtitle?.end_seconds || subtitles[subtitles.length - 1]?.end_seconds || 0;
    setAdding(true);
    setEditingId(null);
    setForm({
      start_seconds: Number(start.toFixed(2)),
      end_seconds: Number((start + 4).toFixed(2)),
      text: '',
      translation: '',
    });
  };

  const cancelEdit = () => {
    setEditingId(null);
    setAdding(false);
  };

  const refreshSubtitles = async () => {
    const response = await videoLessonAPI.getSubtitles(lessonId);
    onSubtitlesChange(response.data.data as VideoSubtitle[]);
  };

  const handleSave = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!form.text.trim()) return;
    if (form.end_seconds <= form.start_seconds) return;

    try {
      setSavingId(editingId || -1);
      if (adding) {
        await videoLessonAPI.createSubtitle(lessonId, form);
      } else if (editingId) {
        await videoLessonAPI.updateSubtitle(lessonId, editingId, form);
      }
      await refreshSubtitles();
      cancelEdit();
    } finally {
      setSavingId(null);
    }
  };

  const handleDelete = async (subtitle: VideoSubtitle) => {
    if (!window.confirm('删除这句字幕？')) return;
    await videoLessonAPI.deleteSubtitle(lessonId, subtitle.id);
    await refreshSubtitles();
  };

  const handleTranslate = async (subtitle: VideoSubtitle) => {
    try {
      setTranslatingId(subtitle.id);
      const response = await translationAPI.translate({ text: subtitle.text, target_lang: 'zh' });
      const translation = response.data.translation || response.data.data?.translation || '';
      await videoLessonAPI.updateSubtitle(lessonId, subtitle.id, { translation });
      await refreshSubtitles();
    } finally {
      setTranslatingId(null);
    }
  };

  const handleWordClick = (event: MouseEvent<HTMLButtonElement>, word: string, subtitle: VideoSubtitle) => {
    event.stopPropagation();
    const clean = word.replace(/^[^A-Za-z']+|[^A-Za-z']+$/g, '');
    if (!clean || clean.length < 2) return;
    const rect = event.currentTarget.getBoundingClientRect();
    onWordClick(clean, subtitle, {
      x: Math.min(rect.left, window.innerWidth - 360),
      y: rect.bottom + 8,
    });
  };

  const renderWords = (subtitle: VideoSubtitle) => {
    return subtitle.text.split(/(\s+)/).map((part, index) => {
      if (/^\s+$/.test(part)) return part;
      const hasWord = /[A-Za-z]/.test(part);
      if (!hasWord) return <span key={`${subtitle.id}-${index}`}>{part}</span>;
      return (
        <button
          key={`${subtitle.id}-${part}-${index}`}
          type="button"
          onClick={(event) => handleWordClick(event, part, subtitle)}
          className="rounded px-0.5 text-left hover:bg-blue-500/20 hover:text-blue-200"
        >
          {part}
        </button>
      );
    });
  };

  const renderForm = () => (
    <form onSubmit={handleSave} className="mb-3 rounded-lg border border-blue-500/30 bg-blue-500/10 p-3">
      <div className="mb-3 grid gap-2 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-400">开始秒数</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={form.start_seconds}
            onChange={(event) => setForm((prev) => ({ ...prev, start_seconds: Number(event.target.value) }))}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-semibold text-gray-400">结束秒数</span>
          <input
            type="number"
            step="0.01"
            min={0}
            value={form.end_seconds}
            onChange={(event) => setForm((prev) => ({ ...prev, end_seconds: Number(event.target.value) }))}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
      </div>
      <textarea
        value={form.text}
        onChange={(event) => setForm((prev) => ({ ...prev, text: event.target.value }))}
        rows={3}
        className="mb-2 w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500"
      />
      <textarea
        value={form.translation}
        onChange={(event) => setForm((prev) => ({ ...prev, translation: event.target.value }))}
        rows={2}
        placeholder="中文翻译，可选"
        className="mb-3 w-full rounded-md border border-gray-700 bg-gray-950 px-2 py-1.5 text-sm text-gray-100 outline-none focus:border-blue-500"
      />
      <div className="flex gap-2">
        <button
          type="submit"
          disabled={savingId !== null}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {savingId !== null ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
          保存
        </button>
        <button
          type="button"
          onClick={cancelEdit}
          className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-1.5 text-sm font-semibold text-gray-300 hover:bg-gray-900"
        >
          <X className="h-4 w-4" />
          取消
        </button>
      </div>
    </form>
  );

  return (
    <div className="flex h-full min-h-0 flex-col rounded-lg border border-gray-800 bg-gray-900/50">
      <div className="border-b border-gray-800 p-4">
        <div className="mb-3 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-lg font-bold text-gray-100">字幕学习</h2>
            <p className="text-sm text-gray-500">{subtitles.length} 句字幕</p>
          </div>
          <button
            type="button"
            onClick={startAdd}
            className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
          >
            <Plus className="h-4 w-4" />
            新增
          </button>
        </div>
        <div className="grid grid-cols-3 overflow-hidden rounded-md border border-gray-800">
          {[
            ['english', '英文'],
            ['chinese', '中文'],
            ['bilingual', '双语'],
          ].map(([value, label]) => (
            <button
              key={value}
              type="button"
              onClick={() => setMode(value as SubtitleDisplayMode)}
              className={`px-3 py-2 text-sm font-semibold ${
                mode === value ? 'bg-blue-600 text-white' : 'bg-gray-950 text-gray-400 hover:bg-gray-900'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {adding && renderForm()}
        {subtitles.length === 0 ? (
          <div className="rounded-lg border border-dashed border-gray-700 p-6 text-center text-sm text-gray-500">
            暂无字幕，可以导入 SRT/VTT 或手动新增字幕。
          </div>
        ) : (
          <div className="space-y-2">
            {subtitles.map((subtitle) => {
              const active = subtitle.id === activeSubtitleId;
              const editing = subtitle.id === editingId;
              return (
                <div key={subtitle.id}>
                  {editing ? (
                    renderForm()
                  ) : (
                    <button
                      ref={active ? activeRef : null}
                      type="button"
                      onClick={() => onSeek(subtitle.start_seconds)}
                      className={`w-full rounded-lg border p-3 text-left transition ${
                        active
                          ? 'border-blue-500 bg-blue-500/15'
                          : 'border-gray-800 bg-gray-950/60 hover:border-gray-700 hover:bg-gray-900'
                      }`}
                    >
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <span className="font-mono text-xs text-blue-300">
                          {formatDuration(subtitle.start_seconds)} - {formatDuration(subtitle.end_seconds)}
                        </span>
                        <span className="text-xs text-gray-600">#{subtitle.sort_order}</span>
                      </div>
                      {mode !== 'chinese' && (
                        <p className="text-base leading-7 text-gray-100">{renderWords(subtitle)}</p>
                      )}
                      {mode !== 'english' && subtitle.translation && (
                        <p className="mt-2 text-sm leading-6 text-gray-400">{subtitle.translation}</p>
                      )}
                      <div className="mt-3 flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            startEdit(subtitle);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800"
                        >
                          <Edit3 className="h-3.5 w-3.5" />
                          编辑
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleTranslate(subtitle);
                          }}
                          disabled={translatingId === subtitle.id}
                          className="inline-flex items-center gap-1 rounded-md border border-gray-700 px-2 py-1 text-xs font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-50"
                        >
                          {translatingId === subtitle.id ? (
                            <Loader2 className="h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <Languages className="h-3.5 w-3.5" />
                          )}
                          翻译
                        </button>
                        <button
                          type="button"
                          onClick={(event) => {
                            event.stopPropagation();
                            handleDelete(subtitle);
                          }}
                          className="inline-flex items-center gap-1 rounded-md border border-red-500/40 px-2 py-1 text-xs font-semibold text-red-200 hover:bg-red-500/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                          删除
                        </button>
                      </div>
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
