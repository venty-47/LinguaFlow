'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import { vocabularyAPI } from '@/lib/api';
import {
  KnowledgeGraphNode,
  Vocabulary,
  VocabularyAnswerResult,
  VocabularyExercise,
  VocabularyExerciseType,
  VocabularyKnowledgeGraph,
} from '@/types';
import {
  BookOpen,
  Check,
  CheckCircle2,
  CircleDot,
  GitBranch,
  Headphones,
  Keyboard,
  Layers,
  List,
  Loader2,
  Network,
  RotateCcw,
  Trash2,
  TriangleAlert,
  XCircle,
} from 'lucide-react';
import { format } from 'date-fns';

type VocabularyFilter = 'due' | 'weak' | 'all' | 'learning' | 'learned';
type ViewMode = 'cards' | 'list' | 'graph';

const exerciseLabels: Record<VocabularyExerciseType, string> = {
  en_to_zh_choice: '英译中选择',
  zh_to_en_spelling: '中译英拼写',
  context_fill_blank: '原文填空',
  audio_word_choice: '听音辨词',
  sentence_meaning_choice: '例句中选义',
};

function isDue(item: Vocabulary) {
  if (!item.next_review_at) return true;
  return new Date(item.next_review_at).getTime() <= Date.now();
}

function speakWord(text: string) {
  if (typeof window === 'undefined' || !window.speechSynthesis || !text) return;
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = 0.85;
  window.speechSynthesis.speak(utterance);
}

const graphTypeLabels: Record<KnowledgeGraphNode['type'], string> = {
  word: '单词',
  meaning: '释义',
  definition: '解释',
  context: '语境',
  example: '例句',
  article: '文章',
  topic: '主题',
  grammar: '语法',
  weakness: '薄弱点',
  review: '复习',
};

const graphTypeClasses: Record<KnowledgeGraphNode['type'], string> = {
  word: 'border-blue-500/70 bg-blue-500/15 text-blue-100',
  meaning: 'border-emerald-500/60 bg-emerald-500/10 text-emerald-100',
  definition: 'border-cyan-500/60 bg-cyan-500/10 text-cyan-100',
  context: 'border-violet-500/60 bg-violet-500/10 text-violet-100',
  example: 'border-fuchsia-500/50 bg-fuchsia-500/10 text-fuchsia-100',
  article: 'border-amber-500/60 bg-amber-500/10 text-amber-100',
  topic: 'border-sky-500/50 bg-sky-500/10 text-sky-100',
  grammar: 'border-indigo-500/60 bg-indigo-500/10 text-indigo-100',
  weakness: 'border-red-500/60 bg-red-500/10 text-red-100',
  review: 'border-lime-500/50 bg-lime-500/10 text-lime-100',
};

function nodeSizeClass(node: KnowledgeGraphNode) {
  if (node.weight >= 90) return 'min-h-32 sm:col-span-2';
  if (node.weight >= 75) return 'min-h-28';
  return 'min-h-24';
}

function masteryClass(mastery?: number) {
  if (mastery === undefined) return 'bg-gray-700';
  if (mastery >= 75) return 'bg-green-500';
  if (mastery >= 45) return 'bg-amber-500';
  return 'bg-red-500';
}

