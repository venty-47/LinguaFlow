'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft, FileVideo, Loader2, Search } from 'lucide-react';
import VideoLessonCard, { isProcessingStatus } from '@/components/video-learning/VideoLessonCard';
import VideoLessonUploader from '@/components/video-learning/VideoLessonUploader';
import { videoLessonAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { VideoLesson } from '@/types';

export default function VideoLessonsPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [processingId, setProcessingId] = useState<number | null>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchLessons = useCallback(async () => {
    const response = await videoLessonAPI.list({
      page: 1,
      page_size: 50,
      search: search.trim() || undefined,
      status: status || undefined,
    });
    setLessons(response.data.data as VideoLesson[]);
  }, [search, status]);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        await fetchLessons();
      } catch (err: any) {
        setError(err.response?.data?.error || '视频学习资料加载失败');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchLessons, isAuthenticated, mounted, router, token]);

  const hasProcessing = useMemo(() => lessons.some((lesson) => isProcessingStatus(lesson.status)), [lessons]);

  useEffect(() => {
    if (!hasProcessing) return;
    const timer = window.setInterval(() => {
      fetchLessons().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchLessons, hasProcessing]);

  const handleCreated = (lesson: VideoLesson) => {
    setLessons((prev) => [lesson, ...prev]);
  };

  const handleProcess = async (lesson: VideoLesson) => {
    try {
      setProcessingId(lesson.id);
      const response = await videoLessonAPI.process(lesson.id);
      const next = response.data.data as VideoLesson;
      setLessons((prev) => prev.map((item) => (item.id === lesson.id ? next : item)));
      await fetchLessons();
    } catch (err: any) {
      setError(err.response?.data?.error || '处理任务创建失败');
    } finally {
      setProcessingId(null);
    }
  };

  const handleDelete = async (lesson: VideoLesson) => {
    if (!window.confirm(`删除「${lesson.title}」？视频文件和字幕都会删除。`)) return;
    try {
      await videoLessonAPI.remove(lesson.id);
      setLessons((prev) => prev.filter((item) => item.id !== lesson.id));
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-6 border-b border-gray-800 pb-6">
        <Link href="/study" className="mb-4 inline-flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-gray-200">
          <ArrowLeft className="h-4 w-4" />
          返回每日学习
        </Link>
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <div className="mb-3 inline-flex items-center gap-2 rounded-md border border-blue-500/30 bg-blue-500/10 px-3 py-1 text-sm font-semibold text-blue-300">
              <FileVideo className="h-4 w-4" />
              视频学习
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-100 md:text-4xl">用演讲视频练精听和查词</h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-gray-500">
              上传 TED、课程或访谈视频，自动生成时间轴字幕；也可以导入 SRT/VTT 字幕直接学习。
            </p>
          </div>
        </div>
      </section>

      {error && (
        <div className="mb-6 rounded-md border border-red-500/40 bg-red-500/10 p-3 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="mb-6">
        <VideoLessonUploader onCreated={handleCreated} />
      </div>

      <section className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-bold text-gray-100">我的视频</h2>
          <p className="mt-1 text-sm text-gray-500">{lessons.length} 个学习资料</p>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row">
          <label className="relative block">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
            <input
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') fetchLessons().catch(() => undefined);
              }}
              placeholder="搜索标题"
              className="w-full rounded-md border border-gray-700 bg-gray-950 py-2 pl-9 pr-3 text-sm text-gray-100 outline-none focus:border-blue-500 sm:w-64"
            />
          </label>
          <select
            value={status}
            onChange={(event) => setStatus(event.target.value)}
            className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-100 outline-none focus:border-blue-500"
          >
            <option value="">全部状态</option>
            <option value="ready">可学习</option>
            <option value="uploaded">已上传</option>
            <option value="transcribing">生成中</option>
            <option value="failed">失败</option>
          </select>
        </div>
      </section>

      {lessons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-700 p-10 text-center">
          <FileVideo className="mx-auto mb-4 h-10 w-10 text-gray-600" />
          <h3 className="text-lg font-bold text-gray-200">还没有视频学习资料</h3>
          <p className="mt-2 text-sm text-gray-500">上传一个英文视频，或上传后导入已有字幕开始学习。</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lessons.map((lesson) => (
            <VideoLessonCard
              key={lesson.id}
              lesson={lesson}
              onProcess={handleProcess}
              onDelete={handleDelete}
              processing={processingId === lesson.id}
            />
          ))}
        </div>
      )}
    </div>
  );
}
