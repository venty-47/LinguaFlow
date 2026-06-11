'use client';

import { FormEvent, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { format } from 'date-fns';
import {
  AlertTriangle,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  FileEdit,
  FileText,
  Headphones,
  Keyboard,
  Layers,
  ListChecks,
  Loader2,
  Network,
  RotateCcw,
  Search,
  Trash2,
  Volume2,
  XCircle,
} from 'lucide-react';
import { translationAPI, vocabularyAPI } from '@/lib/api';
import {
  Vocabulary,
  VocabularyAnswerResult,
  VocabularyExercise,
  VocabularyExerciseType,
  VocabularyKnowledgeGraph,
} from '@/types';

type VocabularyFilter = 'due' | 'weak' | 'learning' | 'learned' | 'all';
type ReviewRating = 'forgot' | 'hard' | 'good';

const exerciseLabels: Record<VocabularyExerciseType, string> = {
  en_to_zh_choice: '英译中选择',
  zh_to_en_spelling: '中译英拼写',
  context_fill_blank: '原文填空',
  audio_word_choice: '听音辨词',
  sentence_meaning_choice: '例句选义',
};

const filterLabels: Record<VocabularyFilter, string> = {
  due: '今日',
  weak: '薄弱',
  learning: '学习中',
  learned: '已掌握',
  all: '全部',
};

function isDue(item: Vocabulary) {
  if (!item.next_review_at) return true;
  return new Date(item.next_review_at).getTime() <= Date.now();
}

async function speakWord(text: string, accent: 'uk' | 'us' = 'us') {
  if (!text) return;
  try {
    const response = await translationAPI.lookupWord(text, {});
    const data = response.data.data;
    const audioUrl = accent === 'uk'
      ? (data.uk_speech_url || data.speech_url)
      : (data.us_speech_url || data.speech_url);
    if (audioUrl) {
      const audio = new Audio(audioUrl);
      await audio.play();
      return;
    }
  } catch (error) {
    console.error('Dictionary audio failed:', error);
  }
}

function formatDate(value?: string) {
  if (!value) return '未安排';
  return format(new Date(value), 'MM-dd');
}

function masteryPercent(word: Vocabulary) {
  if (word.is_learned) return 100;
  const reviewScore = Math.min(word.review_count * 18, 72);
  const forgottenPenalty = Math.min(word.forgotten_count * 16, 48);
  const easeBonus = Math.max(0, Math.min(Math.round((word.review_ease - 1.3) * 16), 20));
  return Math.max(8, Math.min(96, reviewScore + easeBonus - forgottenPenalty));
}

function getFilterCount(filter: VocabularyFilter, vocabulary: Vocabulary[]) {
  if (filter === 'due') return vocabulary.filter((item) => !item.is_learned || isDue(item)).length;
  if (filter === 'weak') return vocabulary.filter((item) => item.forgotten_count > 0).length;
  if (filter === 'learning') return vocabulary.filter((item) => !item.is_learned).length;
  if (filter === 'learned') return vocabulary.filter((item) => item.is_learned).length;
  return vocabulary.length;
}

function vocabularySort(a: Vocabulary, b: Vocabulary) {
  const aDue = !a.is_learned || isDue(a);
  const bDue = !b.is_learned || isDue(b);
  if (aDue !== bDue) return aDue ? -1 : 1;
  if (b.forgotten_count !== a.forgotten_count) return b.forgotten_count - a.forgotten_count;
  return new Date(b.last_review || b.updated_at).getTime() - new Date(a.last_review || a.updated_at).getTime();
}

function VocabularyContent() {
  const searchParams = useSearchParams();
  const initialFilter: VocabularyFilter = searchParams.get('weak') === 'true' ? 'weak' : 'due';
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [exercises, setExercises] = useState<VocabularyExercise[]>([]);
  const [loading, setLoading] = useState(true);
  const [exerciseLoading, setExerciseLoading] = useState(true);
  const [filter, setFilter] = useState<VocabularyFilter>(initialFilter);
  const [searchTerm, setSearchTerm] = useState('');
  const [cardIndex, setCardIndex] = useState(0);
  const [answer, setAnswer] = useState('');
  const [selectedOption, setSelectedOption] = useState('');
  const [answerResult, setAnswerResult] = useState<VocabularyAnswerResult | null>(null);
  const [reviewingId, setReviewingId] = useState<number | null>(null);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [selectedWordId, setSelectedWordId] = useState<number | null>(null);
  const [graphLoadingId, setGraphLoadingId] = useState<number | null>(null);
  const [knowledgeGraph, setKnowledgeGraph] = useState<VocabularyKnowledgeGraph | null>(null);
  const [graphError, setGraphError] = useState('');
  const [activeTab, setActiveTab] = useState<'review' | 'manage'>('review');
  const [notesDraft, setNotesDraft] = useState('');
  const [notesSaving, setNotesSaving] = useState(false);
  const [notesSaved, setNotesSaved] = useState(false);
  const notesWordIdRef = useRef<number | null>(null);
  const graphRequestRef = useRef(0);

  const fetchVocabulary = useCallback(async () => {
    try {
      setLoading(true);
      const response = await vocabularyAPI.getVocabulary();
      const nextVocabulary = (response.data.data || []) as Vocabulary[];
      setVocabulary(nextVocabulary);
      setSelectedWordId((current) => current ?? nextVocabulary[0]?.id ?? null);
    } catch (error) {
      console.error('Failed to fetch vocabulary:', error);
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchExercises = useCallback(async (nextFilter: VocabularyFilter) => {
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
    const nextFilter: VocabularyFilter = searchParams.get('weak') === 'true' ? 'weak' : 'due';
    setFilter(nextFilter);
    fetchVocabulary();
    fetchExercises(nextFilter);
  }, [fetchExercises, fetchVocabulary, searchParams]);

  const stats = useMemo(() => {
    const total = vocabulary.length;
    const due = getFilterCount('due', vocabulary);
    const weak = getFilterCount('weak', vocabulary);
    const learned = getFilterCount('learned', vocabulary);
    const averageMastery = total
      ? Math.round(vocabulary.reduce((sum, word) => sum + masteryPercent(word), 0) / total)
      : 0;

    return { total, due, weak, learned, averageMastery };
  }, [vocabulary]);

  const filteredVocabulary = useMemo(() => {
    const query = searchTerm.trim().toLowerCase();

    return vocabulary
      .filter((item) => {
        if (filter === 'due' && item.is_learned && !isDue(item)) return false;
        if (filter === 'weak' && item.forgotten_count <= 0) return false;
        if (filter === 'learning' && item.is_learned) return false;
        if (filter === 'learned' && !item.is_learned) return false;
        if (!query) return true;
        return [item.word, item.translation, item.definition, item.context]
          .filter(Boolean)
          .some((value) => value?.toLowerCase().includes(query));
      })
      .sort(vocabularySort);
  }, [filter, searchTerm, vocabulary]);

  const activeExercise = exercises[cardIndex];
  const activeVocabulary = activeExercise
    ? vocabulary.find((item) => item.id === activeExercise.vocabulary_id)
    : undefined;
  const selectedWord =
    vocabulary.find((item) => item.id === selectedWordId) || filteredVocabulary[0] || vocabulary[0];
  const canSubmit = Boolean((activeExercise?.options?.length ? selectedOption : answer).trim()) && !answerResult;

  // Sync notes draft when selected word changes
  useEffect(() => {
    if (selectedWord) {
      setNotesDraft(selectedWord.notes || '');
      notesWordIdRef.current = selectedWord.id;
      setNotesSaved(false);
    }
  }, [selectedWord?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const saveNotes = useCallback(async () => {
    if (!selectedWord || notesSaving) return;
    if (notesWordIdRef.current !== selectedWord.id) return;
    if (notesDraft === (selectedWord.notes || '')) return;

    try {
      setNotesSaving(true);
      const response = await vocabularyAPI.updateNotes(selectedWord.id, notesDraft);
      const updated = response.data.data as Vocabulary;
      setVocabulary((prev) => prev.map((item) => (item.id === updated.id ? updated : item)));
      setNotesSaved(true);
      setTimeout(() => setNotesSaved(false), 2000);
    } catch (error) {
      console.error('Failed to save notes:', error);
    } finally {
      setNotesSaving(false);
    }
  }, [selectedWord, notesDraft, notesSaving]);

  const resetCardState = () => {
    setAnswer('');
    setSelectedOption('');
    setAnswerResult(null);
  };

  const changeFilter = (nextFilter: VocabularyFilter) => {
    setFilter(nextFilter);
    resetCardState();
    setCardIndex(0);
    fetchExercises(nextFilter);
  };

  const updateVocabularyItem = (nextWord: Vocabulary) => {
    setVocabulary((prev) => prev.map((item) => (item.id === nextWord.id ? nextWord : item)));
    setSelectedWordId(nextWord.id);
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
      updateVocabularyItem(result.data);
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
    resetCardState();
  };

  const handleReview = async (id: number, rating: ReviewRating) => {
    try {
      setReviewingId(id);
      const response = await vocabularyAPI.reviewWord(id, rating);
      updateVocabularyItem(response.data.data as Vocabulary);
    } catch (error) {
      console.error('Failed to review word:', error);
    } finally {
      setReviewingId(null);
    }
  };

  const handleMarkLearned = async (id: number) => {
    try {
      setReviewingId(id);
      const response = await vocabularyAPI.markLearned(id);
      updateVocabularyItem(response.data.data as Vocabulary);
    } catch (error) {
      console.error('Failed to mark word as learned:', error);
    } finally {
      setReviewingId(null);
    }
  };

  const handleDeleteWord = async (word: Vocabulary) => {
    if (typeof window !== 'undefined' && !window.confirm(`确定删除「${word.word}」吗？`)) return;

    try {
      setDeletingId(word.id);
      await vocabularyAPI.deleteWord(word.id);
      setVocabulary((prev) => prev.filter((item) => item.id !== word.id));
      setExercises((prev) => prev.filter((item) => item.vocabulary_id !== word.id));
      if (selectedWordId === word.id) {
        setSelectedWordId(null);
        setKnowledgeGraph(null);
      }
    } catch (error) {
      console.error('Failed to delete word:', error);
    } finally {
      setDeletingId(null);
    }
  };

  const openKnowledgeGraph = async (id: number) => {
    const requestID = graphRequestRef.current + 1;
    graphRequestRef.current = requestID;

    try {
      setSelectedWordId(id);
      setGraphLoadingId(id);
      setGraphError('');
      const response = await vocabularyAPI.getKnowledgeGraph(id);
      if (graphRequestRef.current !== requestID) return;
      setKnowledgeGraph(response.data.data);
    } catch (error) {
      if (graphRequestRef.current !== requestID) return;
      console.error('Failed to fetch knowledge graph:', error);
      setGraphError('图谱加载失败');
    } finally {
      if (graphRequestRef.current === requestID) {
        setGraphLoadingId(null);
      }
    }
  };

  // Auto-load knowledge graph when a word is first selected
  useEffect(() => {
    if (!selectedWord) return;
    if (knowledgeGraph?.focus?.metadata?.vocabulary_id === selectedWord.id) return;
    if (graphLoadingId !== null) return;
    openKnowledgeGraph(selectedWord.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedWord?.id]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
      <section className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <div className="rounded-md border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex items-center justify-between text-gray-400">
            <span className="text-sm font-semibold">今日待复习</span>
            <Clock className="h-4 w-4 text-blue-300" />
          </div>
          <p className="text-3xl font-black text-gray-100">{stats.due}</p>
          <p className="mt-1 text-xs text-gray-500">当前队列 {exercises.length} 题</p>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex items-center justify-between text-gray-400">
            <span className="text-sm font-semibold">薄弱词</span>
            <AlertTriangle className="h-4 w-4 text-amber-300" />
          </div>
          <p className="text-3xl font-black text-gray-100">{stats.weak}</p>
          <p className="mt-1 text-xs text-gray-500">按遗忘次数优先</p>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex items-center justify-between text-gray-400">
            <span className="text-sm font-semibold">已掌握</span>
            <CheckCircle2 className="h-4 w-4 text-emerald-300" />
          </div>
          <p className="text-3xl font-black text-gray-100">{stats.learned}</p>
          <p className="mt-1 text-xs text-gray-500">共 {stats.total} 个单词</p>
        </div>
        <div className="rounded-md border border-gray-800 bg-gray-900/70 p-4">
          <div className="mb-3 flex items-center justify-between text-gray-400">
            <span className="text-sm font-semibold">平均熟悉度</span>
            <Layers className="h-4 w-4 text-violet-300" />
          </div>
          <p className="text-3xl font-black text-gray-100">{stats.averageMastery}%</p>
          <div className="mt-3 h-2 rounded-full bg-gray-800">
            <div className="h-full rounded-full bg-emerald-500" style={{ width: `${stats.averageMastery}%` }} />
          </div>
        </div>
      </section>

      <div className="mb-6 flex gap-2 border-b border-gray-800">
        <button
          onClick={() => setActiveTab('review')}
          className={`px-6 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'review'
              ? 'border-b-2 border-blue-500 text-blue-300'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          生词复习
        </button>
        <button
          onClick={() => setActiveTab('manage')}
          className={`px-6 py-3 text-sm font-semibold transition-colors ${
            activeTab === 'manage'
              ? 'border-b-2 border-blue-500 text-blue-300'
              : 'text-gray-400 hover:text-gray-300'
          }`}
        >
          生词管理
        </button>
      </div>

      {activeTab === 'review' ? (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main className="space-y-5">
          <section className="rounded-md border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <h1 className="text-2xl font-black text-gray-100 sm:text-3xl">复习练习</h1>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(filterLabels) as VocabularyFilter[]).map((key) => (
                  <button
                    key={key}
                    type="button"
                    onClick={() => changeFilter(key)}
                    className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                      filter === key
                        ? 'bg-blue-600 text-white'
                        : 'border border-gray-800 bg-gray-950/40 text-gray-300 hover:border-blue-500/70'
                    }`}
                  >
                    {filterLabels[key]} {getFilterCount(key, vocabulary)}
                  </button>
                ))}
              </div>
            </div>

            {exerciseLoading ? (
              <div className="flex min-h-96 items-center justify-center rounded-md border border-gray-800 bg-gray-950/40">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : !activeExercise ? (
              <div className="flex min-h-96 flex-col items-center justify-center rounded-md border border-gray-800 bg-gray-950/40 px-4 text-center">
                <BookOpen className="mb-4 h-14 w-14 text-gray-700" />
                <p className="text-lg font-semibold text-gray-300">这个筛选下没有待练习题</p>
                <p className="mt-2 text-sm text-gray-500">可以切到全部或薄弱词继续复习。</p>
              </div>
            ) : (
              <form onSubmit={submitExerciseAnswer} className="rounded-md border border-gray-800 bg-gray-950/50 p-4 sm:p-6">
                <div className="mb-5 flex flex-col gap-4 border-b border-gray-800 pb-5 sm:flex-row sm:items-start sm:justify-between">
                  <div className="min-w-0">
                    <div className="mb-3 flex flex-wrap items-center gap-2">
                      <span className="rounded-full bg-blue-500/10 px-3 py-1 text-xs font-bold text-blue-200">
                        {exerciseLabels[activeExercise.type]}
                      </span>
                      <span className="text-xs font-semibold text-gray-500">
                        {cardIndex + 1} / {exercises.length}
                      </span>
                      {activeVocabulary?.forgotten_count ? (
                        <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/10 px-3 py-1 text-xs font-bold text-amber-200">
                          <AlertTriangle className="h-3 w-3" />
                          忘记 {activeVocabulary.forgotten_count} 次
                        </span>
                      ) : null}
                    </div>
                    <p className="text-sm font-semibold leading-6 text-gray-400">{activeExercise.prompt}</p>
                    <h2 className="mt-3 break-words text-4xl font-black text-gray-100 sm:text-5xl">
                      {activeExercise.type === 'en_to_zh_choice' ? activeExercise.word : activeVocabulary?.word || activeExercise.word}
                    </h2>
                    {activeVocabulary?.phonetic && (
                      <p className="mt-2 text-sm font-semibold text-gray-500">{activeVocabulary.phonetic}</p>
                    )}
                  </div>
                  <div className="flex shrink-0 gap-2">
                    <button
                      type="button"
                      onClick={() => speakWord(activeExercise.audio_text || activeExercise.word, 'uk')}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-gray-700 px-3 text-sm font-semibold text-gray-200 transition-colors hover:border-blue-500 hover:text-blue-200"
                      title="英音"
                    >
                      <Volume2 className="h-4 w-4" />
                      英音
                    </button>
                    <button
                      type="button"
                      onClick={() => speakWord(activeExercise.audio_text || activeExercise.word, 'us')}
                      className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-gray-700 px-3 text-sm font-semibold text-gray-200 transition-colors hover:border-blue-500 hover:text-blue-200"
                      title="美音"
                    >
                      <Volume2 className="h-4 w-4" />
                      美音
                    </button>
                  </div>
                </div>

                {activeExercise.context && (
                  <div className="mb-5 rounded-md border border-gray-800 bg-gray-900/70 p-4">
                    <p className="text-sm leading-7 text-gray-300">{activeExercise.context}</p>
                  </div>
                )}

                {activeExercise.type === 'audio_word_choice' && (
                  <button
                    type="button"
                    onClick={() => speakWord(activeExercise.audio_text || activeExercise.word)}
                    className="mb-5 inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white transition-colors hover:bg-blue-500"
                  >
                    <Headphones className="h-4 w-4" />
                    播放听力
                  </button>
                )}

                {activeExercise.options?.length ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {activeExercise.options.map((option) => {
                      const isSelected = selectedOption === option;
                      const isCorrect = answerResult?.correct_answer === option;
                      const isWrongSelection = answerResult && isSelected && !answerResult.correct;
                      return (
                        <button
                          key={option}
                          type="button"
                          onClick={() => !answerResult && setSelectedOption(option)}
                          disabled={Boolean(answerResult)}
                          className={`min-h-14 rounded-md border px-4 py-3 text-left text-sm font-semibold leading-6 transition-colors ${
                            isCorrect && answerResult
                              ? 'border-emerald-500 bg-emerald-500/10 text-emerald-100'
                              : isWrongSelection
                                ? 'border-red-500 bg-red-500/10 text-red-100'
                                : isSelected
                                  ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                                  : 'border-gray-700 bg-gray-900/80 text-gray-300 hover:border-blue-500/80'
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
                      disabled={Boolean(answerResult)}
                      placeholder={activeExercise.placeholder || '输入英文单词'}
                      className="h-12 w-full rounded-md border border-gray-700 bg-gray-900 px-4 text-lg font-semibold text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500 disabled:opacity-70"
                    />
                  </label>
                )}

                {answerResult && (
                  <div
                    className={`mt-5 rounded-md border p-4 ${
                      answerResult.correct
                        ? 'border-emerald-500/50 bg-emerald-500/10 text-emerald-100'
                        : 'border-red-500/50 bg-red-500/10 text-red-100'
                    }`}
                  >
                    <p className="flex items-center gap-2 font-bold">
                      {answerResult.correct ? <CheckCircle2 className="h-5 w-5" /> : <XCircle className="h-5 w-5" />}
                      {answerResult.message || (answerResult.correct ? '回答正确' : '回答错误')}
                    </p>
                    <p className="mt-2 text-sm opacity-90">正确答案：{answerResult.correct_answer}</p>
                  </div>
                )}

                <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        setCardIndex((current) => Math.max(0, current - 1));
                        resetCardState();
                      }}
                      disabled={cardIndex === 0 || Boolean(answerResult)}
                      className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 transition-colors hover:bg-gray-800 disabled:opacity-40"
                    >
                      上一题
                    </button>
                    {activeVocabulary && (
                      <button
                        type="button"
                        onClick={() => handleReview(activeVocabulary.id, 'forgot')}
                        disabled={reviewingId === activeVocabulary.id}
                        className="inline-flex items-center gap-2 rounded-md border border-amber-600/70 px-3 py-2 text-sm font-semibold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                      >
                        <RotateCcw className="h-4 w-4" />
                        忘记
                      </button>
                    )}
                  </div>

                  {!answerResult ? (
                    <button
                      type="submit"
                      disabled={!canSubmit || reviewingId === activeExercise.vocabulary_id}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-blue-500 disabled:opacity-50"
                    >
                      {reviewingId === activeExercise.vocabulary_id && <Loader2 className="h-4 w-4 animate-spin" />}
                      提交
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={goToNextExercise}
                      className="inline-flex items-center justify-center gap-2 rounded-md bg-emerald-600 px-5 py-2.5 text-sm font-bold text-white transition-colors hover:bg-emerald-500"
                    >
                      下一题
                      <ChevronRight className="h-4 w-4" />
                    </button>
                  )}
                </div>
              </form>
            )}
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-md border border-gray-800 bg-gray-900/60 p-4">
            <div className="mb-4 flex items-center justify-between">
              <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                <ListChecks className="h-4 w-4 text-blue-300" />
                复习队列
              </div>
              {exerciseLoading && <Loader2 className="h-4 w-4 animate-spin text-blue-400" />}
            </div>
            {exercises.length === 0 ? (
              <p className="rounded-md border border-gray-800 bg-gray-950/40 p-4 text-sm text-gray-500">
                队列为空
              </p>
            ) : (
              <div className="space-y-2">
                {exercises.slice(0, 12).map((exercise, index) => (
                  <button
                    key={`${exercise.vocabulary_id}-${exercise.type}-${index}`}
                    type="button"
                    onClick={() => {
                      setCardIndex(index);
                      resetCardState();
                    }}
                    className={`flex w-full items-center justify-between gap-3 rounded-md border px-3 py-2 text-left transition-colors ${
                      index === cardIndex
                        ? 'border-blue-500 bg-blue-500/10 text-blue-100'
                        : 'border-gray-800 bg-gray-950/30 text-gray-300 hover:border-blue-500/60'
                    }`}
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-bold">{exercise.word}</span>
                      <span className="block text-xs text-gray-500">{exerciseLabels[exercise.type]}</span>
                    </span>
                    <ChevronRight className="h-4 w-4 shrink-0 text-gray-500" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </aside>
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
        <main>
          <section className="rounded-md border border-gray-800 bg-gray-900/60 p-4 sm:p-5">
            <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-2xl font-black text-gray-100">生词列表</h2>
                <p className="mt-1 text-sm text-gray-500">当前显示 {filteredVocabulary.length} 个</p>
              </div>
              <label className="relative w-full md:w-80">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                <input
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  placeholder="搜索单词、释义、语境"
                  className="h-10 w-full rounded-md border border-gray-700 bg-gray-950 pl-9 pr-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
                />
              </label>
            </div>

            {filteredVocabulary.length === 0 ? (
              <div className="flex min-h-56 flex-col items-center justify-center rounded-md border border-gray-800 bg-gray-950/40 text-center">
                <BookOpen className="mb-3 h-12 w-12 text-gray-700" />
                <p className="text-gray-500">没有匹配的生词</p>
              </div>
            ) : (
              <div className="overflow-hidden rounded-md border border-gray-800">
                {filteredVocabulary.map((word) => {
                  const mastery = masteryPercent(word);
                  const isSelected = selectedWord?.id === word.id;
                  return (
                    <div
                      key={word.id}
                      className={`grid gap-4 border-b border-gray-800 p-4 last:border-b-0 lg:grid-cols-[minmax(180px,260px)_1fr_auto] ${
                        isSelected ? 'bg-blue-500/5' : 'bg-gray-950/30'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => setSelectedWordId(word.id)}
                        className="min-w-0 text-left"
                      >
                        <div className="flex items-center gap-2">
                          <h3 className="break-words text-lg font-black text-gray-100">{word.word}</h3>
                          {word.is_learned && <Check className="h-4 w-4 shrink-0 text-emerald-300" />}
                        </div>
                        {word.phonetic && <p className="mt-1 text-xs font-semibold text-gray-500">{word.phonetic}</p>}
                        <div className="mt-3 h-1.5 rounded-full bg-gray-800">
                          <div className="h-full rounded-full bg-emerald-500" style={{ width: `${mastery}%` }} />
                        </div>
                      </button>

                      <div className="min-w-0">
                        <p className="text-sm font-semibold leading-6 text-gray-300">
                          {word.translation || word.definition || '暂无释义'}
                        </p>
                        {word.context && (
                          <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">{word.context}</p>
                        )}
                        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-semibold text-gray-500">
                          <span>复习 {word.review_count} 次</span>
                          <span>忘记 {word.forgotten_count} 次</span>
                          <span>下次 {formatDate(word.next_review_at)}</span>
                        </div>
                      </div>

                      <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                        <button
                          type="button"
                          onClick={() => speakWord(word.word, 'uk')}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs font-semibold text-gray-300 transition-colors hover:border-blue-500 hover:text-blue-200"
                          title="英音"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          UK
                        </button>
                        <button
                          type="button"
                          onClick={() => speakWord(word.word, 'us')}
                          className="inline-flex h-9 items-center justify-center gap-1 rounded-md border border-gray-700 px-2 text-xs font-semibold text-gray-300 transition-colors hover:border-blue-500 hover:text-blue-200"
                          title="美音"
                        >
                          <Volume2 className="h-3.5 w-3.5" />
                          US
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReview(word.id, 'hard')}
                          disabled={reviewingId === word.id || deletingId === word.id}
                          className="rounded-md border border-gray-700 px-3 py-2 text-xs font-bold text-gray-200 transition-colors hover:bg-gray-800 disabled:opacity-50"
                        >
                          模糊
                        </button>
                        <button
                          type="button"
                          onClick={() => handleReview(word.id, 'good')}
                          disabled={reviewingId === word.id || deletingId === word.id}
                          className="rounded-md bg-emerald-600 px-3 py-2 text-xs font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                        >
                          记得
                        </button>
                        {!word.is_learned && (
                          <button
                            type="button"
                            onClick={() => handleMarkLearned(word.id)}
                            disabled={reviewingId === word.id || deletingId === word.id}
                            className="rounded-md border border-emerald-600/70 px-3 py-2 text-xs font-bold text-emerald-200 transition-colors hover:bg-emerald-500/10 disabled:opacity-50"
                          >
                            掌握
                          </button>
                        )}
                        <button
                          type="button"
                          onClick={() => handleDeleteWord(word)}
                          disabled={reviewingId === word.id || deletingId === word.id}
                          className="inline-flex h-9 w-9 items-center justify-center rounded-md border border-red-500/50 text-red-200 transition-colors hover:bg-red-500/10 disabled:opacity-50"
                          title="删除"
                        >
                          {deletingId === word.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </section>
        </main>

        <aside className="space-y-5 xl:sticky xl:top-20 xl:self-start">
          <section className="rounded-md border border-gray-800 bg-gray-900/60 p-4">
            <div className="mb-4 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2 text-sm font-semibold text-gray-300">
                  <Network className="h-4 w-4 text-violet-300" />
                  单词详情
                </div>
                {selectedWord && <h2 className="mt-1 truncate text-2xl font-black text-gray-100">{selectedWord.word}</h2>}
              </div>
              {selectedWord && (
                <button
                  type="button"
                  onClick={() => openKnowledgeGraph(selectedWord.id)}
                  disabled={graphLoadingId === selectedWord.id}
                  className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-gray-700 text-gray-300 transition-colors hover:border-violet-500 hover:text-violet-200 disabled:opacity-50"
                  title="加载图谱"
                >
                  {graphLoadingId === selectedWord.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Network className="h-4 w-4" />}
                </button>
              )}
            </div>

            {!selectedWord ? (
              <p className="rounded-md border border-gray-800 bg-gray-950/40 p-4 text-sm text-gray-500">
                选择一个单词查看详情
              </p>
            ) : (
              <div className="space-y-4">
                <div className="rounded-md border border-gray-800 bg-gray-950/40 p-4">
                  {selectedWord.phonetic && <p className="text-sm font-semibold text-gray-500">{selectedWord.phonetic}</p>}
                  <p className="mt-2 text-sm leading-6 text-gray-300">
                    {selectedWord.translation || selectedWord.definition || '暂无释义'}
                  </p>
                  {selectedWord.context && (
                    <p className="mt-3 border-l-2 border-gray-700 pl-3 text-sm leading-6 text-gray-500">
                      {selectedWord.context}
                    </p>
                  )}
                </div>

                {/* Notes */}
                <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                  <div className="mb-2 flex items-center justify-between">
                    <label className="flex items-center gap-1.5 text-xs font-semibold text-gray-400">
                      <FileEdit className="h-3.5 w-3.5" />
                      我的笔记
                    </label>
                    <div className="flex items-center gap-2">
                      {notesSaved && (
                        <span className="flex items-center gap-1 text-[11px] font-semibold text-emerald-400">
                          <Check className="h-3 w-3" />
                          已保存
                        </span>
                      )}
                      <button
                        type="button"
                        onClick={saveNotes}
                        disabled={notesSaving || notesDraft === (selectedWord.notes || '')}
                        className="rounded border border-gray-700 px-2 py-0.5 text-[11px] font-semibold text-gray-300 transition-colors hover:border-blue-500 hover:text-blue-200 disabled:cursor-not-allowed disabled:opacity-40"
                      >
                        {notesSaving ? '保存中...' : '保存'}
                      </button>
                    </div>
                  </div>
                  <textarea
                    value={notesDraft}
                    onChange={(event) => setNotesDraft(event.target.value)}
                    onBlur={saveNotes}
                    onKeyDown={(event) => {
                      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                        event.preventDefault();
                        saveNotes();
                      }
                    }}
                    placeholder="记录这个词的用法、记忆技巧、易混点..."
                    rows={4}
                    className="w-full resize-none rounded border border-gray-800 bg-gray-900/60 px-3 py-2 text-sm leading-6 text-gray-200 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
                  />
                  <p className="mt-1.5 text-[11px] text-gray-600">Ctrl + Enter 快速保存</p>
                </div>

                <div className="grid grid-cols-3 gap-2 text-center text-xs text-gray-500">
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                    <p className="text-lg font-black text-gray-100">{selectedWord.review_count}</p>
                    <p>复习</p>
                  </div>
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                    <p className="text-lg font-black text-gray-100">{selectedWord.forgotten_count}</p>
                    <p>忘记</p>
                  </div>
                  <div className="rounded-md border border-gray-800 bg-gray-950/40 p-3">
                    <p className="text-lg font-black text-gray-100">{formatDate(selectedWord.next_review_at)}</p>
                    <p>下次</p>
                  </div>
                </div>

                <div className="grid grid-cols-3 gap-2">
                  <button
                    type="button"
                    onClick={() => handleReview(selectedWord.id, 'forgot')}
                    disabled={reviewingId === selectedWord.id}
                    className="rounded-md border border-amber-600/70 px-3 py-2 text-sm font-bold text-amber-200 transition-colors hover:bg-amber-500/10 disabled:opacity-50"
                  >
                    忘记
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(selectedWord.id, 'hard')}
                    disabled={reviewingId === selectedWord.id}
                    className="rounded-md border border-gray-700 px-3 py-2 text-sm font-bold text-gray-200 transition-colors hover:bg-gray-800 disabled:opacity-50"
                  >
                    模糊
                  </button>
                  <button
                    type="button"
                    onClick={() => handleReview(selectedWord.id, 'good')}
                    disabled={reviewingId === selectedWord.id}
                    className="rounded-md bg-emerald-600 px-3 py-2 text-sm font-bold text-white transition-colors hover:bg-emerald-500 disabled:opacity-50"
                  >
                    记得
                  </button>
                </div>

                {graphError && <p className="text-sm text-red-300">{graphError}</p>}
                {graphLoadingId === selectedWord.id && (
                  <div className="flex items-center gap-2 text-sm text-gray-500">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    加载知识图谱...
                  </div>
                )}
                {knowledgeGraph?.focus?.metadata?.vocabulary_id === selectedWord.id && (
                  <div className="space-y-3">
                    {/* Graph overview header */}
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2 text-xs font-semibold text-violet-300">
                        <Network className="h-3.5 w-3.5" />
                        知识网络
                      </div>
                      <Link
                        href="/knowledge-graph"
                        className="text-[11px] font-semibold text-gray-500 hover:text-sky-400"
                      >
                        完整图谱 →
                      </Link>
                    </div>
                    <div className="flex gap-2 text-[11px] text-gray-500">
                      <span className="rounded bg-gray-800/70 px-1.5 py-0.5">
                        {knowledgeGraph.stats.total_nodes} 节点
                      </span>
                      <span className="rounded bg-gray-800/70 px-1.5 py-0.5">
                        {knowledgeGraph.stats.total_edges} 关系
                      </span>
                      <span className="rounded bg-gray-800/70 px-1.5 py-0.5">
                        {knowledgeGraph.stats.related_words || 0} 词
                      </span>
                    </div>

                    {/* Nodes grouped by type */}
                    {(() => {
                      const groups: Record<string, typeof knowledgeGraph.nodes> = {};
                      const typeLabels: Record<string, string> = {
                        word: '相关词',
                        meaning: '释义',
                        definition: '定义',
                        context: '语境',
                        example: '例句',
                        article: '文章',
                        topic: '主题',
                        grammar: '语法',
                        weakness: '薄弱点',
                        review: '复习',
                      };
                      knowledgeGraph.nodes
                        .filter((n) => n.type !== 'word' || n.id !== knowledgeGraph.focus?.id)
                        .forEach((node) => {
                          if (!groups[node.type]) groups[node.type] = [];
                          if (groups[node.type].length < 5) groups[node.type].push(node);
                        });

                      return Object.entries(groups).map(([type, nodes]) => (
                        <div key={type}>
                          <div className="mb-1.5 flex items-center justify-between">
                            <span className="text-[11px] font-semibold text-gray-500">
                              {typeLabels[type] || type}
                            </span>
                            <span className="text-[10px] text-gray-600">{nodes.length}</span>
                          </div>
                          <div className="space-y-1">
                            {nodes.map((node) => (
                              <div
                                key={node.id}
                                className="rounded-md border border-gray-800 bg-gray-950/50 p-2"
                              >
                                <div className="flex items-center justify-between gap-2">
                                  <p className="min-w-0 truncate text-sm font-bold text-gray-200">
                                    {node.label}
                                  </p>
                                  {node.metadata?.slug && (
                                    <Link
                                      href={`/articles/${node.metadata.slug}`}
                                      className="shrink-0 text-[10px] text-sky-400 hover:text-sky-300"
                                    >
                                      查看 →
                                    </Link>
                                  )}
                                </div>
                                {node.description && (
                                  <p className="mt-0.5 line-clamp-2 text-xs leading-5 text-gray-500">
                                    {node.description}
                                  </p>
                                )}
                              </div>
                            ))}
                          </div>
                        </div>
                      ));
                    })()}
                  </div>
                )}
              </div>
            )}
          </section>
        </aside>
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
