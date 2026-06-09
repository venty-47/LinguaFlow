'use client';

import { useEffect, useMemo, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { ArrowRight, BookOpen, Clock, Loader2, Search, Sparkles, Tags } from 'lucide-react';
import { articleAPI, isRemoteHTTPURL, resolveAPIAssetURL } from '@/lib/api';
import { Article } from '@/types';

const fallbackArticles: Article[] = [
  {
    id: -1,
    title: 'How virtual power plants could provide energy for data centers',
    title_cn: '虚拟电厂如何为数据中心提供能源',
    slug: 'virtual-power-plants-data-centers',
    summary: 'New grid software can coordinate batteries, buildings, and backup power into flexible clean-energy capacity.',
    category_id: 1,
    category: { id: 1, name: 'Climate change and energy', slug: 'climate-energy', sort_order: 1, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-06-03',
    difficulty_level: 'medium',
    word_count: 917,
    reading_time: 6,
    view_count: 0,
    status: 'published',
    is_featured: true,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1621905251918-48416bd8575a?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -2,
    title: 'How small businesses can leverage AI',
    title_cn: '小企业如何利用人工智能',
    slug: 'small-businesses-leverage-ai',
    summary: 'Practical AI tools are changing support, operations, and customer research for smaller teams.',
    category_id: 2,
    category: { id: 2, name: 'Artificial intelligence', slug: 'ai', sort_order: 2, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-06-02',
    difficulty_level: 'medium',
    word_count: 859,
    reading_time: 5,
    view_count: 0,
    status: 'published',
    is_featured: true,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1677442136019-21780ecad995?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -3,
    title: 'China has approved the world’s first invasive brain-computer chip',
    title_cn: '中国批准全球首个侵入性脑机接口芯片',
    slug: 'brain-computer-chip-approved',
    summary: 'A clinical milestone opens a new phase for neurotechnology and medical devices.',
    category_id: 3,
    category: { id: 3, name: 'Biotechnology and health', slug: 'biotech-health', sort_order: 3, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-06-01',
    difficulty_level: 'hard',
    word_count: 1384,
    reading_time: 8,
    view_count: 0,
    status: 'published',
    is_featured: true,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1559757175-0eb30cd8c063?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -4,
    title: 'The deadly Ebola outbreak is proving difficult to control',
    title_cn: '致命的埃博拉疫情难以控制',
    slug: 'ebola-outbreak-control',
    summary: 'Public health teams face a familiar set of barriers in tracing, treatment, and trust.',
    category_id: 3,
    category: { id: 3, name: 'Biotechnology and health', slug: 'biotech-health', sort_order: 3, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-29',
    difficulty_level: 'hard',
    word_count: 1022,
    reading_time: 6,
    view_count: 0,
    status: 'published',
    is_featured: true,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1584036561566-baf8f5f1b144?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -5,
    title: 'How the Pope’s Magnifica Humanitas offers a template for the AI moment',
    title_cn: '教宗的《辉煌人性》为个人应对人工智能时代提供了模板',
    slug: 'pope-ai-humanitas',
    summary: 'A human-centered text becomes a useful reference for technology ethics.',
    category_id: 2,
    category: { id: 2, name: 'Artificial intelligence', slug: 'ai', sort_order: 2, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-29',
    difficulty_level: 'hard',
    word_count: 1032,
    reading_time: 7,
    view_count: 0,
    status: 'published',
    is_featured: true,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1495562569060-2eec283d3391?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -6,
    title: 'How a new extraction process could unlock the world’s lithium',
    title_cn: '新提炼技术或将开启全球锂资源新局面',
    slug: 'lithium-extraction-process',
    summary: 'Mining startups are testing cleaner routes to a crucial battery material.',
    category_id: 1,
    category: { id: 1, name: 'Climate change and energy', slug: 'climate-energy', sort_order: 1, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-28',
    difficulty_level: 'hard',
    word_count: 1130,
    reading_time: 7,
    view_count: 0,
    status: 'published',
    is_featured: false,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1500530855697-b586d89ba3ee?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -7,
    title: 'Climate tech companies are going public. What’s next?',
    title_cn: '气候科技公司纷纷上市，下一步是什么？',
    slug: 'climate-tech-going-public',
    summary: 'Investors are asking whether climate infrastructure can scale with public-market pressure.',
    category_id: 1,
    category: { id: 1, name: 'Climate change and energy', slug: 'climate-energy', sort_order: 1, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-28',
    difficulty_level: 'medium',
    word_count: 935,
    reading_time: 5,
    view_count: 0,
    status: 'published',
    is_featured: false,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1509391366360-2e959784a276?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -8,
    title: 'The AI Hype Index: AI gets booed in graduation season',
    title_cn: '人工智能热度指数：毕业季，人工智能遭遇嘘声',
    slug: 'ai-hype-index-graduation-season',
    summary: 'Campus debates show a widening gap between AI marketing and public trust.',
    category_id: 2,
    category: { id: 2, name: 'Artificial intelligence', slug: 'ai', sort_order: 2, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-28',
    difficulty_level: 'easy',
    word_count: 160,
    reading_time: 2,
    view_count: 0,
    status: 'published',
    is_featured: false,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1519389950473-47ba0277781c?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -9,
    title: 'It’s time to address the looming crisis in entry-level work.',
    title_cn: '是时候正视入门级工作面临的迫在眉睫的危机了',
    slug: 'entry-level-work-crisis',
    summary: 'Automation is reshaping the first rung of white-collar careers faster than institutions can respond.',
    category_id: 2,
    category: { id: 2, name: 'Artificial intelligence', slug: 'ai', sort_order: 2, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-26',
    difficulty_level: 'hard',
    word_count: 1199,
    reading_time: 7,
    view_count: 0,
    status: 'published',
    is_featured: false,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1497366754035-f200968a6e72?auto=format&fit=crop&w=900&q=80',
  },
  {
    id: -10,
    title: 'A reality check on the AI jobs hysteria',
    title_cn: '对AI就业恐慌的现实审视',
    slug: 'ai-jobs-hysteria-reality-check',
    summary: 'The data suggests disruption is real, but the labor story is more complicated than headlines imply.',
    category_id: 2,
    category: { id: 2, name: 'Artificial intelligence', slug: 'ai', sort_order: 2, created_at: '', updated_at: '' },
    source: 'MITTR',
    published_at: '2026-05-26',
    difficulty_level: 'hard',
    word_count: 3153,
    reading_time: 14,
    view_count: 0,
    status: 'published',
    is_featured: false,
    created_at: '',
    updated_at: '',
    content: '',
    cover_image: 'https://images.unsplash.com/photo-1531482615713-2afd69097998?auto=format&fit=crop&w=900&q=80',
  },
];

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

const difficultyStyles = {
  easy: 'bg-emerald-50 text-emerald-700 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20',
  medium: 'bg-amber-50 text-amber-700 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-300 dark:ring-amber-500/20',
  hard: 'bg-rose-50 text-rose-700 ring-rose-200 dark:bg-rose-500/10 dark:text-rose-300 dark:ring-rose-500/20',
};

function articleHref(article: Article) {
  return article.id < 0 ? '/journals' : `/articles/${article.slug}`;
}

function ArticleRow({ article, featured = false }: { article: Article; featured?: boolean }) {
  const coverImageURL = article.cover_image ? resolveAPIAssetURL(article.cover_image) : '';
  const shouldBypassImageOptimizer = isRemoteHTTPURL(coverImageURL);

  return (
    <Link
      href={articleHref(article)}
      className="group grid gap-4 border-b border-gray-200 py-5 transition-colors last:border-b-0 hover:border-gray-300 dark:border-gray-800 dark:hover:border-gray-700 sm:grid-cols-[116px_1fr]"
    >
      <div className="relative aspect-[4/3] overflow-hidden rounded-md bg-gray-100 dark:bg-gray-900">
        {coverImageURL ? (
          <Image
            src={coverImageURL}
            alt={article.title}
            fill
            sizes="120px"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
            unoptimized={shouldBypassImageOptimizer}
          />
        ) : (
          <BookOpen className="absolute left-1/2 top-1/2 h-8 w-8 -translate-x-1/2 -translate-y-1/2 text-gray-400" />
        )}
      </div>

      <div className="min-w-0">
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs font-semibold text-gray-500 dark:text-gray-400">
          <span>{article.source || 'MITTR'}</span>
          {article.category?.name && <span>{article.category.name}</span>}
          <span className={`rounded px-2 py-0.5 ring-1 ${difficultyStyles[article.difficulty_level]}`}>
            {difficultyLabels[article.difficulty_level]}
          </span>
          {featured && <span className="text-blue-700 dark:text-blue-300">推荐</span>}
        </div>
        <h3 className="line-clamp-2 text-lg font-bold leading-snug text-gray-950 transition-colors group-hover:text-blue-700 dark:text-gray-100 dark:group-hover:text-blue-300">
          {article.title}
        </h3>
        {article.title_cn && <p className="mt-1 line-clamp-1 text-sm font-medium text-gray-600 dark:text-gray-400">{article.title_cn}</p>}
        {article.summary && <p className="mt-2 line-clamp-2 text-sm leading-6 text-gray-600 dark:text-gray-400">{article.summary}</p>}
        <div className="mt-3 flex flex-wrap items-center gap-3 text-xs text-gray-500">
          <span>{article.published_at}</span>
          <span>{article.word_count} 词</span>
          <span>{article.reading_time} 分钟</span>
        </div>
      </div>
    </Link>
  );
}

export default function Home() {
  const [articles, setArticles] = useState<Article[]>(fallbackArticles);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const fetchArticles = async () => {
      try {
        setLoading(true);
        const response = await articleAPI.getArticles({ page: 1, page_size: 10 });
        const data = response.data.data;
        if (Array.isArray(data) && data.length > 0) {
          setArticles(data);
        }
      } catch (error) {
        console.error('Failed to fetch articles:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchArticles();
  }, []);

  const featuredArticle = articles[0];
  const latestArticles = useMemo(() => articles.slice(1, 7), [articles]);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="grid gap-8 border-b border-gray-200 pb-8 dark:border-gray-800 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)] lg:items-start">
        <div className="space-y-6">
          <div>
            <p className="mb-3 inline-flex items-center gap-2 rounded-md bg-blue-50 px-3 py-1 text-sm font-semibold text-blue-700 ring-1 ring-blue-100 dark:bg-blue-500/10 dark:text-blue-300 dark:ring-blue-500/20">
              <Sparkles className="h-4 w-4" />
              英文阅读学习台
            </p>
            <h1 className="max-w-xl text-3xl font-black leading-tight text-gray-950 dark:text-gray-100 sm:text-4xl">
              把每一篇英文材料读成可复习的积累。
            </h1>
            <p className="mt-4 max-w-2xl text-base leading-7 text-gray-600 dark:text-gray-400">
              从外刊、公开作品和每日任务进入阅读，划词查义、收藏句子，再回到生词本做间隔复习。
            </p>
          </div>

          <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-1">
            <Link href="/study" className="group flex items-center justify-between rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700">
              <span>
                <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">每日学习</span>
                <span className="mt-1 block text-xs text-gray-500">继续今天的阅读任务</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-300" />
            </Link>
            <Link href="/vocabulary" className="group flex items-center justify-between rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700">
              <span>
                <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">生词复习</span>
                <span className="mt-1 block text-xs text-gray-500">查看到期和薄弱词</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-300" />
            </Link>
            <Link href="/ao3" className="group flex items-center justify-between rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-blue-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-blue-700">
              <span>
                <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">AO3 阅读</span>
                <span className="mt-1 block text-xs text-gray-500">搜索公开作品并精读</span>
              </span>
              <ArrowRight className="h-4 w-4 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-300" />
            </Link>
          </div>
        </div>

        <div className="rounded-md border border-gray-200 bg-white p-5 dark:border-gray-800 dark:bg-gray-950">
          <div className="mb-4 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-lg font-black text-gray-950 dark:text-gray-100">今日推荐</h2>
              <p className="mt-1 text-sm text-gray-500">最近更新里最靠前的一篇</p>
            </div>
            <Link href="/latest" className="inline-flex items-center gap-1 text-sm font-semibold text-blue-700 hover:text-blue-600 dark:text-blue-300 dark:hover:text-blue-200">
              更多
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
          {loading ? (
            <div className="flex min-h-[280px] items-center justify-center">
              <Loader2 className="h-7 w-7 animate-spin text-gray-500" />
            </div>
          ) : featuredArticle ? (
            <ArticleRow article={featuredArticle} featured />
          ) : (
            <div className="py-12 text-center text-sm text-gray-500">暂无文章</div>
          )}
        </div>
      </section>

      <section className="grid gap-8 py-8 lg:grid-cols-[minmax(0,1fr)_320px]">
        <div>
          <div className="mb-3 flex items-center justify-between gap-4">
            <div>
              <h2 className="text-2xl font-black text-gray-950 dark:text-gray-100">最新文章</h2>
              <p className="mt-1 text-sm text-gray-500">按发布时间排列，适合快速扫读选择。</p>
            </div>
            <Link href="/journals" className="hidden items-center gap-1 text-sm font-semibold text-gray-700 hover:text-gray-950 dark:text-gray-300 dark:hover:text-white sm:inline-flex">
              全部外刊
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>

          {loading ? (
            <div className="flex min-h-[360px] items-center justify-center rounded-md border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
              <Loader2 className="h-7 w-7 animate-spin text-gray-500" />
            </div>
          ) : (
            <div className="rounded-md border border-gray-200 bg-white px-5 dark:border-gray-800 dark:bg-gray-950">
              {latestArticles.map((article) => (
                <ArticleRow key={article.id} article={article} />
              ))}
            </div>
          )}
        </div>

        <aside className="space-y-4">
          <Link href="/journals" className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700">
            <Tags className="mt-0.5 h-5 w-5 text-emerald-600 dark:text-emerald-300" />
            <span>
              <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">订阅与分类</span>
              <span className="mt-1 block text-sm leading-6 text-gray-500">按外刊来源和主题管理阅读范围。</span>
            </span>
          </Link>
          <Link href="/latest" className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700">
            <Clock className="mt-0.5 h-5 w-5 text-amber-600 dark:text-amber-300" />
            <span>
              <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">最近更新</span>
              <span className="mt-1 block text-sm leading-6 text-gray-500">只看新内容，不被首页信息流打断。</span>
            </span>
          </Link>
          <Link href="/ao3" className="flex items-start gap-3 rounded-md border border-gray-200 bg-white p-4 transition-colors hover:border-gray-300 dark:border-gray-800 dark:bg-gray-950 dark:hover:border-gray-700">
            <Search className="mt-0.5 h-5 w-5 text-blue-600 dark:text-blue-300" />
            <span>
              <span className="block text-sm font-bold text-gray-950 dark:text-gray-100">AO3 搜索</span>
              <span className="mt-1 block text-sm leading-6 text-gray-500">公开作品搜索、站内阅读、划词和句子精读。</span>
            </span>
          </Link>
        </aside>
      </section>
    </div>
  );
}
