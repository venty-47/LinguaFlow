'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { vocabularyAPI } from '@/lib/api';
import { Vocabulary } from '@/types';
import { BookOpen, Check, Eye, Layers, List, Loader2, RotateCcw, TriangleAlert } from 'lucide-react';
import { format } from 'date-fns';

function VocabularyContent() {
  const searchParams = useSearchParams();
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<'due' | 'weak' | 'all' | 'learning' | 'learned'>('due');
  const [viewMode, setViewMode] = useState<'cards' | 'list'>(
    searchParams.get('mode') === 'review' ? 'cards' : 'list'
  );
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [cardIndex, setCardIndex] = useState(0);
  const [showAnswer, setShowAnswer] = useState(false);

  const fetchVocabulary = async () => {
    try {
      setLoading(true);
      const response = await vocabularyAPI.getVocabulary();
      setVocabulary(response.data.data);
    } catch (error) {
      console.error('Failed to fetch vocabulary:', error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchVocabulary();
  }, []);

  const handleMarkLearned = async (id: number) => {
    try {
      await vocabularyAPI.markLearned(id);
      setVocabulary((prev) =>
        prev.map((item) =>
          item.id === id ? { ...item, is_learned: true } : item
        )
      );
    } catch (error) {
      console.error('Failed to mark as learned:', error);
    }
  };

  const handleReview = async (id: number, rating: 'forgot' | 'hard' | 'good') => {
    try {
      setReviewingId(id);
      const response = await vocabularyAPI.reviewWord(id, rating);
      setVocabulary((prev) =>
        prev.map((item) => (item.id === id ? response.data.data : item))
      );
      setShowAnswer(false);
      setCardIndex((current) => {
        const remaining = filteredVocabulary.filter((item) => item.id !== id);
        if (remaining.length === 0) return 0;
        return Math.min(current, remaining.length - 1);
      });
    } catch (error) {
      console.error('Failed to review word:', error);
    } finally {
      setReviewingId(null);
    }
  };

  const isDue = (item: Vocabulary) => {
    if (!item.next_review_at) return true;
    return new Date(item.next_review_at).getTime() <= Date.now();
  };

  const filteredVocabulary = vocabulary.filter((item) => {
    if (filter === 'due') return !item.is_learned || isDue(item);
    if (filter === 'weak') return item.forgotten_count > 0;
    if (filter === 'learning') return !item.is_learned;
    if (filter === 'learned') return item.is_learned;
    return true;
  }).sort((a, b) => {
    if (filter !== 'weak') return 0;
    if (b.forgotten_count !== a.forgotten_count) {
      return b.forgotten_count - a.forgotten_count;
    }
    return new Date(b.last_review || b.updated_at).getTime() - new Date(a.last_review || a.updated_at).getTime();
  });

  const dueCount = vocabulary.filter((item) => !item.is_learned || isDue(item)).length;
  const weakCount = vocabulary.filter((item) => item.forgotten_count > 0).length;
  const activeCard = filteredVocabulary[cardIndex];

  useEffect(() => {
    setCardIndex(0);
    setShowAnswer(false);
  }, [filter, viewMode]);

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-screen">
        <Loader2 className="w-8 h-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold mb-2">我的生词本</h1>
        <p className="text-gray-400">
          已收藏 {vocabulary.length} 个单词，已掌握{' '}
          {vocabulary.filter((v) => v.is_learned).length} 个，今日待复习 {dueCount} 个，
          薄弱词 {weakCount} 个
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        {/* Filter */}
        <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={() => setFilter('due')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'due'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          今日复习 ({dueCount})
        </button>
        <button
          onClick={() => setFilter('weak')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'weak'
              ? 'bg-amber-600 text-white'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          薄弱词 ({weakCount})
        </button>
        <button
          onClick={() => setFilter('all')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'all'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          全部 ({vocabulary.length})
        </button>
        <button
          onClick={() => setFilter('learning')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'learning'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          学习中 ({vocabulary.filter((v) => !v.is_learned).length})
        </button>
        <button
          onClick={() => setFilter('learned')}
          className={`px-4 py-2 rounded-lg transition-colors ${
            filter === 'learned'
              ? 'bg-blue-600 text-white'
              : 'bg-gray-800 hover:bg-gray-700'
          }`}
        >
          已掌握 ({vocabulary.filter((v) => v.is_learned).length})
        </button>
        </div>

        <div className="inline-flex w-fit rounded-lg border border-gray-800 bg-gray-900/50 p-1">
          <button
            type="button"
            onClick={() => setViewMode('cards')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              viewMode === 'cards'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            卡片复习
          </button>
          <button
            type="button"
            onClick={() => setViewMode('list')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <List className="h-4 w-4" />
            列表
          </button>
        </div>
      </div>

      {/* Vocabulary List */}
      {filteredVocabulary.length === 0 ? (
        <div className="text-center py-16">
          <BookOpen className="w-16 h-16 text-gray-700 mx-auto mb-4" />
          <p className="text-gray-500">暂无生词</p>
        </div>
      ) : viewMode === 'cards' ? (
        <div className="mx-auto max-w-3xl">
          <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
            <span>
              第 {cardIndex + 1} / {filteredVocabulary.length} 张
            </span>
            <span>
              {filter === 'due' ? '今日复习' : filter === 'weak' ? '薄弱词' : '当前筛选'} · 先回忆，再看答案
            </span>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 sm:p-8">
            <div className="mb-6 flex items-start justify-between gap-4">
              <div>
                <h2 className="text-4xl font-black text-gray-100">{activeCard.word}</h2>
                {activeCard.phonetic && (
                  <p className="mt-2 text-sm text-gray-500">{activeCard.phonetic}</p>
                )}
                {activeCard.forgotten_count > 0 && (
                  <p className="mt-2 inline-flex items-center gap-1 text-sm font-semibold text-amber-300">
                    <TriangleAlert className="h-4 w-4" />
                    忘记 {activeCard.forgotten_count} 次
                  </p>
                )}
              </div>
              {activeCard.is_learned && (
                <span className="inline-flex items-center gap-1 rounded-full bg-green-500/10 px-3 py-1 text-sm font-semibold text-green-300">
                  <Check className="h-4 w-4" />
                  已掌握
                </span>
              )}
            </div>

            {activeCard.context && (
              <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
                <p className="text-xs font-semibold text-gray-500">原文语境</p>
                <p className="mt-2 text-base leading-8 text-gray-300">{activeCard.context}</p>
              </div>
            )}

            {showAnswer ? (
              <div className="space-y-4">
                <div className="rounded-lg border border-blue-900/50 bg-blue-950/20 p-4">
                  <p className="mb-2 text-xs font-semibold text-blue-300">释义</p>
                  <p className="text-lg leading-8 text-blue-50">
                    {activeCard.translation || '暂无翻译'}
                  </p>
                </div>
                {activeCard.definition && (
                  <div className="rounded-lg border border-gray-800 bg-gray-950/60 p-4">
                    <p className="mb-2 text-xs font-semibold text-gray-500">英文解释</p>
                    <p className="whitespace-pre-line text-sm leading-7 text-gray-300">
                      {activeCard.definition}
                    </p>
                  </div>
                )}
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setShowAnswer(true)}
                className="flex min-h-40 w-full items-center justify-center rounded-lg border border-dashed border-gray-700 bg-gray-950/40 text-sm font-semibold text-gray-400 transition-colors hover:border-blue-500 hover:text-blue-300"
              >
                <Eye className="mr-2 h-4 w-4" />
                显示答案
              </button>
            )}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => {
                    setCardIndex((current) => Math.max(0, current - 1));
                    setShowAnswer(false);
                  }}
                  disabled={cardIndex === 0}
                  className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                >
                  上一张
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setCardIndex((current) => Math.min(filteredVocabulary.length - 1, current + 1));
                    setShowAnswer(false);
                  }}
                  disabled={cardIndex >= filteredVocabulary.length - 1}
                  className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                >
                  下一张
                </button>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => handleReview(activeCard.id, 'forgot')}
                  disabled={reviewingId === activeCard.id}
                  className="inline-flex items-center gap-1 rounded-md bg-gray-700 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" />
                  忘记
                </button>
                <button
                  onClick={() => handleReview(activeCard.id, 'hard')}
                  disabled={reviewingId === activeCard.id}
                  className="rounded-md bg-yellow-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-yellow-500 disabled:opacity-50"
                >
                  模糊
                </button>
                <button
                  onClick={() => handleReview(activeCard.id, 'good')}
                  disabled={reviewingId === activeCard.id}
                  className="rounded-md bg-green-600 px-3 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                >
                  记得
                </button>
              </div>
            </div>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {filteredVocabulary.map((item) => (
            <div
              key={item.id}
              className="bg-gray-900/50 border border-gray-800 rounded-lg p-5"
            >
              <div className="flex items-start justify-between mb-3">
                <div className="flex-1">
                  <h3 className="text-xl font-bold mb-1">{item.word}</h3>
                  {item.phonetic && (
                    <p className="text-sm text-gray-500">{item.phonetic}</p>
                  )}
                  <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-500">
                    <span>
                      复习 {item.review_count} 次
                      {item.next_review_at
                        ? ` · 下次 ${format(new Date(item.next_review_at), 'yyyy-MM-dd')}`
                        : ' · 尚未安排'}
                    </span>
                    {item.forgotten_count > 0 && (
                      <span className="inline-flex items-center gap-1 text-amber-300">
                        <TriangleAlert className="h-3 w-3" />
                        忘记 {item.forgotten_count} 次
                      </span>
                    )}
                  </div>
                </div>
                {item.is_learned && (
                  <span className="flex items-center space-x-1 text-green-400 text-sm">
                    <Check className="w-4 h-4" />
                    <span>已掌握</span>
                  </span>
                )}
              </div>

              {item.translation && (
                <p className="text-gray-300 mb-3">{item.translation}</p>
              )}

              {item.context && (
                <div className="bg-gray-800/50 rounded p-3 mb-3 text-sm">
                  <p className="text-gray-400">{item.context}</p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                  添加于 {format(new Date(item.created_at), 'yyyy-MM-dd')}
                </span>
                <div className="flex items-center space-x-2">
                  <button
                    onClick={() => handleReview(item.id, 'forgot')}
                    disabled={reviewingId === item.id}
                    className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    忘记
                  </button>
                  <button
                    onClick={() => handleReview(item.id, 'hard')}
                    disabled={reviewingId === item.id}
                    className="rounded bg-yellow-600 px-2 py-1 text-white transition-colors hover:bg-yellow-500 disabled:opacity-50"
                  >
                    模糊
                  </button>
                  <button
                    onClick={() => handleReview(item.id, 'good')}
                    disabled={reviewingId === item.id}
                    className="rounded bg-green-600 px-2 py-1 text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                  >
                    记得
                  </button>
                  {!item.is_learned && (
                    <button
                      onClick={() => handleMarkLearned(item.id)}
                      className="px-3 py-1 bg-green-600 hover:bg-green-700 rounded text-white transition-colors"
                    >
                      标记已掌握
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export default function VocabularyPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
        </div>
      }
    >
      <VocabularyContent />
    </Suspense>
  );
}
