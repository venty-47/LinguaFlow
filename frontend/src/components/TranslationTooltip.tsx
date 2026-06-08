'use client';

import { useState, useEffect, useRef } from 'react';
import { translationAPI, vocabularyAPI } from '@/lib/api';
import { Vocabulary } from '@/types';
import { Bot, BookmarkCheck, BookmarkPlus, Loader2, RotateCcw, Volume2 } from 'lucide-react';

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
  onVocabularyReviewed,
}: TranslationTooltipProps) {
  const [translation, setTranslation] = useState<string>('');
  const [phonetic, setPhonetic] = useState('');
  const [definition, setDefinition] = useState('');
  const [dictionaryError, setDictionaryError] = useState('');
  const [speechUrl, setSpeechUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [adding, setAdding] = useState(false);
  const [reviewing, setReviewing] = useState(false);
  const [currentVocabulary, setCurrentVocabulary] = useState<Vocabulary | undefined>(existingVocabulary);
  const tooltipRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setCurrentVocabulary(existingVocabulary);
  }, [existingVocabulary]);

  useEffect(() => {
    const fetchResult = async () => {
      try {
        setLoading(true);
        setPhonetic('');
        setDefinition('');
        setDictionaryError('');
        setSpeechUrl('');

        if (mode === 'dictionary') {
          // 单词模式：使用词典 API 获取详细释义
          const response = await translationAPI.lookupWord(selectedText);
          const data = response.data.data;

          // 组装音标
          let phoneticStr = '';
          if (data.uk_phonetic && data.us_phonetic) {
            phoneticStr = `UK: [${data.uk_phonetic}]  US: [${data.us_phonetic}]`;
          } else if (data.phonetic) {
            phoneticStr = `[${data.phonetic}]`;
          }

          // 组装释义
          const definitions = Array.isArray(data.definitions)
            ? data.definitions.map((item: any) => item.definition).join('\n')
            : '';

          setTranslation(data.translation || '暂无释义');
          setPhonetic(phoneticStr);
          setDefinition(definitions);
          setDictionaryError(data.error || '');
          setSpeechUrl(data.us_speech_url || data.uk_speech_url || data.speech_url || '');
        } else {
          // 翻译模式：直接翻译
          const response = await translationAPI.translate({
            text: selectedText,
            target_lang: 'zh',
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
  }, [mode, selectedText]);

  const handleSpeak = () => {
    if (speechUrl) {
      new Audio(speechUrl).play().catch((error) => {
        console.error('Audio playback error:', error);
      });
      return;
    }

    if ('speechSynthesis' in window) {
      const utterance = new SpeechSynthesisUtterance(selectedText);
      utterance.lang = 'en-US';
      window.speechSynthesis.speak(utterance);
    }
  };

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
      alert('已添加到生词本');
    } catch (error: any) {
      if (error.response?.status === 401) {
        alert('请先登录');
      } else {
        alert('添加失败');
      }
    } finally {
      setAdding(false);
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
        alert('请先登录');
      } else {
        alert('复习记录失败');
      }
    } finally {
      setReviewing(false);
    }
  };

  return (
    <div
      ref={tooltipRef}
      className="translation-tooltip"
      style={{
        left: `${position.x}px`,
        top: `${position.y}px`,
      }}
    >
      <div className="mb-2 flex items-start justify-between">
        <div className="flex-1">
          <div className="mb-1 text-sm font-medium text-gray-600 dark:text-gray-400">
            {selectedText}
          </div>
          {phonetic && (
            <div className="mb-2 text-xs text-gray-500">{phonetic}</div>
          )}
          {currentVocabulary && (
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-500/10 px-2 py-1 font-semibold text-emerald-500 dark:text-emerald-300">
                <BookmarkCheck className="h-3 w-3" />
                已在生词本
              </span>
              <span className="text-gray-500">
                复习 {currentVocabulary.review_count} 次
                {currentVocabulary.forgotten_count > 0
                  ? ` · 忘记 ${currentVocabulary.forgotten_count} 次`
                  : ''}
              </span>
            </div>
          )}
          {loading ? (
            <div className="flex items-center space-x-2 text-gray-500">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span className="text-sm">{mode === 'dictionary' ? '查词中...' : '翻译中...'}</span>
            </div>
          ) : (
            <div className="space-y-2">
              <div className="text-gray-950 dark:text-white">{translation}</div>
              {definition && (
                <div className="whitespace-pre-line text-sm leading-6 text-gray-600 dark:text-gray-400">
                  {definition}
                </div>
              )}
              {dictionaryError && (
                <div className="text-xs leading-5 text-amber-600 dark:text-amber-300">
                  {dictionaryError}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="mt-3 flex items-center space-x-2 border-t border-gray-200 pt-3 dark:border-gray-700">
        <button
          onClick={handleSpeak}
          disabled={loading}
          className="flex items-center space-x-1 rounded bg-gray-100 px-3 py-1.5 text-sm transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700"
          title="发音"
        >
          <Volume2 className="w-3.5 h-3.5" />
          <span>发音</span>
        </button>
        {onAskAI && (
          <button
            onClick={() => onAskAI(selectedText)}
            className="flex items-center space-x-1 rounded bg-sky-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-sky-500"
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
              disabled={reviewing || loading}
              className="flex items-center space-x-1 rounded bg-gray-100 px-3 py-1.5 text-sm transition-colors hover:bg-gray-200 disabled:opacity-50 dark:bg-gray-800 dark:hover:bg-gray-700"
              title="忘记"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>忘记</span>
            </button>
            <button
              onClick={() => handleReviewVocabulary('hard')}
              disabled={reviewing || loading}
              className="rounded bg-yellow-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-yellow-500 disabled:opacity-50"
              title="模糊"
            >
              模糊
            </button>
            <button
              onClick={() => handleReviewVocabulary('good')}
              disabled={reviewing || loading}
              className="rounded bg-green-600 px-3 py-1.5 text-sm text-white transition-colors hover:bg-green-500 disabled:opacity-50"
              title="记得"
            >
              记得
            </button>
          </>
        ) : (
          <button
            onClick={handleAddToVocabulary}
            disabled={adding || loading}
            className="flex items-center space-x-1 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded text-sm transition-colors disabled:opacity-50"
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
  );
}
