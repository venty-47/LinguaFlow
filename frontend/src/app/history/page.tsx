'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  ArrowRight,
  BarChart3,
  BookOpen,
  CheckCircle2,
  Clock3,
  Loader2,
  RotateCcw,
  Search,
} from 'lucide-react';
import { historyAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { ReadHistory } from '@/types';

type FilterMode = 'all' | 'reading' | 'completed';

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

const difficultyStyles = {
  easy: 'border-green-500/30 bg-green-500/10 text-green-300',
  medium: 'border-yellow-500/30 bg-yellow-500/10 text-yellow-300',
  hard: 'border-red-500/30 bg-red-500/10 text-red-300',
};

function formatReadTime(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`;
  return `${Math.ceil(seconds / 60)} 分钟`;
}

export default function HistoryPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [history, setHistory] = useState<ReadHistory[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);
  const [filter, setFilter] = useState<FilterMode>('all');
  const [search, setSearch] = useState('');

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }

    const fetchHistory = async () => {
      try {
        setLoading(true);
        const response = await historyAPI.getReadHistory();
        setHistory(response.data.data || []);
      } catch (err) {
        console.error('Failed to fetch read history:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchHistory();
  }, [isAuthenticated, mounted, router, token]);

  const validHistory = useMemo(() => history.filter((item) => item.article), [history]);
  const readingCount = validHistory.filter((item) => !item.is_completed).length;
  const completedCount = validHistory.filter((item) => item.is_completed).length;
  const totalReadMinutes = Math.ceil(validHistory.reduce((sum, item) => sum + item.read_time, 0) / 60);
  const averageProgress =
    validHistory.length === 0
      ? 0
      : Math.round(validHistory.reduce((sum, item) => sum + item.read_progress, 0) / validHistory.length);

  const filteredHistory = useMemo(() => {
    const keyword = search.trim().toLowerCase();
    return validHistory
      .filter((item) => {
        if (filter === 'reading') return !item.is_completed;
        if (filter === 'completed') return item.is_completed;
        return true;
      })
      .filter((item) => {
        if (!keyword) return true;
        const article = item.article;
        return (
          article?.title.toLowerCase().includes(keyword) ||
          article?.title_cn?.toLowerCase().includes(keyword) ||
          article?.summary.toLowerCase().includes(keyword) ||
          article?.category?.name.toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => {
        if (a.is_completed !== b.is_completed) return a.is_completed ? 1 : -1;
        return new Date(b.last_read_at).getTime() - new Date(a.last_read_at).getTime();
      });
  }, [filter, search, validHistory]);

  const continueReading = filteredHistory.find((item) => !item.is_completed && item.article);

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  const stats = [
    { label: '阅读记录', value: `${validHistory.length} 篇`, icon: BookOpen },
    { label: '进行中', value: `${readingCount} 篇`, icon: RotateCcw },
    { label: '已完成', value: `${completedCount} 篇`, icon: CheckCircle2 },
    { label: '累计时长', value: `${totalReadMinutes} 分钟`, icon: Clock3 },
  ];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 border-b border-gray-800 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300">
              <BarChart3 className="h-4 w-4" />
              阅读历史
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100 md:text-4xl">
              回到未读完的文章
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              这里按未完成优先整理你的阅读记录，方便继续读、复盘已完成文章和查看学习投入。
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {continueReading?.article ? (
              <Link
                href={`/articles/${continueReading.article.slug}`}
                className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
              >
                <BookOpen className="h-4 w-4" />
                继续上次阅读
              </Link>
            ) : null}
            <Link
              href="/latest"
              className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
            >
              浏览新文章
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

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

      <section className="mb-6 rounded-lg border border-gray-800 bg-gray-900/50 p-4">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="inline-flex w-fit rounded-lg border border-gray-800 bg-gray-950/60 p-1">
            {[
              { id: 'all', label: `全部 ${validHistory.length}` },
              { id: 'reading', label: `进行中 ${readingCount}` },
              { id: 'completed', label: `已完成 ${completedCount}` },
            ].map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setFilter(item.id as FilterMode)}
                className={`rounded-md px-3 py-2 text-sm font-semibold transition-colors ${
                  filter === item.id
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:bg-gray-800 hover:text-gray-200'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
          <label className="relative block w-full lg:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="搜索标题、分类、摘要"
              className="w-full rounded-md border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-100 outline-none transition-colors placeholder:text-gray-600 focus:border-blue-500"
            />
          </label>
        </div>
        <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-800">
          <div className="h-full bg-blue-500" style={{ width: `${averageProgress}%` }} />
        </div>
        <p className="mt-2 text-xs text-gray-500">平均阅读进度 {averageProgress}%</p>
      </section>

      {validHistory.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-10 text-center">
          <BookOpen className="mx-auto mb-4 h-12 w-12 text-gray-700" />
          <p className="mb-5 text-gray-500">暂无阅读历史</p>
          <Link
            href="/latest"
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            去读第一篇
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>
      ) : filteredHistory.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-10 text-center text-gray-500">
          没有匹配的阅读记录
        </div>
      ) : (
        <div className="space-y-3">
          {filteredHistory.map((item) => {
            const article = item.article!;
            const progress = Math.min(100, Math.max(0, item.read_progress));
            return (
              <Link
                key={item.id}
                href={`/articles/${article.slug}`}
                className="block rounded-lg border border-gray-800 bg-gray-900/40 p-5 transition-colors hover:border-gray-600"
              >
                <div className="mb-3 flex flex-col gap-3 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold">
                      <span className="text-blue-300">{article.category?.name || article.source || '外刊精选'}</span>
                      <span className="text-gray-600">|</span>
                      <span className={`rounded border px-2 py-0.5 ${difficultyStyles[article.difficulty_level]}`}>
                        {difficultyLabels[article.difficulty_level]}
                      </span>
                      <span className="text-gray-600">|</span>
                      <span className="text-gray-500">{article.reading_time} 分钟</span>
                    </div>
                    <h2 className="line-clamp-2 text-xl font-bold leading-snug text-gray-100">{article.title}</h2>
                    {article.title_cn && <p className="mt-2 line-clamp-1 text-gray-400">{article.title_cn}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <span
                      className={`inline-flex items-center gap-1 rounded-md px-2.5 py-1 text-sm font-semibold ${
                        item.is_completed
                          ? 'bg-green-500/10 text-green-300'
                          : 'bg-blue-500/10 text-blue-300'
                      }`}
                    >
                      {item.is_completed ? <CheckCircle2 className="h-4 w-4" /> : <RotateCcw className="h-4 w-4" />}
                      {item.is_completed ? '已完成' : `${Math.round(progress)}%`}
                    </span>
                  </div>
                </div>

                <div className="mb-3 h-2 overflow-hidden rounded-full bg-gray-800">
                  <div
                    className={item.is_completed ? 'h-full bg-green-500' : 'h-full bg-blue-500'}
                    style={{ width: `${progress}%` }}
                  />
                </div>

                <div className="flex flex-col gap-2 text-sm text-gray-500 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span>最近阅读：{format(new Date(item.last_read_at), 'yyyy-MM-dd HH:mm')}</span>
                    <span>累计阅读：{formatReadTime(item.read_time)}</span>
                  </div>
                  <span className="inline-flex items-center gap-1 font-semibold text-blue-400">
                    {item.is_completed ? '再次阅读' : '继续阅读'}
                    <ArrowRight className="h-4 w-4" />
                  </span>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
