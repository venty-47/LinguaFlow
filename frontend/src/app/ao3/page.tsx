'use client';

import { FormEvent, Suspense, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { AlertTriangle, ArrowLeft, ArrowRight, ExternalLink, Loader2, Search } from 'lucide-react';
import { formatAO3Chapters } from '@/lib/ao3';
import { ao3API } from '@/lib/api';
import { AO3SearchResponse, AO3WorkSummary } from '@/types';

function joined(values: string[], fallback = '-') {
  return values && values.length > 0 ? values.join(', ') : fallback;
}

function stat(value: string, label: string) {
  return value ? `${label} ${value}` : '';
}

function tagSlice(work: AO3WorkSummary) {
  return [...work.fandoms, ...work.relationships, ...work.characters, ...work.tags].slice(0, 10);
}

function AO3SearchContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const query = searchParams.get('q') || '';
  const page = Math.max(1, Number(searchParams.get('page') || '1'));
  const [input, setInput] = useState(query);
  const [result, setResult] = useState<AO3SearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const works = useMemo(() => result?.works || [], [result]);
  const canGoBack = page > 1;
  const stats = useMemo(
    () =>
      works.map((work) =>
        [stat(work.words, '词数'), formatAO3Chapters(work.chapters), stat(work.kudos, 'Kudos'), stat(work.hits, '点击')].filter(Boolean)
      ),
    [works]
  );

  useEffect(() => {
    setInput(query);
    if (!query.trim()) {
      setResult(null);
      setError('');
      setLoading(false);
      return;
    }

    let cancelled = false;
    const fetchWorks = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await ao3API.search({ q: query, page });
        if (!cancelled) {
          setResult(response.data.data);
        }
      } catch (err: any) {
        if (!cancelled) {
          setResult(null);
          setError(err.response?.data?.error || 'AO3 搜索暂时不可用');
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    fetchWorks();
    return () => {
      cancelled = true;
    };
  }, [query, page]);

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const nextQuery = input.trim();
    if (!nextQuery) return;
    router.push(`/ao3?q=${encodeURIComponent(nextQuery)}`);
  };

  const goToPage = (nextPage: number) => {
    router.push(`/ao3?q=${encodeURIComponent(query)}&page=${nextPage}`);
  };

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <header className="mb-8 border-b border-gray-200 pb-6 dark:border-gray-800">
        <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-3 py-1 text-sm font-semibold text-emerald-700 dark:text-emerald-300">
          <Search className="h-4 w-4" />
          AO3 同人搜索
        </div>
        <h1 className="text-3xl font-black tracking-tight text-gray-950 dark:text-gray-100">搜索 AO3 公开作品</h1>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-600 dark:text-gray-500">
          这里通过后端解析 AO3 公开 HTML 页面展示结果。站内阅读仅用于公开页面预览，原文、评论、收藏和作者互动请回到 AO3。
        </p>
      </header>

      <form onSubmit={handleSubmit} className="mb-6 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-gray-400" />
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="例如 Neuro-sama、Evil Neuro、Vedal987"
            className="h-12 w-full rounded-md border border-gray-300 bg-white pl-10 pr-4 text-sm text-gray-950 outline-none transition-colors focus:border-emerald-500 dark:border-gray-800 dark:bg-gray-950 dark:text-gray-100"
          />
        </div>
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="inline-flex h-12 items-center justify-center gap-2 rounded-md bg-gray-950 px-5 text-sm font-bold text-white transition-colors hover:bg-gray-800 disabled:opacity-50 dark:bg-gray-100 dark:text-gray-950 dark:hover:bg-white"
        >
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Search className="h-4 w-4" />}
          搜索
        </button>
      </form>

      {error && (
        <div className="mb-6 flex items-start gap-3 rounded-lg border border-red-500/40 bg-red-500/10 p-4 text-sm text-red-700 dark:text-red-200">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {!query && (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
          <Search className="mx-auto mb-4 h-12 w-12 text-gray-400" />
          <h2 className="mb-2 text-xl font-bold text-gray-950 dark:text-gray-100">输入关键词开始搜索</h2>
          <p className="text-sm text-gray-500">可以搜作品名、角色、作者、fandom 或普通关键词。</p>
        </div>
      )}

      {loading && (
        <div className="flex min-h-[320px] items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      )}

      {!loading && query && works.length === 0 && !error && (
        <div className="rounded-lg border border-gray-200 p-10 text-center text-gray-500 dark:border-gray-800">
          没有找到匹配的公开作品
        </div>
      )}

      {!loading && works.length > 0 && (
        <>
          <div className="mb-4 flex items-center justify-between gap-3">
            <p className="text-sm text-gray-500">
              “{result?.query}” 第 {result?.page} 页，当前显示 {works.length} 篇
            </p>
            {result?.source_url && (
              <a
                href={result.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-sm font-semibold text-emerald-700 hover:text-emerald-600 dark:text-emerald-300"
              >
                AO3 搜索页
                <ExternalLink className="h-4 w-4" />
              </a>
            )}
          </div>

          <div className="space-y-4">
            {works.map((work, index) => (
              <article
                key={work.id}
                className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-gray-950"
              >
                <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                  <div className="min-w-0 flex-1">
                    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500">
                      {work.rating && <span className="rounded border border-gray-300 px-2 py-0.5 dark:border-gray-700">{work.rating}</span>}
                      {work.language && <span>{work.language}</span>}
                      {work.updated_at && <span>更新 {work.updated_at}</span>}
                    </div>
                    <h2 className="text-xl font-black leading-snug text-gray-950 dark:text-gray-100">
                      <Link href={`/ao3/works/${work.id}`} className="hover:text-emerald-700 dark:hover:text-emerald-300">
                        {work.title}
                      </Link>
                    </h2>
                    <p className="mt-1 text-sm text-gray-500">by {joined(work.authors, 'Anonymous')}</p>
                    {work.summary && (
                      <p className="mt-4 line-clamp-4 text-sm leading-6 text-gray-700 dark:text-gray-300">{work.summary}</p>
                    )}
                    <div className="mt-4 flex flex-wrap gap-2">
                      {tagSlice(work).map((tag) => (
                        <span
                          key={`${work.id}:${tag}`}
                          className="rounded border border-gray-200 px-2 py-1 text-xs text-gray-600 dark:border-gray-800 dark:text-gray-400"
                        >
                          {tag}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className="w-full shrink-0 space-y-3 lg:w-56">
                    <div className="grid grid-cols-2 gap-2 text-xs text-gray-500">
                      {stats[index].map((item) => (
                        <span key={item} className="rounded-md bg-gray-100 px-2 py-1 dark:bg-gray-900">
                          {item}
                        </span>
                      ))}
                    </div>
                    <div className="flex gap-2">
                      <Link
                        href={`/ao3/works/${work.id}`}
                        className="inline-flex flex-1 items-center justify-center gap-1 rounded-md bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-500"
                      >
                        站内阅读
                        <ArrowRight className="h-4 w-4" />
                      </Link>
                      <a
                        href={work.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center justify-center rounded-md border border-gray-300 px-3 py-2 text-gray-700 hover:bg-gray-100 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
                        aria-label="在 AO3 打开"
                      >
                        <ExternalLink className="h-4 w-4" />
                      </a>
                    </div>
                  </div>
                </div>
              </article>
            ))}
          </div>

          <div className="mt-8 flex items-center justify-between">
            <button
              type="button"
              onClick={() => goToPage(page - 1)}
              disabled={!canGoBack}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-700"
            >
              <ArrowLeft className="h-4 w-4" />
              上一页
            </button>
            <button
              type="button"
              onClick={() => goToPage(page + 1)}
              disabled={!result?.has_next}
              className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm font-semibold disabled:opacity-40 dark:border-gray-700"
            >
              下一页
              <ArrowRight className="h-4 w-4" />
            </button>
          </div>
        </>
      )}
    </div>
  );
}

export default function AO3Page() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-emerald-600" />
        </div>
      }
    >
      <AO3SearchContent />
    </Suspense>
  );
}
