'use client';

import { FormEvent, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Upload, Loader2, PlayCircle, RefreshCw, TriangleAlert, Clock3, FileVideo2, Trash2 } from 'lucide-react';
import { resolveAPIAssetURL, videoLessonAPI } from '@/lib/api';
import { formatVideoTime } from '@/lib/videoSubtitles';
import { useAuthStore } from '@/store/authStore';
import { VideoLesson } from '@/types';

const statusLabels: Record<VideoLesson['status'], string> = {
  uploaded: '已上传',
  extracting_audio: '抽取音频',
  transcribing: '识别字幕',
  segmenting: '整理字幕',
  ready: '可学习',
  failed: '失败',
  cancelled: '已取消',
};

const activeStatuses = ['uploaded', 'extracting_audio', 'transcribing', 'segmenting'];

export default function VideoLessonsPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [lessons, setLessons] = useState<VideoLesson[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [deletingId, setDeletingId] = useState<number | null>(null);
  const [regeneratingId, setRegeneratingId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [title, setTitle] = useState('');
  const [file, setFile] = useState<File | null>(null);

  useEffect(() => setMounted(true), []);

  const loadLessons = async () => {
    try {
      setLoading(true);
      setError('');
      const response = await videoLessonAPI.getLessons({ page: 1, page_size: 30 });
      setLessons(response.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || '视频列表加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }
    loadLessons();
  }, [isAuthenticated, mounted, router, token]);

  useEffect(() => {
    if (!lessons.some((lesson) => activeStatuses.includes(lesson.status))) {
      return;
    }
    const timer = window.setInterval(loadLessons, 5000);
    return () => window.clearInterval(timer);
  }, [lessons]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError('请选择视频或音频文件');
      return;
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('title', title.trim());
    formData.append('language', 'en');

    try {
      setUploading(true);
      setError('');
      await videoLessonAPI.upload(formData);
      setTitle('');
      setFile(null);
      const fileInput = document.getElementById('video-file') as HTMLInputElement | null;
      if (fileInput) fileInput.value = '';
      await loadLessons();
    } catch (err: any) {
      setError(err.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  const handleDeleteLesson = async (lesson: VideoLesson) => {
    if (!window.confirm(`删除视频「${lesson.title}」？`)) return;

    try {
      setDeletingId(lesson.id);
      setError('');
      await videoLessonAPI.deleteLesson(lesson.id);
      setLessons((current) => current.filter((item) => item.id !== lesson.id));
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    } finally {
      setDeletingId(null);
    }
  };

  const handleRegenerateSubtitles = async (lesson: VideoLesson) => {
    if (!window.confirm(`重新生成「${lesson.title}」的字幕？`)) return;

    try {
      setRegeneratingId(lesson.id);
      setError('');
      const response = await videoLessonAPI.regenerateSubtitles(lesson.id);
      const nextLesson = response.data.data as VideoLesson;
      setLessons((current) => current.map((item) => (item.id === lesson.id ? nextLesson : item)));
    } catch (err: any) {
      setError(err.response?.data?.error || '重新生成字幕失败');
    } finally {
      setRegeneratingId(null);
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-500 dark:text-gray-300">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载视频学习数据...
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-950 dark:text-white">视频学习</h1>
          <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">上传英文视频，自动生成字幕后逐句学习。</p>
        </div>
        <button
          onClick={loadLessons}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
        >
          <RefreshCw className="h-4 w-4" />
          刷新
        </button>
      </div>

      <form onSubmit={handleSubmit} className="mb-8 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
        <div className="grid gap-3 lg:grid-cols-[1fr_1.3fr_auto]">
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder="标题，留空则使用文件名"
            className="h-11 rounded-md border border-gray-300 bg-white px-3 text-sm outline-none focus:border-teal-600 dark:border-gray-700 dark:bg-gray-950 dark:text-white"
          />
          <input
            id="video-file"
            type="file"
            accept=".mp4,.mov,.m4v,.webm,.mp3,.m4a,video/*,audio/*"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="h-11 rounded-md border border-gray-300 bg-white px-3 py-2 text-sm dark:border-gray-700 dark:bg-gray-950 dark:text-gray-200"
          />
          <button
            type="submit"
            disabled={uploading}
            className="inline-flex h-11 items-center justify-center gap-2 rounded-md bg-teal-700 px-4 text-sm font-semibold text-white hover:bg-teal-600 disabled:opacity-60"
          >
            {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
            上传并识别
          </button>
        </div>
        {error && (
          <div className="mt-3 flex items-center gap-2 rounded-md bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-300">
            <TriangleAlert className="h-4 w-4" />
            {error}
          </div>
        )}
      </form>

      {lessons.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-300 p-10 text-center dark:border-gray-700">
          <FileVideo2 className="mx-auto h-10 w-10 text-gray-400" />
          <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">还没有视频，上传一个英文视频开始。</p>
        </div>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {lessons.map((lesson) => (
            <div key={lesson.id} className="group overflow-hidden rounded-lg border border-gray-200 bg-white transition-colors hover:border-teal-500 dark:border-gray-800 dark:bg-gray-900">
              <Link href={`/study/videos/${lesson.id}`} className="block">
                <div className="aspect-video bg-black">
                  <video src={resolveAPIAssetURL(`/${lesson.video_path}`)} className="h-full w-full object-cover" preload="metadata" muted />
                </div>
              </Link>
              <div className="p-4">
                <div className="flex items-start justify-between gap-3">
                  <Link href={`/study/videos/${lesson.id}`} className="min-w-0 flex-1">
                    <h2 className="line-clamp-2 font-semibold text-gray-950 group-hover:text-teal-700 dark:text-white dark:group-hover:text-teal-300">
                      {lesson.title}
                    </h2>
                  </Link>
                  <div className="flex shrink-0 items-center gap-1">
                    <Link href={`/study/videos/${lesson.id}`} title="播放" className="rounded-md p-1.5 text-gray-400 hover:bg-gray-100 hover:text-teal-600 dark:hover:bg-gray-800">
                      <PlayCircle className="h-5 w-5" />
                    </Link>
                    {!activeStatuses.includes(lesson.status) && (
                      <button
                        type="button"
                        onClick={() => handleRegenerateSubtitles(lesson)}
                        disabled={regeneratingId === lesson.id || deletingId === lesson.id}
                        title="重新生成字幕"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-gray-500 hover:bg-gray-100 hover:text-teal-700 disabled:opacity-50 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-teal-200"
                      >
                        {regeneratingId === lesson.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
                      </button>
                    )}
                    <button
                      type="button"
                      onClick={() => handleDeleteLesson(lesson)}
                      disabled={deletingId === lesson.id || regeneratingId === lesson.id}
                      title="删除"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-red-500 hover:bg-red-50 hover:text-red-700 disabled:opacity-50 dark:text-red-300 dark:hover:bg-red-950/40 dark:hover:text-red-200"
                    >
                      {deletingId === lesson.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div className="mt-3 flex items-center justify-between gap-3 text-xs text-gray-500 dark:text-gray-400">
                  <span className="inline-flex items-center gap-1">
                    <Clock3 className="h-3.5 w-3.5" />
                    {formatVideoTime(lesson.duration_seconds)}
                  </span>
                  <span className={lesson.status === 'ready' ? 'text-teal-700 dark:text-teal-300' : lesson.status === 'failed' ? 'text-amber-600 dark:text-amber-300' : ''}>
                    {statusLabels[lesson.status]} {lesson.status !== 'ready' && lesson.status !== 'failed' ? `${lesson.progress}%` : ''}
                  </span>
                </div>
                {lesson.status !== 'ready' && lesson.status !== 'failed' && (
                  <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    <div className="h-full bg-teal-600" style={{ width: `${Math.max(5, lesson.progress)}%` }} />
                  </div>
                )}
                {lesson.error && <p className="mt-2 line-clamp-2 text-xs text-amber-600 dark:text-amber-300">{lesson.error}</p>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
