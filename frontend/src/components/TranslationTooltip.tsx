'use client';

import { useState, useEffect, useRef } from 'react';
import { translationAPI, vocabularyAPI } from '@/lib/api';
import { Vocabulary } from '@/types';
import { Bot, BookmarkCheck, BookmarkPlus, Check, FileEdit, Loader2, RotateCcw, Volume2, X } from 'lucide-react';
import Toast from './Toast';

type Accent = 'uk' | 'us';

type DictionaryDefinition = {
  pos?: string;
  definition: string;
};

interface TranslationTooltipProps {
  selectedText: string;
  position: { x: number; y: number };
  onClose: () => void;
  articleId?: number;
  mode?: 'translate' | 'dictionary';
  context?: string;
  existingVocabulary?: Vocabulary;
  onAskAI?: (text: string) => void;
  onWordAdded?: (word: string) => void;
  onWordRemoved?: (word: string) => void;
  onVocabularyReviewed?: (vocabulary: Vocabulary) => void;
}

export default function TranslationTooltip({
  selectedText,
  position,
  onClose,
  articleId,
  mode = 'translate',
  context,
  existingVocabulary,
  onAskAI,
  onWordAdded,
  onWordRemoved,
  onVocabularyReviewed,
}: TranslationTooltipProps) {
  const [translation, setTranslation] = useState<string>('');
  const [phonetic, setPhonetic] = useState('');
  const [ukPhonetic, setUkPhonetic] = useState('');
  const [usPhonetic, setUsPhonetic] = useState('');
  const [definition, setDefinition] = useState('');
  const [dictionaryDefinitions, setDictionaryDefinitions] = useState<DictionaryDefinition[]>([]);
  const [dictionaryError, setDictionaryError] = useState('');
  const [speechUrl, setSpeechUrl] = useState('');
  const [ukSpeechUrl, setUkSpeechUrl] = useState('');
  const [usSpeechUrl, setUsSpeechUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [currentVocabulary, setCurrentVocabulary] = useState<Vocabulary | undefined>(existingVocabulary);
  const [toastMessage, setToastMessage] = useState('');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesEditing, setNotesEditing] = useState(false);
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentVocabulary(existingVocabulary);
    setNotesDraft(existingVocabulary?.notes || '');
    setNotesEditing(false);
    setNotesSaved(false);
  }, [existingVocabulary]);

  useEffect(() => {
    const fetchResult = async () => {
      try {
        setLoading(true);
        setPhonetic('');
        setUkPhonetic('');
        setUsPhonetic('');
        setDefinition('');
        setDictionaryDefinitions([]);
        setDictionaryError('');
        setSpeechUrl('');
        setUkSpeechUrl('');
        setUsSpeechUrl('');

        if (mode === 'dictionary') {
          // 单词模式：使用词典 API 获取详细释义
          const response = await translationAPI.lookupWord(selectedText, {
            article_id: articleId,
            context,
          });
          const data = response.data.data;

          // 组装音标
          let phoneticStr = '';
          const nextUkPhonetic = data.uk_phonetic || '';
          const nextUsPhonetic = data.us_phonetic || '';
          if (nextUkPhonetic && nextUsPhonetic) {
            phoneticStr = `UK: [${nextUkPhonetic}]  US: [${nextUsPhonetic}]`;
          } else if (nextUkPhonetic) {
            phoneticStr = `UK: [${nextUkPhonetic}]`;
          } else if (nextUsPhonetic) {
            phoneticStr = `US: [${nextUsPhonetic}]`;
          } else if (data.phonetic) {
            phoneticStr = `[${data.phonetic}]`;
          }

          // 组装释义
          const definitions = Array.isArray(data.definitions)
            ? data.definitions
                .map((item: any) => ({
                  pos: typeof item.pos === 'string' ? item.pos : '',
                  definition: typeof item.definition === 'string' ? item.definition : '',
                }))
                .filter((item: DictionaryDefinition) => item.definition.trim())
            : [];
          const definitionText = definitions.map((item: DictionaryDefinition) => item.definition).join('\n');

          setTranslation(data.translation || '暂无释义');
          setPhonetic(phoneticStr);
          setUkPhonetic(nextUkPhonetic);
          setUsPhonetic(nextUsPhonetic);
          setDefinition(definitionText);
          setDictionaryDefinitions(definitions);
          setDictionaryError(data.error || '');
          setSpeechUrl(data.us_speech_url || data.uk_speech_url || data.speech_url || '');
          setUkSpeechUrl(data.uk_speech_url || '');
          setUsSpeechUrl(data.us_speech_url || '');
        } else {
          // 翻译模式：直接翻译
          const response = await translationAPI.translate({
            text: selectedText,
            target_lang: 'zh',
            article_id: articleId,
            context,
          });
          setTranslation(response.data.translation);
        }
      } catch (error) {
        console.error('Translation error:', error);
        setTranslation(mode === 'dictionary' ? '查词失败' : '翻译失败');
      } finally {
        setLoading(false);
      }
    };

    if (selectedText) {
      fetchResult();
    }
  }, [articleId, context, mode, selectedText]);

  const getAccentTitle = (accent: Accent) => {
    return accent === 'uk' ? '英音发音' : '美音发音';
  };

  const handleSpeak = (accent: Accent = 'us') => {
    const accentSpeechUrl = accent === 'uk' ? ukSpeechUrl : usSpeechUrl;
    const nextSpeechUrl = accentSpeechUrl || speechUrl;

    if (nextSpeechUrl) {
      const audio = new Audio(nextSpeechUrl);
      audio.play().catch((error) => {
        console.error('Audio playback error:', error);
      });
    }
  };

  const hasAccentSpeech = Boolean(ukSpeechUrl || usSpeechUrl);
  const parseDefinition = (text: string): DictionaryDefinition => {
    const trimmed = text.trim();
    const match = trimmed.match(/^([a-z]+\.?)\s+(.+)$/i);
    return match
      ? { pos: match[1], definition: match[2].trim() }
      : { definition: trimmed };
  };
  const uniqueDefinitions = (items: DictionaryDefinition[]) => {
    const seen = new Set<string>();
    return items.filter((item) => {
      const key = `${item.pos || ''}:${item.definition}`.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  };
  const translationLines = translation.split('\n').map((line) => line.trim()).filter(Boolean);
  const definitionLines = uniqueDefinitions(
    dictionaryDefinitions.length > 0
      ? dictionaryDefinitions
      : definition.split('\n').map((line) => line.trim()).filter(Boolean).map(parseDefinition)
  );
  const fallbackDefinitions = uniqueDefinitions(translationLines.map(parseDefinition));
  const displayedDefinitions = definitionLines.length > 0 ? definitionLines : fallbackDefinitions;
  const visibleDefinitions = displayedDefinitions.slice(0, 8);
  const extraDefinitionCount = Math.max(displayedDefinitions.length - visibleDefinitions.length, 0);
  const shouldShowTranslationText = mode !== 'dictionary' || displayedDefinitions.length === 0;
  const showGenericSpeech = Boolean(mode !== 'dictionary' || (!hasAccentSpeech && speechUrl));

  const renderSpeechButton = (accent: Accent, label?: string, compact = true) => (
    <button
      onClick={() => handleSpeak(accent)}
      disabled={loading}
      className={
        compact
          ? 'inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-stone-500 transition-colors hover:bg-stone-200 hover:text-stone-950 disabled:opacity-50 dark:text-stone-300 dark:hover:bg-stone-700 dark:hover:text-white'
          : 'inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-100 px-2.5 text-xs font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700'
      }
      title={label ? `${label}发音` : getAccentTitle(accent)}
      aria-label={label ? `${label}发音` : getAccentTitle(accent)}
    >
      <Volume2 className="h-4 w-4" />
      {label && <span>{label}</span>}
    </button>
  );

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (tooltipRef.current && !tooltipRef.current.contains(event.target as Node)) {
        onClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [onClose]);

  const handleAddToVocabulary = async () => {
    try {
      setAdding(true);
      const response = await vocabularyAPI.addWord({
        word: selectedText,
        translation: translation,
        article_id: articleId,
        context,
        phonetic,
        definition,
      });
      const vocabulary = response.data.data as Vocabulary;
      setCurrentVocabulary(vocabulary);
      onWordAdded?.(vocabulary.word.toLowerCase());
      onVocabularyReviewed?.(vocabulary);
      setToastMessage('已添加到生词本');
    } catch (error: any) {
      if (error.response?.status === 401) {
        setToastMessage('请先登录');
      } else {
        setToastMessage('添加失败');
      }
    } finally {
      setAdding(false);
    }
  };

  const handleRemoveFromVocabulary = async () => {
    if (!currentVocabulary) return;
    try {
      setRemoving(true);
      await vocabularyAPI.deleteWord(currentVocabulary.id);
      const word = currentVocabulary.word.toLowerCase();
      setCurrentVocabulary(undefined);
      onWordRemoved?.(word);
      setToastMessage('已从生词本移除');
    } catch (error: any) {
      if (error.response?.status === 401) {
        setToastMessage('请先登录');
      } else {
        setToastMessage('移除失败');
      }
    } finally {
      setRemoving(false);
    }
  };

  const handleReviewVocabulary = async (rating: 'forgot' | 'hard' | 'good') => {
    if (!currentVocabulary) return;

    try {
      setReviewing(true);
      const response = await vocabularyAPI.reviewWord(currentVocabulary.id, rating);
      const reviewed = response.data.data as Vocabulary;
      setCurrentVocabulary(reviewed);
      onVocabularyReviewed?.(reviewed);
    } catch (error: any) {
      if (error.response?.status === 401) {
        setToastMessage('请先登录');
      } else {
        setToastMessage('复习记录失败');
      }
    } finally {
      setReviewing(false);
    }
  };

  const saveTooltipNotes = async () => {
    if (!currentVocabulary || notesSaving) return;
    if (notesDraft === (currentVocabulary.notes || '')) {
      setNotesEditing(false);
      return;
    }
    try {
      setNotesSaving(true);
      const response = await vocabularyAPI.updateNotes(currentVocabulary.id, notesDraft);
      const updated = response.data.data as Vocabulary;
      setCurrentVocabulary(updated);
      setNotesSaved(true);
      setNotesEditing(false);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch {
      setToastMessage('笔记保存失败');
    } finally {
      setNotesSaving(false);
    }
  };

  return (
    <>
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage('')} />}
      <div
        ref={tooltipRef}
        className="translation-tooltip"
        style={{
          left: `${position.x}px`,
          top: `${position.y}px`,
        }}
      >
      <div className="space-y-3">
        <div>
          <div className="mb-2.5 flex flex-wrap items-center gap-2">
            <span className="text-lg font-semibold leading-none text-stone-950 dark:text-stone-50">
              {selectedText}
            </span>
            {showGenericSpeech && (
              renderSpeechButton('us', '发音', false)
            )}
            {currentVocabulary && (
              <button
                onClick={handleRemoveFromVocabulary}
                disabled={removing || loading}
                className="group/badge inline-flex h-6 items-center gap-1 rounded-full bg-teal-700/10 px-2 text-xs font-semibold text-teal-700 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-50 dark:bg-teal-300/10 dark:text-teal-200 dark:hover:bg-red-900/20 dark:hover:text-red-400"
                title="点击移除"
              >
                {removing ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <>
                    <BookmarkCheck className="h-3.5 w-3.5 group-hover/badge:hidden" />
                    <X className="h-3.5 w-3.5 hidden group-hover/badge:inline" />
                  </>
                )}
                <span className="group-hover/badge:hidden">已在生词本</span>
                <span className="hidden group-hover/badge:inline">移除</span>
              </button>
            )}
          </div>

          {mode === 'dictionary' && (ukPhonetic || usPhonetic || phonetic) && (
            <div className="flex flex-wrap items-center gap-2 text-sm text-stone-500 dark:text-stone-300">
              {ukPhonetic && (
                <div className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 dark:border-stone-700 dark:bg-stone-800/70">
                  <span>UK: [{ukPhonetic}]</span>
                  {ukSpeechUrl && renderSpeechButton('uk')}
                </div>
              )}
              {usPhonetic && (
                <div className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 dark:border-stone-700 dark:bg-stone-800/70">
                  <span>US: [{usPhonetic}]</span>
                  {usSpeechUrl && renderSpeechButton('us')}
                </div>
              )}
              {!ukPhonetic && !usPhonetic && phonetic && (
                <div className="inline-flex h-9 items-center gap-2 rounded-md border border-stone-200 bg-stone-50 px-2.5 dark:border-stone-700 dark:bg-stone-800/70">
                  <span>{phonetic}</span>
                  {renderSpeechButton('us')}
                </div>
              )}
            </div>
          )}
          {mode === 'dictionary' && !ukPhonetic && !usPhonetic && !phonetic && hasAccentSpeech && (
            <div className="flex flex-wrap items-center gap-2">
              {renderSpeechButton('uk', '英音', false)}
              {renderSpeechButton('us', '美音', false)}
            </div>
          )}
          {currentVocabulary && (
            <div className="mt-2.5 text-xs text-stone-500 dark:text-stone-400">
                复习 {currentVocabulary.review_count} 次
                {currentVocabulary.forgotten_count > 0
                  ? ` · 忘记 ${currentVocabulary.forgotten_count} 次`
                  : ''}
            </div>
          )}
          {currentVocabulary && (
            <div className="mt-2.5">
              {notesEditing ? (
                <div className="space-y-1.5">
                  <textarea
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    onBlur={saveTooltipNotes}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        saveTooltipNotes();
                      }
                      if (event.key === 'Escape') {
                        setNotesDraft(currentVocabulary.notes || '');
                        setNotesEditing(false);
                      }
                    }}
                    autoFocus
                    placeholder="记录用法、记忆技巧、易混点..."
                    rows={3}
                    className="w-full resize-none rounded border border-stone-200 bg-stone-50 px-2.5 py-2 text-xs leading-5 text-stone-800 outline-none focus:border-teal-500 dark:border-stone-700 dark:bg-stone-800/70 dark:text-stone-200 dark:focus:border-teal-500"
                  />
                  <div className="flex items-center justify-between text-[11px]">
                    {notesSaving ? (
                      <span className="flex items-center gap-1 text-stone-400">
                        <Loader2 className="h-3 w-3 animate-spin" /> 保存中
                      </span>
                    ) : notesSaved ? (
                      <span className="flex items-center gap-1 text-emerald-500">
                        <Check className="h-3 w-3" /> 已保存
                      </span>
                    ) : (
                      <span className="text-stone-400">Ctrl+Enter 保存 · Esc 取消</span>
                    )}
                  </div>
                </div>
              ) : (
                <div
                  onClick={() => {
                    setNotesDraft(currentVocabulary.notes || '');
                    setNotesEditing(true);
                  }}
                  className="cursor-pointer rounded border border-dashed border-stone-300 bg-stone-50/50 px-2.5 py-2 transition-colors hover:border-teal-400 hover:bg-teal-50/50 dark:border-stone-700 dark:bg-stone-800/30 dark:hover:border-teal-600 dark:hover:bg-teal-900/20"
                >
                  {currentVocabulary.notes ? (
                    <>
                      <div className="mb-1 flex items-center gap-1 text-[11px] font-semibold text-teal-600 dark:text-teal-400">
                        <FileEdit className="h-3 w-3" />
                        我的笔记
                      </div>
                      <p className="whitespace-pre-wrap text-xs leading-5 text-stone-700 dark:text-stone-300">
                        {currentVocabulary.notes}
                      </p>
                      <p className="mt-1 text-[11px] text-stone-400 dark:text-stone-500">点击编辑</p>
                    </>
                  ) : (
                    <div className="flex items-center gap-1.5 text-xs text-stone-400 dark:text-stone-500">
                      <FileEdit className="h-3 w-3" />
                      写笔记...
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        <div>
          {loading ? (
            <div className="flex items-center space-x-2 rounded-md bg-stone-100/80 p-3 text-stone-500 dark:bg-stone-800/60 dark:text-stone-300">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{mode === 'dictionary' ? '查词中...' : '翻译中...'}</span>
            </div>
          ) : (
            <div className="space-y-2.5">
              {shouldShowTranslationText && (
                <div className="text-base leading-7 text-stone-950 dark:text-stone-50">{translation}</div>
              )}
              {visibleDefinitions.length > 0 && (
                <div className="grid gap-1.5 text-sm leading-6">
                  {visibleDefinitions.map((item, index) => (
                    <div
                      key={`${item.pos || 'def'}-${item.definition}-${index}`}
                      className="flex gap-2 rounded-md bg-stone-100/70 px-2.5 py-1.5 text-stone-700 dark:bg-stone-800/70 dark:text-stone-200"
                    >
                      {item.pos && (
                        <span className="min-w-10 shrink-0 font-medium text-teal-700 dark:text-teal-200">
                          {item.pos}
                        </span>
                      )}
                      <span className="min-w-0">{item.definition}</span>
                    </div>
                  ))}
                  {extraDefinitionCount > 0 && (
                    <div className="px-2.5 pt-0.5 text-xs text-stone-500 dark:text-stone-400">
                      还有 {extraDefinitionCount} 条释义
                    </div>
                  )}
                </div>
              )}
              {dictionaryError && (
                <div className="rounded-md bg-amber-500/10 px-3 py-2 text-xs leading-5 text-amber-700 dark:text-amber-300">
                  {dictionaryError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-stone-200 pt-3 dark:border-stone-700">
        {onAskAI && (
          <button
            onClick={() => onAskAI(selectedText)}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600"
            title="问 AI"
          >
            <Bot className="w-3.5 h-3.5" />
            <span>问 AI</span>
          </button>
        )}
        {currentVocabulary ? (
          <>
            <button
              onClick={() => handleReviewVocabulary('forgot')}
              disabled={reviewing || loading || removing}
              className="inline-flex h-8 items-center gap-1.5 rounded-md bg-stone-100 px-2.5 text-sm font-medium text-stone-700 transition-colors hover:bg-stone-200 disabled:opacity-50 dark:bg-stone-800 dark:text-stone-200 dark:hover:bg-stone-700"
              title="忘记"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>忘记</span>
            </button>
            <button
              onClick={() => handleReviewVocabulary('hard')}
              disabled={reviewing || loading || removing}
              className="inline-flex h-8 items-center rounded-md bg-amber-600 px-2.5 text-sm font-medium text-white transition-colors hover:bg-amber-500 disabled:opacity-50"
              title="模糊"
            >
              模糊
            </button>
            <button
              onClick={() => handleReviewVocabulary('good')}
              disabled={reviewing || loading || removing}
              className="inline-flex h-8 items-center rounded-md bg-teal-700 px-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
              title="记得"
            >
              记得
            </button>
          </>
        ) : (
          <button
            onClick={handleAddToVocabulary}
            disabled={adding || loading}
            className="inline-flex h-8 items-center gap-1.5 rounded-md bg-teal-700 px-2.5 text-sm font-medium text-white transition-colors hover:bg-teal-600 disabled:opacity-50"
            title="添加到生词本"
          >
            {adding ? (
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <BookmarkPlus className="w-3.5 h-3.5" />
            )}
            <span>生词本</span>
          </button>
        )}
      </div>
    </div>
    </>
  );
}
