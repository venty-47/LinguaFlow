'use client';

import { useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { format } from 'date-fns';
import { ChevronLeft, Eye, Loader2, Timer } from 'lucide-react';
import { articleAPI, isRemoteHTTPURL, resolveAPIAssetURL, subscriptionAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Article, Subscription } from '@/types';
import FavoriteFolderSelect from '@/components/FavoriteFolderSelect';

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export default function ArticleReadPage() {
  const params = useParams();
  const router = useRouter();
  const slug = params.slug as string;
  const { isAuthenticated } = useAuthStore();

  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [readProgress, setReadProgress] = useState(0);
  const [isFavorited, setIsFavorited] = useState(false);
  const [currentFolderId, setCurrentFolderId] = useState<number | undefined>();

  const contentRef = useRef<HTMLDivElement>(null);
  const activeReadSecondsRef = useRef(0);
  const lastActiveTickRef = useRef(Date.now());
  const readProgressRef = useRef(0);
  const lastSyncedProgressRef = useRef(0);

  useEffect(() => {
    const fetchArticle = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await articleAPI.getArticleBySlug(slug);
        setArticle(response.data.data);
      } catch (err: any) {
        setError(err.response?.data?.error || '文章加载失败');
      } finally {
        setLoading(false);
      }
    };

    if (slug) fetchArticle();
  }, [slug]);

  useEffect(() => {
    if (!article || !isAuthenticated) return;

    const fetchSubscription = async () => {
      try {
        const response = await subscriptionAPI.getSubscriptions();
        const subscriptions = response.data.data as Subscription[];
        const existingSub = subscriptions.find((item) => item.article_id === article.id);
        setIsFavorited(Boolean(existingSub));
        setCurrentFolderId(existingSub?.folder_id);
      } catch (err) {
        console.error('Failed to fetch subscription:', err);
      }
    };

    fetchSubscription();
  }, [article, isAuthenticated]);

  useEffect(() => {
    const handleScroll = () => {
      if (!contentRef.current) return;

      const rect = contentRef.current.getBoundingClientRect();
      const contentTop = window.scrollY + rect.top;
      const contentHeight = contentRef.current.offsetHeight;
      const viewportBottom = window.scrollY + window.innerHeight;
      const rawProgress = ((viewportBottom - contentTop) / contentHeight) * 100;
      const nextProgress = Math.min(100, Math.max(0, rawProgress));
      readProgressRef.current = nextProgress;
      setReadProgress(nextProgress);
    };

    handleScroll();
    window.addEventListener('scroll', handleScroll, { passive: true });
    window.addEventListener('resize', handleScroll);
    return () => {
      window.removeEventListener('scroll', handleScroll);
      window.removeEventListener('resize', handleScroll);
    };
  }, [article]);

  useEffect(() => {
    if (!article || !isAuthenticated) return;

    lastActiveTickRef.current = Date.now();
    const interval = window.setInterval(() => {
      const now = Date.now();
      const elapsedSeconds = Math.min(5, Math.max(0, (now - lastActiveTickRef.current) / 1000));
      lastActiveTickRef.current = now;

      if (document.visibilityState === 'visible') {
        activeReadSecondsRef.current += elapsedSeconds;
      }
    }, 1000);

    return () => window.clearInterval(interval);
  }, [article, isAuthenticated]);

  useEffect(() => {
    const syncProgress = async () => {
      if (!article || !isAuthenticated) return;

      const currentProgress = readProgressRef.current;
      const checkpoint = currentProgress >= 96 ? 100 : Math.floor(currentProgress / 25) * 25;
      const readTime = Math.floor(activeReadSecondsRef.current);

      if (checkpoint <= 0 || readTime <= 0 || checkpoint <= lastSyncedProgressRef.current) return;

      try {
        await articleAPI.updateReadProgress(article.id, {
          progress: checkpoint,
          read_time: readTime,
        });
        lastSyncedProgressRef.current = checkpoint;
        activeReadSecondsRef.current = 0;
      } catch (err) {
        console.error('Failed to sync read progress:', err);
      }
    };

    const interval = setInterval(syncProgress, 30000);
    return () => clearInterval(interval);
  }, [article, isAuthenticated]);

  const handleFavoriteChange = (favorited: boolean, folderId?: number) => {
    setIsFavorited(favorited);
    setCurrentFolderId(favorited ? folderId : undefined);
  };

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  if (error || !article) {
    return (
      <div className="mx-auto flex min-h-screen max-w-3xl items-center justify-center px-4">
        <div className="text-center">
          <h1 className="mb-3 text-2xl font-bold">文章未找到</h1>
          <p className="mb-6 text-gray-500">{error || '该文章可能已被删除或不存在'}</p>
          <Link href="/" className="text-sky-500 hover:text-sky-400">
            返回首页
          </Link>
        </div>
      </div>
    );
  }

  const coverImageURL = article.cover_image ? resolveAPIAssetURL(article.cover_image) : '';
  const shouldBypassImageOptimizer = isRemoteHTTPURL(coverImageURL);
  const paragraphs = (article.content || '').split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);

  return (
    <>
      <div className="fixed left-0 right-0 top-16 z-40 h-1 bg-gray-800">
        <div
          className="h-full bg-red-500 transition-[width] duration-200"
          style={{ width: `${readProgress}%` }}
        />
      </div>

      <div className="mx-auto max-w-4xl px-4 py-9 sm:px-6 lg:px-8">
        <Link
          href="/"
          className="mb-8 inline-flex items-center gap-2 text-sm font-semibold text-gray-500 hover:text-gray-300"
        >
          <ChevronLeft className="h-4 w-4" />
          返回文章列表
        </Link>

        <header className="mb-8">
          <div className="mb-4 flex flex-wrap items-center gap-2 text-sm font-semibold text-red-500">
            <span>{article.source || 'MITTR'}</span>
            <span className="text-gray-600">|</span>
            <span>{article.category?.name || '外刊精选'}</span>
          </div>

          <h1 className="mb-4 text-4xl font-black leading-tight text-gray-100 md:text-5xl">
            {article.title}
          </h1>

          {article.title_cn && (
            <h2 className="mb-6 text-2xl font-bold leading-relaxed text-gray-400">
              {article.title_cn}
            </h2>
          )}

          <p className="mb-7 text-lg leading-8 text-gray-400">
            {article.summary_cn || article.summary}
          </p>

          <div className="flex flex-col gap-4 border-y border-gray-800 py-4 md:flex-row md:items-center md:justify-between">
            <div className="flex flex-wrap items-center gap-5 text-sm text-gray-500">
              <span>{format(new Date(article.published_at), 'yyyy-MM-dd')}</span>
              <span className="inline-flex items-center gap-1">
                <Timer className="h-4 w-4" />
                {article.reading_time} 分钟
              </span>
              <span>{article.word_count} 词</span>
              <span>{difficultyLabels[article.difficulty_level]}</span>
              {article.cefr_level && <span>CEFR {article.cefr_level}</span>}
              <span className="inline-flex items-center gap-1">
                <Eye className="h-4 w-4" />
                {article.view_count}
              </span>
            </div>

            <FavoriteFolderSelect
              articleId={article.id}
              isFavorited={isFavorited}
              currentFolderId={currentFolderId}
              onFavoriteChange={handleFavoriteChange}
            />
          </div>
        </header>

        {coverImageURL && (
          <div className="relative mb-10 aspect-[16/8] overflow-hidden bg-gray-900">
            <Image
              src={coverImageURL}
              alt={article.title}
              fill
              priority
              sizes="(max-width: 1024px) 100vw, 896px"
              className="object-cover"
              unoptimized={shouldBypassImageOptimizer}
            />
          </div>
        )}

        <article ref={contentRef} className="mb-12">
          <div className="space-y-6">
            {paragraphs.map((paragraph, index) => (
              <p
                key={index}
                className="whitespace-pre-wrap text-xl font-medium leading-10 text-gray-200"
              >
                {paragraph}
              </p>
            ))}
          </div>
        </article>

        <footer className="border-t border-gray-800 pt-8 text-center text-sm text-gray-500">
          <p>© {new Date().getFullYear()} GuGuDu - 英语阅读学习平台</p>
        </footer>
      </div>
    </>
  );
}
