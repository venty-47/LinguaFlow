'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { articleAPI, resolveAPIAssetURL } from '@/lib/api';
import { Article } from '@/types';
import { ArrowRight, Loader2, Sparkles } from 'lucide-react';

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

function MagazineArticleCard({ article, index }: { article: Article; index: number }) {
  const href = article.id < 0 ? '/journals' : `/articles/${article.slug}`;
  const coverImageURL = article.cover_image ? resolveAPIAssetURL(article.cover_image) : '';

  return (
    <Link
      href={href}
      className={`group block pb-8 lg:px-5 ${
        index % 5 === 0 ? '' : 'lg:border-l lg:border-gray-500'
      }`}
    >
      <div className="relative mb-3 aspect-[16/9] w-full overflow-hidden bg-gray-900">
        {coverImageURL ? (
          <Image
            src={coverImageURL}
            alt={article.title}
            fill
            sizes="(max-width: 1024px) 50vw, 20vw"
            className="object-cover transition-transform duration-300 group-hover:scale-105"
          />
        ) : null}
      </div>

      <div className="mb-2 text-sm font-semibold text-red-500">
        {article.source || 'MITTR'}
        <span className="mx-2 text-gray-600">|</span>
        <span>{article.category?.name || 'Artificial intelligence'}</span>
      </div>

      <h2 className="mb-2 text-[1.35rem] font-bold leading-snug text-gray-200 transition-colors group-hover:text-white">
        {article.title}
      </h2>

      {article.title_cn && (
        <p className="mb-3 line-clamp-2 text-[0.95rem] font-semibold leading-6 text-gray-400">
          {article.title_cn}
        </p>
      )}

      <div className="flex items-center justify-between text-sm text-gray-500">
        <span>{article.published_at}</span>
        <span>
          {article.word_count}词&nbsp;&nbsp;{difficultyLabels[article.difficulty_level]}
        </span>
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

  return (
    <div className="mx-auto max-w-[1460px] px-4 py-14 sm:px-6 lg:px-8">
      <Link
        href="/journals"
        className="mb-12 inline-flex text-base font-semibold text-sky-500 hover:text-sky-400"
      >
        咕咕读外刊使用指南（首次使用必看）
      </Link>

      <section className="mb-12">
        <div className="mb-7 flex items-start justify-between gap-6">
          <div>
            <div className="mb-6 flex items-center gap-3">
              <Sparkles className="h-7 w-7 text-gray-300" />
              <h1 className="text-3xl font-black tracking-tight text-gray-100">
                我的订阅
              </h1>
              <Link
                href="/journals"
                className="rounded-md border border-gray-600 px-3 py-1.5 text-sm font-medium text-gray-300 hover:bg-gray-900"
              >
                管理订阅
              </Link>
            </div>
            <p className="text-base text-gray-500">
              根据你的外刊和分类订阅筛选出的最新文章。
            </p>
          </div>
          <Link
            href="/journals"
            className="mt-10 hidden items-center gap-2 text-base font-medium text-gray-400 hover:text-gray-200 md:inline-flex"
          >
            查看更多
            <ArrowRight className="h-4 w-4" />
          </Link>
        </div>

        <div className="mb-6 border-t border-gray-700" />

        {loading ? (
          <div className="flex min-h-[420px] items-center justify-center">
            <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-x-0 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
            {articles.slice(0, 10).map((article, index) => (
              <MagazineArticleCard key={article.id} article={article} index={index} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-6">
        <h2 className="mb-6 text-3xl font-black tracking-tight text-gray-100">
          最近更新
        </h2>
        <div className="border-t border-gray-700 pt-6">
          <div className="grid grid-cols-1 gap-x-0 gap-y-2 sm:grid-cols-2 lg:grid-cols-5">
            {articles.slice(0, 5).map((article, index) => (
              <MagazineArticleCard
                key={`latest-${article.id}`}
                article={article}
                index={index}
              />
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
