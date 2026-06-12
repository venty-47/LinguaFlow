'use client';

import { useState, useEffect, useRef } from 'react';
import { Volume2, Volume1 } from 'lucide-react';
import { playWordAudio, preloadUpcoming, playSentenceAudio } from '@/lib/wordAudio';

interface LearnCardDefinition {
  pos: string;
  definition: string;
}

interface LearnCardExample {
  en: string;
  zh: string;
}

interface LearnCardProps {
  word: string;
  phonetic?: string;
  uk_phonetic?: string;
  us_phonetic?: string;
  translation?: string;
  definitions?: string;
  examples?: string;
  collocations?: string;
  onRating: (rating: 'good' | 'hard' | 'forgot') => void;
  disabled?: boolean;
  /** 后续即将出现的单词列表，用于预加载音频 */
  upcomingWords?: string[];
}

function parseJSON<T>(value: string | undefined | null, fallback: T): T {
  if (!value) return fallback;
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

export default function LearnCard({
  word,
  phonetic,
  uk_phonetic,
  us_phonetic,
  translation,
  definitions,
  examples,
  collocations,
  onRating,
  disabled,
  upcomingWords = [],
}: LearnCardProps) {
  const [flipped, setFlipped] = useState(false);
  const lastWordRef = useRef('');

  const defs = parseJSON<LearnCardDefinition[]>(definitions, []);
  const exs = parseJSON<LearnCardExample[]>(examples, []);
  const colls = parseJSON<string[]>(collocations, []);

  // 单词切换时：自动播放美音 + 预加载后续单词 + 重置翻牌
  useEffect(() => {
    if (word && word !== lastWordRef.current) {
      lastWordRef.current = word;
      setFlipped(false);

      const timer = setTimeout(() => {
        playWordAudio(word, 'us');
      }, 150);

      preloadUpcoming(upcomingWords, 'us', 3);

      return () => clearTimeout(timer);
    }
  }, [word, upcomingWords]);

  const handleRating = (rating: 'good' | 'hard' | 'forgot') => {
    if (disabled) return;
    onRating(rating);
    setFlipped(false);
  };

  const handlePlay = (e: React.MouseEvent, accent: 'uk' | 'us') => {
    e.stopPropagation();
    playWordAudio(word, accent);
  };

  return (
    <div className="flex flex-col items-center gap-6">
      {/* 翻牌区域 */}
      <div
        className="relative w-full max-w-md cursor-pointer"
        style={{ perspective: '1000px' }}
        onClick={() => setFlipped(!flipped)}
      >
        <div
          className="relative w-full transition-transform duration-500"
          style={{
            transformStyle: 'preserve-3d',
            transform: flipped ? 'rotateY(180deg)' : 'rotateY(0deg)',
          }}
        >
          {/* 正面:单词 */}
          <div
            className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border border-gray-200 bg-white p-8 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            style={{ backfaceVisibility: 'hidden' }}
          >
            <h2 className="mb-4 text-4xl font-black text-gray-950 dark:text-gray-100">
              {word}
            </h2>

            {/* 英音 / 美音 分区 */}
            <div className="mb-6 flex items-center gap-6">
              {uk_phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-sky-50 px-3 py-1.5 text-sm text-sky-700 transition-colors hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400 dark:hover:bg-sky-500/20"
                  onClick={(e) => handlePlay(e, 'uk')}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">英</span>
                  <span className="text-sm">{uk_phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
              {us_phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-orange-50 px-3 py-1.5 text-sm text-orange-700 transition-colors hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-400 dark:hover:bg-orange-500/20"
                  onClick={(e) => handlePlay(e, 'us')}
                >
                  <span className="text-xs font-semibold uppercase tracking-wide">美</span>
                  <span className="text-sm">{us_phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
              {!uk_phonetic && !us_phonetic && phonetic && (
                <button
                  type="button"
                  className="flex items-center gap-1.5 rounded-full bg-blue-50 px-3 py-1.5 text-sm text-blue-600 transition-colors hover:bg-blue-100 dark:bg-blue-500/10 dark:text-blue-400 dark:hover:bg-blue-500/20"
                  onClick={(e) => handlePlay(e, 'us')}
                >
                  <span className="text-sm">{phonetic}</span>
                  <Volume2 className="h-3.5 w-3.5" />
                </button>
              )}
            </div>

            <p className="text-sm text-gray-400 dark:text-gray-500">
              点击卡片查看释义
            </p>
          </div>

          {/* 背面:释义 */}
          <div
            className="absolute inset-0 flex min-h-[360px] flex-col overflow-y-auto rounded-2xl border border-gray-200 bg-white p-6 shadow-sm dark:border-gray-800 dark:bg-gray-900"
            style={{
              backfaceVisibility: 'hidden',
              transform: 'rotateY(180deg)',
            }}
          >
            <div className="mb-3 flex items-center gap-3">
              <h3 className="text-2xl font-bold text-gray-950 dark:text-gray-100">
                {word}
              </h3>
              <div className="flex items-center gap-2">
                {uk_phonetic && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-sky-50 px-2 py-0.5 text-xs text-sky-700 hover:bg-sky-100 dark:bg-sky-500/10 dark:text-sky-400"
                    onClick={(e) => handlePlay(e, 'uk')}
                  >
                    <span className="font-semibold">英</span>
                    <Volume2 className="h-3 w-3" />
                  </button>
                )}
                {us_phonetic && (
                  <button
                    type="button"
                    className="flex items-center gap-1 rounded-full bg-orange-50 px-2 py-0.5 text-xs text-orange-700 hover:bg-orange-100 dark:bg-orange-500/10 dark:text-orange-400"
                    onClick={(e) => handlePlay(e, 'us')}
                  >
                    <span className="font-semibold">美</span>
                    <Volume2 className="h-3 w-3" />
                  </button>
                )}
              </div>
            </div>
            {translation && (
              <p className="mb-4 text-lg font-medium text-blue-600 dark:text-blue-400">
                {translation}
              </p>
            )}

            {defs.length > 0 && (
              <div className="mb-4 space-y-2">
                {defs.map((d, i) => (
                  <div key={i} className="flex gap-2 text-sm">
                    <span className="shrink-0 rounded bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-400">
                      {d.pos}
                    </span>
                    <span className="text-gray-700 dark:text-gray-300">{d.definition}</span>
                  </div>
                ))}
              </div>
            )}

            {/* 例句：直接读后端已有的翻译数据 */}
            {exs.length > 0 && (
              <div className="mb-4 space-y-3">
                <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-400 dark:text-gray-500">
                  例句
                </h4>
                {exs.map((ex, i) => (
                  <div key={i} className="text-sm">
                    <div className="flex items-start gap-1.5">
                      <p className="flex-1 text-gray-800 dark:text-gray-200">{ex.en}</p>
                      <button
                        type="button"
                        onClick={(e) => { e.stopPropagation(); playSentenceAudio(ex.en); }}
                        className="mt-0.5 shrink-0 rounded p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-blue-500 dark:hover:bg-gray-800 dark:hover:text-blue-400"
                        title="朗读例句"
                      >
                        <Volume1 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    {ex.zh && (
                      <p className="mt-0.5 text-gray-500 dark:text-gray-400">{ex.zh}</p>
                    )}
                  </div>
                ))}
              </div>
            )}

            {colls.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {colls.map((c, i) => (
                  <span
                    key={i}
                    className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-600 dark:bg-gray-800 dark:text-gray-400"
                  >
                    {c}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* 三个评分按钮 */}
      <div className="flex w-full max-w-md gap-3">
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('good')}
          className="flex-1 rounded-xl bg-emerald-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-emerald-600 disabled:opacity-50"
        >
          认识
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('hard')}
          className="flex-1 rounded-xl bg-yellow-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-yellow-600 disabled:opacity-50"
        >
          模糊
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() => handleRating('forgot')}
          className="flex-1 rounded-xl bg-red-500 px-4 py-3.5 text-sm font-bold text-white shadow-sm transition-all hover:bg-red-600 disabled:opacity-50"
        >
          忘了
        </button>
      </div>
    </div>
  );
}