function VocabularyContent() {
  const searchParams = useSearchParams();
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [exercises, setExercises] = useState<VocabularyExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [exerciseLoading, setExerciseLoading] = useState(false);
  const [filter, setFilter] = useState<VocabularyFilter>(
    searchParams.get('weak') === 'true' ? 'weak' : 'due'
  );
  const [viewMode, setViewMode] = useState<ViewMode>(
    searchParams.get('mode') === 'review' ? 'cards' : 'list'
  );
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [graphLoadingId, setGraphLoadingId] = useState<number | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<VocabularyKnowledgeGraph | null>(null);
  const [graphError, setGraphError] = useState('');
  const graphRequestRef = useRef(0);
  const [cardIndex, setCardIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [answerResult, setAnswerResult] = useState<VocabularyAnswerResult | null>(null);

  const fetchVocabulary = useCallback(async () => {
    try {
      setLoading(true);
      const response = await vocabularyAPI.getVocabulary();
      setVocabulary(response.data.data);
    } catch (error) {
      console.error('Failed to fetch vocabulary:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchExercises = useCallback(async (nextFilter: VocabularyFilter = 'due') => {
    try {
      setExerciseLoading(true);
      const response = await vocabularyAPI.getReviewExercises({
        due: nextFilter === 'all' || nextFilter === 'learned' ? false : true,
        weak: nextFilter === 'weak',
        limit: 30,
      });
      setExercises(response.data.data || []);
      setCardIndex(0);
      setAnswer('');
      setSelectedOption('');
      setAnswerResult(null);
    } catch (error) {
      console.error('Failed to fetch review exercises:', error);
    } finally {
      setExerciseLoading(false);
    }
  }, []);

  useEffect(() => {
    const initialFilter = searchParams.get('weak') === 'true' ? 'weak' : 'due';
    fetchVocabulary();
    fetchExercises(initialFilter);
  }, [fetchExercises, fetchVocabulary, searchParams]);

  const filteredVocabulary = useMemo(() => {
    return vocabulary
      .filter((item) => {
        if (filter === 'due') return !item.is_learned || isDue(item);
        if (filter === 'weak') return item.forgotten_count > 0;
        if (filter === 'learning') return !item.is_learned;
        if (filter === 'learned') return item.is_learned;
        return true;
      })
      .sort((a, b) => {
        if (filter !== 'weak') return 0;
        if (b.forgotten_count !== a.forgotten_count) {
          return b.forgotten_count - a.forgotten_count;
        }
        return new Date(b.last_review || b.updated_at).getTime() - new Date(a.last_review || a.updated_at).getTime();
      });
  }, [filter, vocabulary]);

  const dueCount = vocabulary.filter((item) => !item.is_learned || isDue(item)).length;
  const weakCount = vocabulary.filter((item) => item.forgotten_count > 0).length;
  const activeExercise = exercises[cardIndex];
  const activeVocabulary = activeExercise
    ? vocabulary.find((item) => item.id === activeExercise.vocabulary_id)
    : undefined;

  const changeFilter = (nextFilter: VocabularyFilter) => {
    setFilter(nextFilter);
    setCardIndex(0);
    setAnswer('');
    setSelectedOption('');
    setAnswerResult(null);
    if (viewMode === 'cards') {
      fetchExercises(nextFilter);
    }
  };

  const changeViewMode = (nextMode: ViewMode) => {
    setViewMode(nextMode);
    setAnswer('');
    setSelectedOption('');
    setAnswerResult(null);
    if (nextMode === 'cards') {
      fetchExercises(filter);
    }
  };

  const openKnowledgeGraph = async (id: number) => {
    const requestID = graphRequestRef.current + 1;
    graphRequestRef.current = requestID;
    try {
      setViewMode('graph');
      setGraphLoadingId(id);
      setGraphError('');
      const response = await vocabularyAPI.getKnowledgeGraph(id);
      if (graphRequestRef.current !== requestID) return;
      setKnowledgeGraph(response.data.data);
    } catch (error) {
      if (graphRequestRef.current !== requestID) return;
      console.error('Failed to fetch knowledge graph:', error);
      setGraphError('知识图谱加载失败');
    } finally {
      if (graphRequestRef.current === requestID) {
        setGraphLoadingId(null);
      }
    }
  };

  const handleMarkLearned = async (id: number) => {
    try {
      const response = await vocabularyAPI.markLearned(id);
      setVocabulary((prev) =>
        prev.map((item) => (item.id === id ? response.data.data : item))
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
    } catch (error) {
      console.error('Failed to review word:', error);
    } finally {
      setReviewingId(null);
    }
  };

  const handleDeleteWord = async (item: Vocabulary) => {
    if (typeof window !== 'undefined' && !window.confirm(`确定从生词本删除「${item.word}」吗？`)) {
      return;
    }

    try {
      setDeletingId(item.id);
      await vocabularyAPI.deleteWord(item.id);
      const nextExercises = exercises.filter((exercise) => exercise.vocabulary_id !== item.id);
      setVocabulary((prev) => prev.filter((word) => word.id !== item.id));
      setExercises(nextExercises);
      setCardIndex((current) => Math.max(0, Math.min(current, nextExercises.length - 1)));
      if (knowledgeGraph?.focus?.metadata?.vocabulary_id === item.id) {
        setKnowledgeGraph(null);
        setGraphError('');
      }
    } catch (error) {
      console.error('Failed to delete word:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const submitExerciseAnswer = async (event?: FormEvent) => {
    event?.preventDefault();
    if (!activeExercise || answerResult) return;

    const submittedAnswer = activeExercise.options?.length ? selectedOption : answer;
    if (!submittedAnswer.trim()) return;

    try {
      setReviewingId(activeExercise.vocabulary_id);
      const response = await vocabularyAPI.submitAnswer(activeExercise.vocabulary_id, {
        type: activeExercise.type,
        answer: submittedAnswer,
      });
      const result = response.data as VocabularyAnswerResult;
      setAnswerResult(result);
      setVocabulary((prev) =>
        prev.map((item) => (item.id === activeExercise.vocabulary_id ? result.data : item))
      );
    } catch (error) {
      console.error('Failed to submit review answer:', error);
    } finally {
      setReviewingId(null);
    }
  };

  const goToNextExercise = () => {
    setExercises((prev) => prev.filter((item) => item.vocabulary_id !== activeExercise?.vocabulary_id));
    setCardIndex((current) => {
      const nextLength = Math.max(0, exercises.length - 1);
      if (nextLength === 0) return 0;
      return Math.min(current, nextLength - 1);
    });
    setAnswer('');
    setSelectedOption('');
    setAnswerResult(null);
  };

  const answerSubmitted = Boolean(answerResult);
  const canSubmit = Boolean((activeExercise?.options?.length ? selectedOption : answer).trim()) && !answerSubmitted;

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-bold">我的生词本</h1>
        <p className="text-gray-400">
          已收藏 {vocabulary.length} 个单词，已掌握 {vocabulary.filter((v) => v.is_learned).length} 个，
          今日待复习 {dueCount} 个，薄弱词 {weakCount} 个
        </p>
      </div>

      <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          {[
            ['due', `今日复习 (${dueCount})`],
            ['weak', `薄弱词 (${weakCount})`],
            ['all', `全部 (${vocabulary.length})`],
            ['learning', `学习中 (${vocabulary.filter((v) => !v.is_learned).length})`],
            ['learned', `已掌握 (${vocabulary.filter((v) => v.is_learned).length})`],
          ].map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => changeFilter(key as VocabularyFilter)}
              className={`rounded-lg px-4 py-2 transition-colors ${
                filter === key
                  ? key === 'weak'
                    ? 'bg-amber-600 text-white'
                    : 'bg-blue-600 text-white'
                  : 'bg-gray-800 hover:bg-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>

        <div className="inline-flex w-fit rounded-lg border border-gray-800 bg-gray-900/50 p-1">
          <button
            type="button"
            onClick={() => changeViewMode('cards')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              viewMode === 'cards'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <Layers className="h-4 w-4" />
            客观练习
          </button>
          <button
            type="button"
            onClick={() => changeViewMode('list')}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              viewMode === 'list'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <List className="h-4 w-4" />
            列表
          </button>
          <button
            type="button"
            onClick={() => {
              const first = filteredVocabulary[0];
              const currentID = knowledgeGraph?.focus?.metadata?.vocabulary_id;
              const currentInFilter = filteredVocabulary.some((item) => item.id === currentID);
              setViewMode('graph');
              if (first && (!knowledgeGraph || !currentInFilter)) {
                openKnowledgeGraph(first.id);
              }
            }}
            className={`inline-flex items-center gap-2 rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
              viewMode === 'graph'
                ? 'bg-blue-600 text-white'
                : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
            }`}
          >
            <Network className="h-4 w-4" />
            图谱
          </button>
        </div>
      </div>

      {viewMode === 'cards' ? (
        <div className="mx-auto max-w-3xl">
          {exerciseLoading ? (
            <div className="flex min-h-80 items-center justify-center rounded-lg border border-gray-800 bg-gray-900/60">
              <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
            </div>
          ) : !activeExercise ? (
            <div className="py-16 text-center">
              <BookOpen className="mx-auto mb-4 h-16 w-16 text-gray-700" />
              <p className="text-gray-500">当前筛选没有待练习生词</p>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center justify-between text-sm text-gray-500">
                <span>
                  第 {cardIndex + 1} / {exercises.length} 题
                </span>
                <span>{exerciseLabels[activeExercise.type]}</span>
              </div>

              <form onSubmit={submitExerciseAnswer} className="rounded-lg border border-gray-800 bg-gray-900/60 p-6 sm:p-8">
                <div className="mb-6 flex items-start justify-between gap-4">
                  <div>
                    <p className="mb-2 text-sm font-semibold text-blue-300">{activeExercise.prompt}</p>
                    {activeExercise.type === 'en_to_zh_choice' ? (
                      <h2 className="text-4xl font-black text-gray-100">{activeExercise.word}</h2>
                    ) : (
                      <h2 className="text-2xl font-black text-gray-100">{exerciseLabels[activeExercise.type]}</h2>
                    )}
                    {activeVocabulary?.phonetic && (
                      <p className="mt-2 text-sm text-gray-500">{activeVocabulary.phonetic}</p>
                    )}
                  </div>
                  {activeVocabulary?.forgotten_count ? (
                    <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-sm font-semibold text-amber-300">
                      <TriangleAlert className="h-4 w-4" />
                      忘记 {activeVocabulary.forgotten_count} 次
                    </span>
                  ) : null}
                </div>

                {activeExercise.type === 'audio_word_choice' && (
                  <button
                    type="button"
                    onClick={() => speakWord(activeExercise.audio_text || activeExercise.word)}
                    className="mb-5 inline-flex items-center gap-2 rounded-md border border-blue-500/60 px-4 py-2 text-sm font-semibold text-blue-200 transition-colors hover:bg-blue-500/10"
                  >
                    <Headphones className="h-4 w-4" />
                    播放发音
                  </button>
                )}

                {activeExercise.context && (
                  <div className="mb-6 rounded-lg border border-gray-800 bg-gray-950/60 p-4">
                    <p className="text-xs font-semibold text-gray-500">
                      {activeExercise.type === 'sentence_meaning_choice' ? '例句' : '原文语境'}
                    </p>
                    <p className="mt-2 text-base leading-8 text-gray-300">{activeExercise.context}</p>
                  </div>
                )}

                {activeExercise.options?.length ? (
                  <div className="grid gap-3">
                    {activeExercise.options.map((option) => {
                      const isSelected = selectedOption === option;
                      const isCorrect = answerResult?.correct_answer === option;
                      const isWrongSelection = answerResult && isSelected && !answerResult.correct;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => !answerSubmitted && setSelectedOption(option)}
                          disabled={answerSubmitted}
                          className={`min-h-12 rounded-md border px-4 py-3 text-left text-sm font-semibold transition-colors ${
                            isCorrect && answerSubmitted
                              ? 'border-green-500 bg-green-500/10 text-green-200'
                              : isWrongSelection
                                ? 'border-red-500 bg-red-500/10 text-red-200'
                                : isSelected
                                  ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                                  : 'border-gray-700 bg-gray-950/40 text-gray-300 hover:border-blue-500'
                          }`}
                        >
                          {option}
                        </button>
                      );
                    })}
                  </div>
                ) : (
                  <label className="block">
                    <span className="mb-2 flex items-center gap-2 text-sm font-semibold text-gray-400">
                      <Keyboard className="h-4 w-4" />
                      输入答案
                    </span>
                    <input
                      value={answer}
                      onChange={(event) => setAnswer(event.target.value)}
                      disabled={answerSubmitted}
                      placeholder={activeExercise.placeholder || '输入英文单词'}
                      className="w-full rounded-md border border-gray-700 bg-gray-950 px-4 py-3 text-lg text-gray-100 outline-none transition-colors focus:border-blue-500 disabled:opacity-70"
                    />
                  </label>
                )}

                {answerResult && (
                  <div
                    className={`mt-5 rounded-lg border p-4 ${
                      answerResult.correct
                        ? 'border-green-500/40 bg-green-500/10 text-green-100'
                        : 'border-red-500/40 bg-red-500/10 text-red-100'
                    }`}
                  >
                    <p className="flex items-center gap-2 font-semibold">
                      {answerResult.correct ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                      {answerResult.correct ? '回答正确' : '回答错误'}
                    </p>
                    <p className="mt-2 text-sm opacity-90">正确答案：{answerResult.correct_answer}</p>
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <button
                    type="button"
                    onClick={() => {
                      setCardIndex((current) => Math.max(0, current - 1));
                      setAnswer('');
                      setSelectedOption('');
                      setAnswerResult(null);
                    }}
                    disabled={cardIndex === 0 || answerSubmitted}
                    className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-800 disabled:opacity-40"
                  >
                    上一题
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    {!answerSubmitted ? (
                      <button
                        type="submit"
                        disabled={!canSubmit || reviewingId === activeExercise.vocabulary_id}
                        className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                      >
                        {reviewingId === activeExercise.vocabulary_id && <Loader2 className="h-4 w-4 animate-spin" />}
                        提交答案
                      </button>
                    ) : (
                      <button
                        type="button"
                        onClick={goToNextExercise}
                        className="rounded-md bg-green-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-500"
                      >
                        下一题
                      </button>
                    )}
                  </div>
                </div>
              </form>
            </>
          )}
        </div>
      ) : viewMode === 'graph' ? (
        <div className="grid gap-5 lg:grid-cols-[280px_1fr]">
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
            <div className="mb-4 flex items-center gap-2">
              <Network className="h-5 w-5 text-blue-300" />
              <h2 className="text-lg font-bold">生词图谱</h2>
            </div>
            <div className="space-y-2">
              {filteredVocabulary.slice(0, 24).map((item) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => openKnowledgeGraph(item.id)}
                  className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                    knowledgeGraph?.focus?.metadata?.vocabulary_id === item.id
                      ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                      : 'border-gray-800 bg-gray-950/30 text-gray-300 hover:border-blue-500/70'
                  }`}
                >
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{item.word}</span>
                    <span className="block truncate text-xs text-gray-500">
                      {item.translation || item.context || '暂无释义'}
                    </span>
                  </span>
                  {graphLoadingId === item.id ? (
                    <Loader2 className="h-4 w-4 shrink-0 animate-spin text-blue-400" />
                  ) : (
                    <CircleDot className="h-4 w-4 shrink-0 text-gray-600" />
                  )}
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4 sm:p-5">
            {graphLoadingId && !knowledgeGraph ? (
              <div className="flex min-h-96 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : graphError ? (
              <div className="py-16 text-center text-red-300">{graphError}</div>
            ) : !knowledgeGraph ? (
              <div className="py-16 text-center">
                <Network className="mx-auto mb-4 h-16 w-16 text-gray-700" />
                <p className="text-gray-500">选择一个单词查看它的知识图谱</p>
              </div>
            ) : (
              <>
                <div className="mb-5 flex flex-col gap-4 border-b border-gray-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="mb-2 text-sm font-semibold text-blue-300">当前中心词</p>
                    <h2 className="text-3xl font-black text-gray-100">{knowledgeGraph.focus?.label || '学习图谱'}</h2>
                    {knowledgeGraph.focus?.description && (
                      <p className="mt-2 max-w-2xl text-sm leading-6 text-gray-400">
                        {knowledgeGraph.focus.description}
                      </p>
                    )}
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-400 sm:min-w-64">
                    <div className="rounded-md border border-gray-800 bg-gray-950/40 p-2">
                      <p className="text-lg font-bold text-gray-100">{knowledgeGraph.stats.related_words}</p>
                      <p>相关词</p>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-950/40 p-2">
                      <p className="text-lg font-bold text-gray-100">{knowledgeGraph.stats.articles}</p>
                      <p>文章</p>
                    </div>
                    <div className="rounded-md border border-gray-800 bg-gray-950/40 p-2">
                      <p className="text-lg font-bold text-gray-100">{knowledgeGraph.stats.topics}</p>
                      <p>主题</p>
                    </div>
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  {knowledgeGraph.nodes.map((node) => (
                    <div
                      key={node.id}
                      className={`flex flex-col justify-between rounded-lg border p-4 ${graphTypeClasses[node.type]} ${nodeSizeClass(node)}`}
                    >
                      <div>
                        <div className="mb-3 flex items-start justify-between gap-3">
                          <span className="rounded-full bg-black/20 px-2 py-1 text-xs font-semibold">
                            {graphTypeLabels[node.type]}
                          </span>
                          {node.mastery !== undefined && (
                            <span className="flex items-center gap-1 text-xs font-semibold">
                              <span className={`h-2 w-2 rounded-full ${masteryClass(node.mastery)}`} />
                              {node.mastery}
                            </span>
                          )}
                        </div>
                        <h3 className="break-words text-lg font-bold leading-6">{node.label}</h3>
                        {node.description && (
                          <p className="mt-2 line-clamp-4 text-sm leading-6 opacity-80">{node.description}</p>
                        )}
                      </div>
                      {node.metadata?.slug && (
                        <a
                          href={`/articles/${node.metadata.slug}`}
                          className="mt-3 inline-flex w-fit items-center gap-1 text-xs font-semibold underline-offset-4 hover:underline"
                        >
                          <BookOpen className="h-3 w-3" />
                          打开文章
                        </a>
                      )}
                    </div>
                  ))}
                </div>

                {knowledgeGraph.edges.length > 0 && (
                  <div className="mt-5 rounded-lg border border-gray-800 bg-gray-950/40 p-4">
                    <div className="mb-3 flex items-center gap-2">
                      <GitBranch className="h-4 w-4 text-gray-400" />
                      <h3 className="text-sm font-bold text-gray-300">关系</h3>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      {knowledgeGraph.edges.slice(0, 18).map((edge) => (
                        <span
                          key={edge.id}
                          className="rounded-full border border-gray-700 bg-gray-900 px-3 py-1 text-xs text-gray-300"
                        >
                          {edge.label}
                        </span>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      ) : filteredVocabulary.length === 0 ? (
        <div className="py-16 text-center">
          <BookOpen className="mx-auto mb-4 h-16 w-16 text-gray-700" />
          <p className="text-gray-500">暂无生词</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
          {filteredVocabulary.map((item) => (
            <div key={item.id} className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
              <div className="mb-3 flex items-start justify-between">
                <div className="flex-1">
                  <h3 className="mb-1 text-xl font-bold">{item.word}</h3>
                  {item.phonetic && <p className="text-sm text-gray-500">{item.phonetic}</p>}
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
                  <span className="flex items-center space-x-1 text-sm text-green-400">
                    <Check className="h-4 w-4" />
                    <span>已掌握</span>
                  </span>
                )}
              </div>

              {item.translation && <p className="mb-3 text-gray-300">{item.translation}</p>}

              {item.context && (
                <div className="mb-3 rounded bg-gray-800/50 p-3 text-sm">
                  <p className="text-gray-400">{item.context}</p>
                </div>
              )}

              <div className="flex items-center justify-between text-xs text-gray-500">
                <span>添加于 {format(new Date(item.created_at), 'yyyy-MM-dd')}</span>
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button
                    onClick={() => openKnowledgeGraph(item.id)}
                    disabled={graphLoadingId === item.id}
                    className="inline-flex items-center gap-1 rounded bg-blue-600 px-2 py-1 text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                  >
                    {graphLoadingId === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Network className="h-3 w-3" />
                    )}
                    图谱
                  </button>
                  <button
                    onClick={() => handleReview(item.id, 'forgot')}
                    disabled={reviewingId === item.id || deletingId === item.id}
                    className="inline-flex items-center gap-1 rounded bg-gray-700 px-2 py-1 text-white transition-colors hover:bg-gray-600 disabled:opacity-50"
                  >
                    <RotateCcw className="h-3 w-3" />
                    忘记
                  </button>
                  <button
                    onClick={() => handleReview(item.id, 'hard')}
                    disabled={reviewingId === item.id || deletingId === item.id}
                    className="rounded bg-yellow-600 px-2 py-1 text-white transition-colors hover:bg-yellow-500 disabled:opacity-50"
                  >
                    模糊
                  </button>
                  <button
                    onClick={() => handleReview(item.id, 'good')}
                    disabled={reviewingId === item.id || deletingId === item.id}
                    className="rounded bg-green-600 px-2 py-1 text-white transition-colors hover:bg-green-500 disabled:opacity-50"
                  >
                    记得
                  </button>
                  {!item.is_learned && (
                    <button
                      onClick={() => handleMarkLearned(item.id)}
                      disabled={deletingId === item.id}
                      className="rounded bg-green-600 px-3 py-1 text-white transition-colors hover:bg-green-700 disabled:opacity-50"
                    >
                      标记已掌握
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={() => handleDeleteWord(item)}
                    disabled={deletingId === item.id || reviewingId === item.id}
                    className="inline-flex items-center gap-1 rounded border border-red-500/50 px-2 py-1 text-red-200 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                  >
                    {deletingId === item.id ? (
                      <Loader2 className="h-3 w-3 animate-spin" />
                    ) : (
                      <Trash2 className="h-3 w-3" />
                    )}
                    删除
                  </button>
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
