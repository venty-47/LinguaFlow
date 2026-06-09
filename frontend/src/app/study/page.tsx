'use client';

import { FormEvent, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CalendarDays,
  CheckCircle2,
  Clock3,
  FileVideo,
  FilePenLine,
  Flame,
  Languages,
  Loader2,
  Network,
  Pencil,
  RotateCcw,
  Save,
  Sparkles,
  Target,
  TrendingDown,
  TrendingUp,
  TriangleAlert,
  X,
} from 'lucide-react';
import { articleAPI, historyAPI, studyAPI, vocabularyAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Article, ReadHistory, StudyDiagnostics, StudyToday, Vocabulary } from '@/types';

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

const practiceIcons = {
  rewrite: FilePenLine,
  imitation: Sparkles,
  cn_en: Languages,
  ai_correction: CheckCircle2,
};

function isDue(word: Vocabulary) {
  if (!word.next_review_at) return true;
  return new Date(word.next_review_at).getTime() <= Date.now();
}

function clampPercent(value: number, target: number) {
  if (target <= 0) return 100;
  return Math.min(100, Math.round((value / target) * 100));
}

export default function StudyPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [study, setStudy] = useState<StudyToday | null>(null);
  const [diagnostics, setDiagnostics] = useState<StudyDiagnostics | null>(null);
  const [history, setHistory] = useState<ReadHistory[]>([]);
  const [vocabulary, setVocabulary] = useState<Vocabulary[]>([]);
  const [recommended, setRecommended] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingGoal, setSavingGoal] = useState(false);
  const [editingGoal, setEditingGoal] = useState(false);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);
  const [goalForm, setGoalForm] = useState({
    daily_read_minutes: 20,
    daily_review_words: 10,
    daily_articles: 1,
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }

    const fetchStudyData = async () => {
      try {
        setLoading(true);
        setError('');
        const [studyResponse, diagnosticsResponse, historyResponse, vocabularyResponse, articlesResponse] =
          await Promise.all([
            studyAPI.getToday(),
            studyAPI.getDiagnostics(),
            historyAPI.getReadHistory(),
            vocabularyAPI.getVocabulary({ due: true }),
            articleAPI.getArticles({ page: 1, page_size: 6 }),
          ]);

        const nextStudy = studyResponse.data.data as StudyToday;
        setStudy(nextStudy);
        setDiagnostics(diagnosticsResponse.data.data as StudyDiagnostics);
        setGoalForm({
          daily_read_minutes: nextStudy.goal.daily_read_minutes,
          daily_review_words: nextStudy.goal.daily_review_words,
          daily_articles: nextStudy.goal.daily_articles,
        });
        setHistory(historyResponse.data.data || []);
        setVocabulary(vocabularyResponse.data.data || []);
        setRecommended(articlesResponse.data.data || []);
      } catch (err: any) {
        setError(err.response?.data?.error || '学习数据加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchStudyData();
  }, [isAuthenticated, mounted, router, token]);

  const dueWords = useMemo(() => vocabulary.filter((word) => !word.is_learned || isDue(word)), [vocabulary]);
  const continueReading = useMemo(
    () =>
      history
        .filter((item) => item.article && !item.is_completed && item.read_progress > 0)
        .sort((a, b) => new Date(b.last_read_at).getTime() - new Date(a.last_read_at).getTime())
        .slice(0, 3),
    [history]
  );

  const handleGoalSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    try {
      setSavingGoal(true);
      const response = await studyAPI.updateGoal(goalForm);
      const nextStudy = response.data.data as StudyToday;
      setStudy(nextStudy);
      setGoalForm({
        daily_read_minutes: nextStudy.goal.daily_read_minutes,
        daily_review_words: nextStudy.goal.daily_review_words,
        daily_articles: nextStudy.goal.daily_articles,
      });
      setEditingGoal(false);
    } catch (err: any) {
      setError(err.response?.data?.error || '目标保存失败');
    } finally {
      setSavingGoal(false);
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error && !study) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6">
          <h1 className="mb-2 text-2xl font-bold">无法加载每日学习</h1>
          <p className="mb-6 text-sm text-red-200">{error}</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400"
          >
            重新加载
          </button>
        </div>
      </div>
    );
  }

  if (!study) return null;

  const goalItems = [
    {
      label: '阅读时间',
      value: study.progress.read_minutes,
      target: study.goal.daily_read_minutes,
      unit: '分钟',
      icon: Clock3,
      href: continueReading[0]?.article?.slug ? `/articles/${continueReading[0].article.slug}` : '/latest',
      action: '去阅读',
    },
    {
      label: '复习单词',
      value: study.progress.reviewed_words,
      target: study.goal.daily_review_words,
      unit: '个',
      icon: RotateCcw,
      href: '/vocabulary?mode=review',
      action: '去复习',
    },
    {
      label: '完成文章',
      value: study.progress.completed_articles,
      target: study.goal.daily_articles,
      unit: '篇',
      icon: BookOpen,
      href: continueReading[0]?.article?.slug ? `/articles/${continueReading[0].article.slug}` : '/latest',
      action: '继续读',
    },
  ];

  const stats = [
    {
      label: '今日进度',
      value: `${study.completion}%`,
      icon: Target,
    },
    {
      label: '连续完成',
      value: `${study.streak} 天`,
      icon: Flame,
    },
    {
      label: '今日复习',
      value: `${study.progress.reviewed_words}/${study.goal.daily_review_words} 个`,
      icon: RotateCcw,
    },
    {
      label: '今日阅读',
      value: `${study.progress.read_minutes}/${study.goal.daily_read_minutes} 分钟`,
      icon: BarChart3,
    },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 border-b border-gray-800 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300">
              <Target className="h-4 w-4" />
              每日学习
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100 md:text-4xl">
              {study.is_completed ? '今日目标已完成' : '完成今天的三项学习目标'}
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              目标会根据阅读、复习和完成文章自动推进。连续天数只统计三项目标都完成的日期。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Link
              href="/vocabulary?mode=review"
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
            >
              <RotateCcw className="h-4 w-4" />
              开始复习
            </Link>
            <Link
              href="/knowledge-graph"
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              <Network className="h-4 w-4" />
              查看图谱
            </Link>
            <Link
              href="/study/videos"
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              <FileVideo className="h-4 w-4" />
              视频学习
            </Link>
            <Link
              href={continueReading[0]?.article?.slug ? `/articles/${continueReading[0].article.slug}` : '/latest'}
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              <BookOpen className="h-4 w-4" />
              继续阅读
            </Link>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <section className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
              <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-blue-300">
                <Icon className="h-4 w-4" />
              </div>
              <p className="text-sm text-gray-500">{item.label}</p>
              <p className="mt-1 text-2xl font-bold text-gray-100">{item.value}</p>
            </div>
          );
        })}
      </section>

      <section className="mb-8 grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
          <div className="mb-5 flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-100">今日目标</h2>
              <p className="mt-1 text-sm text-gray-500">
                {study.is_completed ? '三项目标都已完成。' : `还差 ${Math.max(0, 100 - study.completion)}% 完成今日闭环。`}
              </p>
            </div>
            <button
              type="button"
              onClick={() => setEditingGoal((value) => !value)}
              className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              {editingGoal ? <X className="h-4 w-4" /> : <Pencil className="h-4 w-4" />}
              {editingGoal ? '取消' : '调整目标'}
            </button>
          </div>

          {editingGoal ? (
            <form onSubmit={handleGoalSubmit} className="grid gap-3 md:grid-cols-[1fr_1fr_1fr_auto] md:items-end">
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-gray-400">阅读分钟</span>
                <input
                  type="number"
                  min={1}
                  max={240}
                  value={goalForm.daily_read_minutes}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, daily_read_minutes: Number(event.target.value) }))
                  }
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-gray-400">复习单词</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  value={goalForm.daily_review_words}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, daily_review_words: Number(event.target.value) }))
                  }
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
                />
              </label>
              <label className="block">
                <span className="mb-2 block text-sm font-semibold text-gray-400">完成文章</span>
                <input
                  type="number"
                  min={1}
                  max={20}
                  value={goalForm.daily_articles}
                  onChange={(event) =>
                    setGoalForm((prev) => ({ ...prev, daily_articles: Number(event.target.value) }))
                  }
                  className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
                />
              </label>
              <button
                type="submit"
                disabled={savingGoal}
                className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
              >
                {savingGoal ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                保存
              </button>
            </form>
          ) : (
            <div className="grid gap-3 md:grid-cols-3">
              {goalItems.map((item) => {
                const Icon = item.icon;
                const percent = clampPercent(item.value, item.target);
                const done = item.value >= item.target;
                return (
                  <div key={item.label} className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <div className="flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-blue-300">
                          <Icon className="h-4 w-4" />
                        </div>
                        <div>
                          <h3 className="font-bold text-gray-100">{item.label}</h3>
                          <p className="text-xs text-gray-500">
                            {item.value}/{item.target} {item.unit}
                          </p>
                        </div>
                      </div>
                      {done && <CheckCircle2 className="h-5 w-5 text-green-400" />}
                    </div>
                    <div className="mb-4 h-2 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full bg-blue-500" style={{ width: `${percent}%` }} />
                    </div>
                    <Link href={item.href} className="inline-flex items-center gap-1 text-sm font-semibold text-blue-400 hover:text-blue-300">
                      {item.action}
                      <ArrowRight className="h-4 w-4" />
                    </Link>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
          <div className="mb-4 flex items-center justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-100">学习日历</h2>
              <p className="mt-1 text-sm text-gray-500">最近 35 天</p>
            </div>
            <CalendarDays className="h-6 w-6 text-blue-300" />
          </div>
          <div className="grid grid-cols-7 gap-2">
            {study.calendar.map((record) => {
              const active = record.read_seconds > 0 || record.reviewed_words > 0 || record.completed_articles > 0;
              return (
                <div
                  key={record.date}
                  title={`${record.date} · 阅读 ${Math.ceil(record.read_seconds / 60)} 分钟 · 复习 ${record.reviewed_words} 个 · 完成 ${record.completed_articles} 篇`}
                  className={`aspect-square rounded-md border ${
                    record.is_completed
                      ? 'border-green-500/50 bg-green-500/40'
                      : active
                        ? 'border-blue-500/40 bg-blue-500/20'
                        : 'border-gray-800 bg-gray-950'
                  }`}
                />
              );
            })}
          </div>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs text-gray-500">
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-gray-950 ring-1 ring-gray-800" />
              未学习
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-blue-500/20 ring-1 ring-blue-500/40" />
              有学习
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-3 w-3 rounded-sm bg-green-500/40 ring-1 ring-green-500/50" />
              已完成
            </span>
          </div>
        </div>
      </section>

      {diagnostics && (
        <section className="mb-8 rounded-lg border border-gray-800 bg-gray-900/50 p-5">
          <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <h2 className="text-xl font-bold text-gray-100">学习诊断</h2>
              <p className="mt-1 text-sm text-gray-500">
                本周从 {diagnostics.week_start} 起，统计掌握率、阅读质量和输出练习入口。
              </p>
            </div>
            <Link
              href="/vocabulary?mode=review&weak=true"
              className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              <TriangleAlert className="h-4 w-4" />
              复习薄弱词
            </Link>
          </div>

          <div className="mb-5 grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-400">本周新词掌握率</span>
                <Target className="h-4 w-4 text-blue-300" />
              </div>
              <p className="text-3xl font-black text-gray-100">{diagnostics.new_word_mastery.mastery_pct}%</p>
              <p className="mt-2 text-sm text-gray-500">
                {diagnostics.new_word_mastery.mastered}/{diagnostics.new_word_mastery.total} 个新词已掌握
              </p>
              <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-800">
                <div
                  className="h-full bg-blue-500"
                  style={{ width: `${diagnostics.new_word_mastery.mastery_pct}%` }}
                />
              </div>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-400">阅读速度变化</span>
                {diagnostics.reading_speed_trend.change_pct >= 0 ? (
                  <TrendingUp className="h-4 w-4 text-green-300" />
                ) : (
                  <TrendingDown className="h-4 w-4 text-amber-300" />
                )}
              </div>
              <p className="text-3xl font-black text-gray-100">
                {diagnostics.reading_speed_trend.current_wpm || '--'}
                <span className="ml-1 text-base font-semibold text-gray-500">WPM</span>
              </p>
              <p className={`mt-2 text-sm ${
                diagnostics.reading_speed_trend.change_pct >= 0 ? 'text-green-300' : 'text-amber-300'
              }`}>
                较上周 {diagnostics.reading_speed_trend.change_pct >= 0 ? '+' : ''}
                {diagnostics.reading_speed_trend.change_pct}%
              </p>
              <p className="mt-1 text-xs text-gray-500">
                本周 {diagnostics.reading_speed_trend.current_articles} 篇，上周 {diagnostics.reading_speed_trend.previous_articles} 篇
              </p>
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4 md:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <span className="text-sm font-semibold text-gray-400">不同难度文章完成率</span>
                <BarChart3 className="h-4 w-4 text-blue-300" />
              </div>
              <div className="space-y-3">
                {diagnostics.difficulty_completions.map((item) => (
                  <div key={item.difficulty}>
                    <div className="mb-1 flex items-center justify-between text-sm">
                      <span className="font-semibold text-gray-300">{difficultyLabels[item.difficulty]}</span>
                      <span className="text-gray-500">
                        {item.completed}/{item.total} · {item.rate_pct}%
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full bg-green-500" style={{ width: `${item.rate_pct}%` }} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>

          <div className="grid gap-4 lg:grid-cols-[1fr_1fr]">
            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-gray-100">遗忘最多的词</h3>
                <RotateCcw className="h-4 w-4 text-amber-300" />
              </div>
              {diagnostics.most_forgotten_words.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-700 p-4 text-sm text-gray-500">
                  暂无反复遗忘记录。继续复习后这里会显示薄弱词。
                </p>
              ) : (
                <div className="space-y-2">
                  {diagnostics.most_forgotten_words.map((word) => (
                    <Link
                      key={word.id}
                      href="/vocabulary?mode=review&weak=true"
                      className="flex items-start justify-between gap-3 rounded-md border border-gray-800 p-3 transition-colors hover:border-gray-600"
                    >
                      <div>
                        <p className="font-bold text-gray-100">{word.word}</p>
                        <p className="mt-1 line-clamp-1 text-sm text-gray-500">
                          {word.translation || word.context || '暂无释义'}
                        </p>
                      </div>
                      <span className="shrink-0 rounded border border-amber-700/70 px-2 py-1 text-xs font-semibold text-amber-300">
                        忘记 {word.forgotten_count}
                      </span>
                    </Link>
                  ))}
                </div>
              )}
            </div>

            <div className="rounded-lg border border-gray-800 bg-gray-950/50 p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-bold text-gray-100">高频薄弱语法点</h3>
                <Languages className="h-4 w-4 text-blue-300" />
              </div>
              {diagnostics.weak_grammar_points.length === 0 ? (
                <p className="rounded-md border border-dashed border-gray-700 p-4 text-sm text-gray-500">
                  暂无足够上下文。多查词、复习和完成文章后会生成语法倾向。
                </p>
              ) : (
                <div className="space-y-3">
                  {diagnostics.weak_grammar_points.map((point) => (
                    <div key={point.name} className="rounded-md border border-gray-800 p-3">
                      <div className="mb-1 flex items-center justify-between gap-3">
                        <p className="font-semibold text-gray-100">{point.name}</p>
                        <span className="text-xs text-gray-500">{point.count} 次</span>
                      </div>
                      <p className="text-sm leading-6 text-gray-500">{point.description}</p>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="mt-4">
            <h3 className="mb-3 font-bold text-gray-100">输出练习</h3>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              {diagnostics.practice_actions.map((action) => {
                const Icon = practiceIcons[action.type];
                return (
                  <Link
                    key={action.type}
                    href={action.href}
                    className="rounded-lg border border-gray-800 bg-gray-950/50 p-4 transition-colors hover:border-blue-700 hover:bg-blue-950/20"
                  >
                    <div className="mb-3 flex h-9 w-9 items-center justify-center rounded-md bg-gray-800 text-blue-300">
                      <Icon className="h-4 w-4" />
                    </div>
                    <p className="font-bold text-gray-100">{action.title}</p>
                    <p className="mt-2 text-sm leading-6 text-gray-500">{action.description}</p>
                  </Link>
                );
              })}
            </div>
          </div>
        </section>
      )}

      <section className="grid gap-6 lg:grid-cols-[1fr_0.9fr]">
        <div className="space-y-6">
          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-100">继续阅读</h2>
                <p className="mt-1 text-sm text-gray-500">接着上次停下的位置读完文章。</p>
              </div>
              <Link href="/history" className="text-sm font-semibold text-blue-400 hover:text-blue-300">
                阅读历史
              </Link>
            </div>

            {continueReading.length === 0 ? (
              <div className="rounded-md border border-dashed border-gray-700 p-6 text-sm text-gray-500">
                暂无未读完的文章，可以从推荐文章开始。
              </div>
            ) : (
              <div className="space-y-3">
                {continueReading.map((item) => (
                  <Link
                    key={item.id}
                    href={`/articles/${item.article?.slug}`}
                    className="block rounded-md border border-gray-800 bg-gray-950/50 p-4 transition-colors hover:border-gray-600"
                  >
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                      <span>{item.article?.category?.name || '外刊精选'}</span>
                      <span>|</span>
                      <span>{Math.round(item.read_progress)}% 已读</span>
                      <span>|</span>
                      <span>{format(new Date(item.last_read_at), 'yyyy-MM-dd')}</span>
                    </div>
                    <h3 className="mb-3 text-lg font-bold text-gray-100">{item.article?.title}</h3>
                    <div className="h-1.5 overflow-hidden rounded-full bg-gray-800">
                      <div className="h-full bg-blue-500" style={{ width: `${Math.min(100, item.read_progress)}%` }} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-gray-100">推荐新文章</h2>
                <p className="mt-1 text-sm text-gray-500">完成复习后，选择一篇开始今天的阅读。</p>
              </div>
              <Link href="/latest" className="text-sm font-semibold text-blue-400 hover:text-blue-300">
                更多文章
              </Link>
            </div>
            <div className="grid gap-3 md:grid-cols-2">
              {recommended.slice(0, 4).map((article) => (
                <Link
                  key={article.id}
                  href={`/articles/${article.slug}`}
                  className="group rounded-md border border-gray-800 bg-gray-950/50 p-4 transition-colors hover:border-gray-600"
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-red-400">
                    <span>{article.source || 'MITTR'}</span>
                    <span className="text-gray-600">|</span>
                    <span>{difficultyLabels[article.difficulty_level]}</span>
                    <span className="text-gray-600">|</span>
                    <span>{article.reading_time} 分钟</span>
                  </div>
                  <h3 className="line-clamp-2 text-base font-bold leading-snug text-gray-100 group-hover:text-white">
                    {article.title}
                  </h3>
                  <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-500">
                    {article.summary_cn || article.summary}
                  </p>
                </Link>
              ))}
            </div>
          </div>
        </div>

        <aside className="space-y-6">
          <div className="rounded-lg border border-blue-900/60 bg-blue-950/20 p-5">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-xl font-bold text-blue-100">今日待复习</h2>
                <p className="mt-1 text-sm text-blue-200/70">{dueWords.length} 个单词需要处理</p>
              </div>
              <RotateCcw className="h-6 w-6 text-blue-300" />
            </div>

            {dueWords.length === 0 ? (
              <div className="rounded-md border border-blue-900/60 p-4 text-sm text-blue-200/70">
                今日复习已清空，可以开始新文章。
              </div>
            ) : (
              <>
                <div className="mb-4 flex flex-wrap gap-2">
                  {dueWords.slice(0, 12).map((word) => (
                    <span key={word.id} className="rounded border border-blue-800/70 px-2 py-1 text-sm text-blue-100">
                      {word.word}
                    </span>
                  ))}
                </div>
                <Link
                  href="/vocabulary?mode=review"
                  className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-500 px-4 py-2 text-sm font-semibold text-blue-950 hover:bg-blue-400"
                >
                  进入卡片复习
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </div>

          <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
            <div className="mb-4 flex items-center gap-2">
              <Sparkles className="h-5 w-5 text-amber-300" />
              <h2 className="text-xl font-bold text-gray-100">今天的学习顺序</h2>
            </div>
            <div className="space-y-3 text-sm text-gray-400">
              <div className="rounded-md bg-gray-950/50 p-3">
                1. 先完成待复习单词，避免旧词遗忘。
              </div>
              <div className="rounded-md bg-gray-950/50 p-3">
                2. 继续读未完成文章，让阅读时间和文章目标一起推进。
              </div>
              <div className="rounded-md bg-gray-950/50 p-3">
                3. 三项目标完成后，今日连续学习才会计入 streak。
              </div>
            </div>
          </div>
        </aside>
      </section>
    </div>
  );
}
