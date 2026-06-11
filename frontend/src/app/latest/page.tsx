'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';
import ArticleCard from '@/components/ArticleCard';
import { articleAPI } from '@/lib/api';
import { Article } from '@/types';
import { Loader2 } from 'lucide-react';

function LatestContent() {
  const searchParams = useSearchParams();
  const source = searchParams.get('source') || '';
  const [articles, setArticles] = useState<Article[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticles = async () => {
      try {
        setLoading(true);
        const response = await articleAPI.getArticles({
          page: 1,
          page_size: 30,
          source: source || undefined,
        });
        setArticles(response.data.data);
      } catch (err) {
        console.error('Failed to fetch latest articles:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchArticles();
  }, [source]);

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
        <p className="text-gray-500">按发布时间浏览{source ? '这个来源的' : '全部外刊'}文章。</p>
      </div>

      {articles.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-10 text-center text-gray-500">
          暂无文章
        </div>
      ) : (
        <div className="columns-1 sm:columns-2 lg:columns-3 xl:columns-4 gap-6 space-y-6">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
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
