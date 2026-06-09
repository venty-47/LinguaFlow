'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { format } from 'date-fns';
import {
  Archive,
  Edit3,
  Eye,
  FilePlus2,
  Loader2,
  RefreshCw,
  Save,
  Search,
  Star,
  Trash2,
  X,
} from 'lucide-react';
import { adminArticleAPI, categoryAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { AdminArticleInput, Article, Category, PaginationInfo } from '@/types';

const emptyForm: AdminArticleInput = {
  title: '',
  title_cn: '',
  slug: '',
  summary: '',
  summary_cn: '',
  content: '',
  content_cn: '',
  cover_image: '',
  category_id: 0,
  tags: '',
  source: '',
  source_url: '',
  author: '',
  published_at: '',
  difficulty_level: 'auto',
  status: 'draft',
  is_featured: false,
};

const statusLabels: Record<string, string> = {
  all: '全部状态',
  draft: '草稿',
  published: '已发布',
  archived: '已归档',
};

const difficultyLabels: Record<string, string> = {
  auto: '自动',
  easy: '简单',
  medium: '中等',
  hard: '较难',
};

function toDateInput(value?: string) {
  if (!value) return '';
  try {
    return format(new Date(value), 'yyyy-MM-dd');
  } catch {
    return '';
  }
}

function articleToForm(article: Article): AdminArticleInput {
  return {
    title: article.title || '',
    title_cn: article.title_cn || '',
    slug: article.slug || '',
    summary: article.summary || '',
    summary_cn: article.summary_cn || '',
    content: article.content || '',
    content_cn: article.content_cn || '',
    cover_image: article.cover_image || '',
    category_id: article.category_id,
    tags: article.tags || '',
    source: article.source || '',
    source_url: article.source_url || '',
    author: article.author || '',
    published_at: toDateInput(article.published_at),
    difficulty_level: article.difficulty_level,
    status: article.status as AdminArticleInput['status'],
    is_featured: article.is_featured,
  };
}

export default function AdminArticlesPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [articles, setArticles] = useState<Article[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [pagination, setPagination] = useState<PaginationInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [selectedArticle, setSelectedArticle] = useState<Article | null>(null);
  const [form, setForm] = useState<AdminArticleInput>(emptyForm);
  const [filters, setFilters] = useState({
    page: 1,
    status: 'all',
    category: '',
    source: '',
    search: '',
  });

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
    }
  }, [isAuthenticated, mounted, router, token]);

  const selectedCategory = useMemo(
    () => categories.find((category) => category.id === form.category_id),
    [categories, form.category_id]
  );

  const fetchCategories = useCallback(async () => {
    const response = await categoryAPI.getCategories();
    const data = (response.data.data || []) as Category[];
    setCategories(data);
    setForm((current) => ({
      ...current,
      category_id: current.category_id || data[0]?.id || 0,
    }));
  }, []);

  const fetchArticles = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await adminArticleAPI.getArticles({
        page: filters.page,
        page_size: 20,
        status: filters.status,
        category: filters.category || undefined,
        source: filters.source || undefined,
        search: filters.search || undefined,
      });
      setArticles(response.data.data || []);
      setPagination(response.data.pagination || null);
    } catch (err: any) {
      setError(err.response?.data?.error || '文章列表加载失败');
    } finally {
      setLoading(false);
    }
  }, [filters]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !token) return;
    fetchCategories().catch((err: any) => {
      setError(err.response?.data?.error || '分类加载失败');
    });
  }, [fetchCategories, isAuthenticated, mounted, token]);

  useEffect(() => {
    if (!mounted || !isAuthenticated || !token) return;
    fetchArticles();
  }, [fetchArticles, isAuthenticated, mounted, token]);

  const resetForm = () => {
    setSelectedArticle(null);
    setForm({
      ...emptyForm,
      category_id: categories[0]?.id || 0,
    });
    setNotice('');
    setError('');
  };

  const editArticle = (article: Article) => {
    setSelectedArticle(article);
    setForm(articleToForm(article));
    setNotice('');
    setError('');
  };

  const updateFilter = (key: keyof typeof filters, value: string | number) => {
    setFilters((current) => ({
      ...current,
      [key]: value,
      page: key === 'page' ? Number(value) : 1,
    }));
  };

  const saveArticle = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!form.category_id) {
      setError('请选择分类');
      return;
    }

    try {
      setSaving(true);
      setError('');
      setNotice('');
      const payload = {
        ...form,
        published_at: form.published_at || undefined,
        difficulty_level: form.difficulty_level || 'auto',
      };
      const response = selectedArticle
        ? await adminArticleAPI.updateArticle(selectedArticle.id, payload)
        : await adminArticleAPI.createArticle(payload);
      const saved = response.data.data as Article;
      setSelectedArticle(saved);
      setForm(articleToForm(saved));
      setNotice(selectedArticle ? '文章已更新' : '文章已创建');
      await fetchArticles();
    } catch (err: any) {
      setError(err.response?.data?.error || '保存失败');
    } finally {
      setSaving(false);
    }
  };

  const changeStatus = async (article: Article, status: 'draft' | 'published' | 'archived') => {
    try {
      setError('');
      await adminArticleAPI.updateStatus(article.id, status);
      await fetchArticles();
      if (selectedArticle?.id === article.id) {
        setSelectedArticle((current) => (current ? { ...current, status } : current));
        setForm((current) => ({ ...current, status }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '状态更新失败');
    }
  };

  const toggleFeatured = async (article: Article) => {
    try {
      setError('');
      const next = !article.is_featured;
      await adminArticleAPI.updateFeatured(article.id, next);
      await fetchArticles();
      if (selectedArticle?.id === article.id) {
        setSelectedArticle((current) => (current ? { ...current, is_featured: next } : current));
        setForm((current) => ({ ...current, is_featured: next }));
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '精选更新失败');
    }
  };

  const deleteArticle = async (article: Article) => {
    if (!window.confirm(`删除文章「${article.title}」？`)) return;

    try {
      setError('');
      await adminArticleAPI.deleteArticle(article.id);
      if (selectedArticle?.id === article.id) {
        resetForm();
      }
      await fetchArticles();
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  if (!mounted || !isAuthenticated || !token) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[1500px] px-4 py-8 sm:px-6 lg:px-8">
      <header className="mb-6 flex flex-col gap-4 border-b border-gray-800 pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div>
          <h1 className="text-3xl font-black text-gray-100">文章管理</h1>
          <p className="mt-2 text-sm text-gray-500">
            {pagination ? `共 ${pagination.total} 篇文章` : '管理文章库'}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={resetForm}
            className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500"
          >
            <FilePlus2 className="h-4 w-4" />
            新建文章
          </button>
          <button
            type="button"
            onClick={fetchArticles}
            className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-4 py-2 text-sm font-semibold text-gray-200 hover:border-gray-500"
          >
            <RefreshCw className="h-4 w-4" />
            刷新
          </button>
        </div>
      </header>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-4 py-3 text-sm text-red-200">
          {error}
        </div>
      )}
      {notice && (
        <div className="mb-4 rounded-md border border-emerald-500/30 bg-emerald-500/10 px-4 py-3 text-sm text-emerald-200">
          {notice}
        </div>
      )}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_460px]">
        <main className="min-w-0">
          <section className="mb-4 grid gap-3 border-b border-gray-800 pb-4 md:grid-cols-[1fr_160px_180px_160px]">
            <label className="relative block">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
              <input
                value={filters.search}
                onChange={(event) => updateFilter('search', event.target.value)}
                placeholder="搜索标题、摘要、来源"
                className="h-10 w-full rounded-md border border-gray-800 bg-gray-950 pl-9 pr-3 text-sm text-gray-100 outline-none focus:border-blue-500"
              />
            </label>
            <select
              value={filters.status}
              onChange={(event) => updateFilter('status', event.target.value)}
              className="h-10 rounded-md border border-gray-800 bg-gray-950 px-3 text-sm text-gray-100 outline-none focus:border-blue-500"
            >
              {Object.entries(statusLabels).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
            <select
              value={filters.category}
              onChange={(event) => updateFilter('category', event.target.value)}
              className="h-10 rounded-md border border-gray-800 bg-gray-950 px-3 text-sm text-gray-100 outline-none focus:border-blue-500"
            >
              <option value="">全部分类</option>
              {categories.map((category) => (
                <option key={category.id} value={category.slug}>
                  {category.name}
                </option>
              ))}
            </select>
            <input
              value={filters.source}
              onChange={(event) => updateFilter('source', event.target.value)}
              placeholder="来源"
              className="h-10 rounded-md border border-gray-800 bg-gray-950 px-3 text-sm text-gray-100 outline-none focus:border-blue-500"
            />
          </section>

          <section className="overflow-hidden rounded-md border border-gray-800">
            <div className="overflow-x-auto">
              <table className="min-w-[920px] w-full border-collapse text-left text-sm">
                <thead className="bg-gray-950 text-xs uppercase text-gray-500">
                  <tr>
                    <th className="px-4 py-3 font-semibold">文章</th>
                    <th className="px-4 py-3 font-semibold">分类</th>
                    <th className="px-4 py-3 font-semibold">状态</th>
                    <th className="px-4 py-3 font-semibold">数据</th>
                    <th className="px-4 py-3 text-right font-semibold">操作</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-800">
                  {loading ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                        <Loader2 className="mx-auto h-6 w-6 animate-spin" />
                      </td>
                    </tr>
                  ) : articles.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="px-4 py-12 text-center text-gray-500">
                        暂无文章
                      </td>
                    </tr>
                  ) : (
                    articles.map((article) => (
                      <tr
                        key={article.id}
                        className={`bg-gray-950/20 align-top hover:bg-gray-900/60 ${
                          selectedArticle?.id === article.id ? 'outline outline-1 outline-blue-500/60' : ''
                        }`}
                      >
                        <td className="max-w-[380px] px-4 py-4">
                          <button
                            type="button"
                            onClick={() => editArticle(article)}
                            className="line-clamp-2 text-left font-semibold text-gray-100 hover:text-blue-300"
                          >
                            {article.title}
                          </button>
                          <div className="mt-1 flex flex-wrap gap-2 text-xs text-gray-500">
                            <span>{article.source || '自建文章'}</span>
                            <span>{format(new Date(article.published_at), 'yyyy-MM-dd')}</span>
                            {article.is_featured && <span className="text-yellow-300">精选</span>}
                          </div>
                        </td>
                        <td className="px-4 py-4 text-gray-300">{article.category?.name || '-'}</td>
                        <td className="px-4 py-4">
                          <span className="rounded border border-gray-700 px-2 py-1 text-xs text-gray-300">
                            {statusLabels[article.status] || article.status}
                          </span>
                        </td>
                        <td className="px-4 py-4 text-xs text-gray-500">
                          <div>{article.word_count} 词</div>
                          <div>{article.reading_time} 分钟</div>
                          {article.cefr_level && <div>CEFR {article.cefr_level}</div>}
                          <div>{article.view_count} 次浏览</div>
                        </td>
                        <td className="px-4 py-4">
                          <div className="flex justify-end gap-1">
                            <button
                              type="button"
                              onClick={() => editArticle(article)}
                              title="编辑"
                              className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                            >
                              <Edit3 className="h-4 w-4" />
                            </button>
                            {article.status === 'published' && (
                              <Link
                                href={`/articles/${article.slug}`}
                                title="预览"
                                className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                              >
                                <Eye className="h-4 w-4" />
                              </Link>
                            )}
                            <button
                              type="button"
                              onClick={() => toggleFeatured(article)}
                              title={article.is_featured ? '取消精选' : '设为精选'}
                              className={`rounded-md p-2 hover:bg-gray-800 ${
                                article.is_featured ? 'text-yellow-300' : 'text-gray-400 hover:text-gray-100'
                              }`}
                            >
                              <Star className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() =>
                                changeStatus(article, article.status === 'published' ? 'draft' : 'published')
                              }
                              title={article.status === 'published' ? '下架' : '发布'}
                              className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
                            >
                              <Archive className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteArticle(article)}
                              title="删除"
                              className="rounded-md p-2 text-red-400 hover:bg-red-950/40 hover:text-red-200"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {pagination && pagination.total_page > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm text-gray-500">
              <span>
                第 {pagination.page} / {pagination.total_page} 页
              </span>
              <div className="flex gap-2">
                <button
                  type="button"
                  disabled={pagination.page <= 1}
                  onClick={() => updateFilter('page', pagination.page - 1)}
                  className="rounded-md border border-gray-800 px-3 py-2 text-gray-200 disabled:opacity-40"
                >
                  上一页
                </button>
                <button
                  type="button"
                  disabled={pagination.page >= pagination.total_page}
                  onClick={() => updateFilter('page', pagination.page + 1)}
                  className="rounded-md border border-gray-800 px-3 py-2 text-gray-200 disabled:opacity-40"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </main>

        <aside className="min-w-0 rounded-md border border-gray-800 bg-gray-950/40">
          <div className="flex items-center justify-between border-b border-gray-800 px-4 py-3">
            <div>
              <h2 className="font-bold text-gray-100">{selectedArticle ? '编辑文章' : '新建文章'}</h2>
              <p className="text-xs text-gray-500">
                {selectedArticle ? `ID ${selectedArticle.id}` : selectedCategory?.name || '选择分类后保存'}
              </p>
            </div>
            {selectedArticle && (
              <button
                type="button"
                onClick={resetForm}
                title="关闭编辑"
                className="rounded-md p-2 text-gray-400 hover:bg-gray-800 hover:text-gray-100"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          <form onSubmit={saveArticle} className="space-y-4 p-4">
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">标题</label>
              <input
                required
                value={form.title}
                onChange={(event) => setForm({ ...form, title: event.target.value })}
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">中文标题</label>
              <input
                value={form.title_cn || ''}
                onChange={(event) => setForm({ ...form, title_cn: event.target.value })}
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">分类</label>
                <select
                  required
                  value={form.category_id || ''}
                  onChange={(event) => setForm({ ...form, category_id: Number(event.target.value) })}
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="">选择分类</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">状态</label>
                <select
                  value={form.status || 'draft'}
                  onChange={(event) =>
                    setForm({ ...form, status: event.target.value as AdminArticleInput['status'] })
                  }
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  <option value="draft">草稿</option>
                  <option value="published">已发布</option>
                  <option value="archived">已归档</option>
                </select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">难度</label>
                <select
                  value={form.difficulty_level || 'auto'}
                  onChange={(event) =>
                    setForm({
                      ...form,
                      difficulty_level: event.target.value as AdminArticleInput['difficulty_level'],
                    })
                  }
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                >
                  {Object.entries(difficultyLabels).map(([value, label]) => (
                    <option key={value} value={value}>
                      {label}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">发布日期</label>
                <input
                  type="date"
                  value={form.published_at || ''}
                  onChange={(event) => setForm({ ...form, published_at: event.target.value })}
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <label className="flex items-center gap-2 text-sm text-gray-300">
              <input
                type="checkbox"
                checked={Boolean(form.is_featured)}
                onChange={(event) => setForm({ ...form, is_featured: event.target.checked })}
                className="h-4 w-4 rounded border-gray-700 bg-gray-950"
              />
              精选文章
            </label>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">摘要</label>
              <textarea
                value={form.summary || ''}
                onChange={(event) => setForm({ ...form, summary: event.target.value })}
                rows={3}
                className="w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">正文</label>
              <textarea
                required
                value={form.content}
                onChange={(event) => setForm({ ...form, content: event.target.value })}
                rows={12}
                className="w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">中文正文</label>
              <textarea
                value={form.content_cn || ''}
                onChange={(event) => setForm({ ...form, content_cn: event.target.value })}
                rows={6}
                className="w-full resize-y rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm leading-6 outline-none focus:border-blue-500"
              />
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">来源</label>
                <input
                  value={form.source || ''}
                  onChange={(event) => setForm({ ...form, source: event.target.value })}
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs font-semibold text-gray-400">作者</label>
                <input
                  value={form.author || ''}
                  onChange={(event) => setForm({ ...form, author: event.target.value })}
                  className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">源链接</label>
              <input
                value={form.source_url || ''}
                onChange={(event) => setForm({ ...form, source_url: event.target.value })}
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">封面图</label>
              <input
                value={form.cover_image || ''}
                onChange={(event) => setForm({ ...form, cover_image: event.target.value })}
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">标签</label>
              <input
                value={form.tags || ''}
                onChange={(event) => setForm({ ...form, tags: event.target.value })}
                placeholder="news,ai,learning"
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>
            <div>
              <label className="mb-1 block text-xs font-semibold text-gray-400">Slug</label>
              <input
                value={form.slug || ''}
                onChange={(event) => setForm({ ...form, slug: event.target.value })}
                className="w-full rounded-md border border-gray-800 bg-gray-950 px-3 py-2 text-sm outline-none focus:border-blue-500"
              />
            </div>

            <button
              type="submit"
              disabled={saving}
              className="inline-flex w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-60"
            >
              {saving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
              保存文章
            </button>
          </form>
        </aside>
      </div>
    </div>
  );
}
