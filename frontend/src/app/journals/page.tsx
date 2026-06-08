'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { format } from 'date-fns';
import {
  ArrowRight,
  BookOpen,
  DownloadCloud,
  Loader2,
  RefreshCw,
  Rss,
  TriangleAlert,
} from 'lucide-react';
import ArticleCard from '@/components/ArticleCard';
import { articleAPI, rssAPI } from '@/lib/api';
import { Article, RSSFeedSummary, RSSImportReport } from '@/types';

function feedKey(feed: RSSFeedSummary) {
  return `${feed.source}:${feed.category_slug || feed.name}`;
}

function feedInitial(feed: RSSFeedSummary) {
  return (feed.category_en || feed.source || feed.name).slice(0, 2).toUpperCase();
}

export default function JournalsPage() {
  const [feeds, setFeeds] = useState<RSSFeedSummary[]>([]);
  const [articles, setArticles] = useState<Article[]>([]);
  const [selectedKey, setSelectedKey] = useState('');
  const [loadingFeeds, setLoadingFeeds] = useState(true);
  const [loadingArticles, setLoadingArticles] = useState(false);
  const [error, setError] = useState('');
  const [importing, setImporting] = useState(false);
  const [importReport, setImportReport] = useState<RSSImportReport | null>(null);

  const selectedFeed = useMemo(
    () => feeds.find((feed) => feedKey(feed) === selectedKey) || feeds[0],
    [feeds, selectedKey]
  );
  const totalArticles = feeds.reduce((sum, feed) => sum + feed.article_count, 0);

  const fetchArticles = useCallback(async (feed: RSSFeedSummary) => {
    try {
      setLoadingArticles(true);
      const response = await articleAPI.getArticles({
        page: 1,
        page_size: 12,
        source: feed.source,
        category: feed.category_slug || undefined,
      });
      setArticles(response.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || '来源文章加载失败');
    } finally {
      setLoadingArticles(false);
    }
  }, []);

  const fetchFeeds = useCallback(async () => {
    try {
      setLoadingFeeds(true);
      setError('');
      const response = await rssAPI.getFeeds();
      const data = (response.data.data || []) as RSSFeedSummary[];
      setFeeds(data);
      if (!selectedKey && data.length > 0) {
        setSelectedKey(feedKey(data[0]));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || 'RSS 来源加载失败');
    } finally {
      setLoadingFeeds(false);
    }
  }, [selectedKey]);

  useEffect(() => {
    fetchFeeds();
  }, [fetchFeeds]);

  useEffect(() => {
    if (!selectedFeed) return;
    fetchArticles(selectedFeed);
  }, [fetchArticles, selectedFeed]);

  const handleImport = async () => {
    try {
      setImporting(true);
      setImportReport(null);
      setError('');
      const response = await rssAPI.importFeeds();
      setImportReport(response.data.data);
      await fetchFeeds();
    } catch (err: any) {
      setError(err.response?.data?.error || 'RSS 导入失败');
    } finally {
      setImporting(false);
    }
  };

  if (loadingFeeds) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 border-b border-gray-800 pb-6">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300">
              <Rss className="h-4 w-4" />
              RSS 真实文章源
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100">全部外刊</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              这里展示后端 RSS 配置中的真实来源。RSS 导入后，文章会直接进入系统文章库，并出现在首页、最近更新和阅读页。
            </p>
          </div>
          <button
            type="button"
            onClick={handleImport}
            disabled={importing}
            className="inline-flex w-fit items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
          >
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
            手动导入 RSS
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-200">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {importReport && (
        <div className="mb-6 rounded-lg border border-emerald-900/60 bg-emerald-950/20 p-4 text-sm text-emerald-100">
          <div className="font-semibold">
            导入完成：新增 {importReport.created} 篇，更新 {importReport.updated} 篇，跳过 {importReport.skipped} 篇
          </div>
          {importReport.errors && importReport.errors.length > 0 && (
            <div className="mt-2 text-emerald-200/80">
              有 {importReport.errors.length} 条错误，通常是源站抓取失败或文章页面不可访问。
            </div>
          )}
        </div>
      )}

      <section className="mb-8 grid gap-3 sm:grid-cols-3">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-sm text-gray-500">RSS 来源</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{feeds.length}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-sm text-gray-500">已入库文章</p>
          <p className="mt-1 text-2xl font-bold text-gray-100">{totalArticles}</p>
        </div>
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
          <p className="text-sm text-gray-500">当前来源</p>
          <p className="mt-1 truncate text-2xl font-bold text-gray-100">
            {selectedFeed?.category_name || selectedFeed?.source || '-'}
          </p>
        </div>
      </section>

      {feeds.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-700 p-10 text-center">
          <Rss className="mx-auto mb-4 h-12 w-12 text-gray-600" />
          <h2 className="mb-2 text-xl font-bold text-gray-100">还没有配置 RSS 来源</h2>
          <p className="text-sm text-gray-500">在后端 `config.toml` 的 `[rss]` 中添加 `[[rss.feeds]]` 后，这里会显示真实来源。</p>
        </div>
      ) : (
        <div className="grid gap-8 lg:grid-cols-[360px_1fr]">
          <aside className="space-y-3">
            {feeds.map((feed) => {
              const key = feedKey(feed);
              const active = key === feedKey(selectedFeed);
              return (
                <button
                  key={key}
                  type="button"
                  onClick={() => setSelectedKey(key)}
                  className={`grid w-full grid-cols-[52px_1fr] items-center gap-4 rounded-lg border p-3 text-left transition-colors ${
                    active
                      ? 'border-blue-500 bg-blue-950/30'
                      : 'border-gray-800 bg-gray-900/40 hover:border-gray-600'
                  }`}
                >
                  <div className="flex h-[52px] w-[52px] items-center justify-center rounded-md bg-gray-950 text-sm font-black text-blue-300">
                    {feedInitial(feed)}
                  </div>
                  <div className="min-w-0">
                    <div className="flex items-center justify-between gap-3">
                      <h3 className="truncate text-base font-bold text-gray-100">
                        {feed.category_name || feed.name}
                      </h3>
                      <span className="shrink-0 rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-400">
                        {feed.article_count}
                      </span>
                    </div>
                    <p className="truncate text-sm text-gray-500">{feed.source}</p>
                    {feed.latest_published_at && (
                      <p className="mt-1 text-xs text-gray-600">
                        最新 {format(new Date(feed.latest_published_at), 'yyyy-MM-dd')}
                      </p>
                    )}
                  </div>
                </button>
              );
            })}
          </aside>

          <main>
            <div className="mb-5 flex flex-col gap-3 border-b border-gray-800 pb-4 sm:flex-row sm:items-end sm:justify-between">
              <div>
                <h2 className="text-2xl font-bold text-gray-100">
                  {selectedFeed?.category_name || selectedFeed?.name}
                </h2>
                <p className="mt-1 text-sm text-gray-500">
                  {selectedFeed?.source}
                  {selectedFeed?.category_en ? ` · ${selectedFeed.category_en}` : ''}
                </p>
              </div>
              <button
                type="button"
                onClick={() => selectedFeed && fetchArticles(selectedFeed)}
                className="inline-flex w-fit items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
              >
                <RefreshCw className="h-4 w-4" />
                刷新列表
              </button>
            </div>

            {loadingArticles ? (
              <div className="flex min-h-80 items-center justify-center">
                <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
              </div>
            ) : articles.length === 0 ? (
              <div className="rounded-lg border border-dashed border-gray-700 p-10 text-center">
                <BookOpen className="mx-auto mb-4 h-12 w-12 text-gray-600" />
                <h3 className="mb-2 text-xl font-bold text-gray-100">这个来源还没有入库文章</h3>
                <p className="mb-5 text-sm text-gray-500">点击“手动导入 RSS”，或在后端定时调用导入接口。</p>
                <button
                  type="button"
                  onClick={handleImport}
                  disabled={importing}
                  className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
                >
                  {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <DownloadCloud className="h-4 w-4" />}
                  现在导入
                </button>
              </div>
            ) : (
              <>
                <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
                  {articles.map((article) => (
                    <ArticleCard key={article.id} article={article} />
                  ))}
                </div>
                <Link
                  href={`/latest?source=${encodeURIComponent(selectedFeed?.source || '')}`}
                  className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-blue-400 hover:text-blue-300"
                >
                  查看更多最新文章
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </>
            )}
          </main>
        </div>
      )}
    </div>
  );
}
