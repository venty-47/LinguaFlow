'use client';

import { useEffect, useState } from 'react';
import { Loader2, Trash2, BookOpen } from 'lucide-react';
import Link from 'next/link';
import { articleAPI } from '@/lib/api';

interface SavedSentence {
  id: number;
  article_id: number;
  article_title: string;
  sentence_text: string;
  analysis?: string;
  created_at: string;
}

export default function SentencesPage() {
  const [sentences, setSentences] = useState<SavedSentence[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSentences();
  }, []);

  const loadSentences = async () => {
    try {
      const response = await articleAPI.getUserSentences();
      setSentences(response.data.data || []);
    } catch (error) {
      console.error('Failed to load sentences:', error);
    } finally {
      setLoading(false);
    }
  };

  const deleteSentence = async (id: number) => {
    if (!confirm('确定删除这个收藏的句子吗？')) return;
    try {
      await articleAPI.deleteSentence(id);
      setSentences(sentences.filter(s => s.id !== id));
    } catch (error) {
      console.error('Failed to delete sentence:', error);
      alert('删除失��，请重试');
    }
  };

  const grouped = sentences.reduce((acc, s) => {
    const key = s.article_title || `文章 #${s.article_id}`;
    if (!acc[key]) acc[key] = [];
    acc[key].push(s);
    return acc;
  }, {} as Record<string, SavedSentence[]>);

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-sky-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-9 sm:px-6 lg:px-8">
      <div className="mb-8 flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-100">我的收藏句子</h1>
        <Link
          href="/articles"
          className="text-sm text-sky-400 hover:text-sky-300"
        >
          浏览更多文章
        </Link>
      </div>

      {Object.keys(grouped).length === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 text-gray-500">
          <BookOpen className="mb-4 h-12 w-12" />
          <p className="text-lg">暂无收藏的句子</p>
          <p className="mt-2 text-sm">在阅读文章时，点击句子即可收藏</p>
          <Link
            href="/latest"
            className="mt-4 rounded-lg bg-sky-600 px-4 py-2 text-sm font-medium text-white hover:bg-sky-500"
          >
            开始阅读
          </Link>
        </div>
      ) : (
        <div className="space-y-6">
          {Object.entries(grouped).map(([title, items]) => (
            <div key={title} className="overflow-hidden rounded-lg border border-gray-700">
              <div className="bg-gray-800/50 px-4 py-3">
                <Link
                  href={`/articles/${items[0].article_id}`}
                  className="font-medium text-sky-400 hover:text-sky-300"
                >
                  {title}
                </Link>
              </div>
              <div className="divide-y divide-gray-700">
                {items.map((sentence) => (
                  <div
                    key={sentence.id}
                    className="group flex items-start gap-4 p-4 hover:bg-gray-800/30"
                  >
                    <p className="flex-1 text-gray-200">{sentence.sentence_text}</p>
                    <button
                      onClick={() => deleteSentence(sentence.id)}
                      className="opacity-0 transition-opacity group-hover:opacity-100 text-red-400 hover:text-red-300"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}