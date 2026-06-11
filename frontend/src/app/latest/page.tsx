'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ArticleCard from '@/components/ArticleCard';
import { articleAPI } from '@/lib/api';
import { Article, PaginationInfo } from '@/types';
import { Loader2 } from 'lucide-react';

function LatestContent() {
  const searchParams = useSearchParams();
  const source = searchParams.get('source') || '';
  const [articles, setArticles] = useState<Article[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setPage(1);
  }, [source]);

  useEffect(() => {
    const fetchArticles = async () => {
      try {
        setLoading(true);
        const response = await articleAPI.getArticles({
          page,
          page_size: 20,
          source: source || undefined,
        });
        setArticles(response.data.data);
        setPagination(response.data.pagination || null);
      } catch (err) {
        console.error('Failed to fetch latest articles:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchArticles();
  }, [source, page]);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-black">{source ? `${source} 最新文章` : '最近更新'}</h1>
        <p className="text-gray-500">
          按发布时间浏览{source ? '这个来源的' : '全部外刊'}文章。
          {pagination && `共 ${pagination.total} 篇`}
        </p>
      </div>

      {articles.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-10 text-center text-gray-500">
          暂无文章
        </div>
      ) : (
        <>
          <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
            {articles.map((article) => (
              <ArticleCard key={article.id} article={article} />
            ))}
          </div>

          {pagination && pagination.total_page > 1 && (
            <div className="mt-10 flex items-center justify-center gap-4 text-sm text-gray-400">
              <button
                type="button"
                disabled={page <= 1}
                onClick={() => { setPage((p) => p - 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="rounded-md border border-gray-800 px-4 py-2 text-gray-200 transition-colors hover:border-gray-600 disabled:opacity-40"
              >
                上一页
              </button>
              <span>
                第 {pagination.page} / {pagination.total_page} 页
              </span>
              <button
                type="button"
                disabled={page >= pagination.total_page}
                onClick={() => { setPage((p) => p + 1); window.scrollTo({ top: 0, behavior: 'smooth' }); }}
                className="rounded-md border border-gray-800 px-4 py-2 text-gray-200 transition-colors hover:border-gray-600 disabled:opacity-40"
              >
                下一页
              </button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default function LatestPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center">
          <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
        </div>
      }
    >
      <LatestContent />
    </Suspense>
  );
}
