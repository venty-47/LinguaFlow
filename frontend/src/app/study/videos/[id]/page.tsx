'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Loader2 } from 'lucide-react';
import SubtitleTimeline from '@/components/video-learning/SubtitleTimeline';
import VideoStudyPlayer from '@/components/video-learning/VideoStudyPlayer';
import TranslationTooltip from '@/components/TranslationTooltip';
import { isProcessingStatus } from '@/components/video-learning/VideoLessonCard';
import { videoLessonAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { VideoLesson, VideoSubtitle } from '@/types';

export default function VideoLessonDetailPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [mounted, setMounted] = useState(false);
  const [lesson, setLesson] = useState<VideoLesson | null>(null);
  const [subtitles, setSubtitles] = useState<VideoSubtitle[]>([]);
  const [currentTime, setCurrentTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [tooltip, setTooltip] = useState<{
    word: string;
    context: string;
    position: { x: number; y: number };
  } | null>(null);

  const lessonId = Number(params.id);

  useEffect(() => {
    setMounted(true);
  }, []);

  const fetchDetail = useCallback(async () => {
    const [lessonResponse, subtitlesResponse] = await Promise.all([
      videoLessonAPI.get(lessonId),
      videoLessonAPI.getSubtitles(lessonId),
    ]);
    setLesson(lessonResponse.data.data as VideoLesson);
    setSubtitles(subtitlesResponse.data.data as VideoSubtitle[]);
  }, [lessonId]);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }
    if (!Number.isFinite(lessonId) || lessonId <= 0) {
      setError('视频 ID 无效');
      setLoading(false);
      return;
    }

    const load = async () => {
      try {
        setLoading(true);
        setError('');
        await fetchDetail();
      } catch (err: any) {
        setError(err.response?.data?.error || '视频学习资料加载失败');
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [fetchDetail, isAuthenticated, lessonId, mounted, router, token]);

  useEffect(() => {
    if (!lesson || !isProcessingStatus(lesson.status)) return;
    const timer = window.setInterval(() => {
      fetchDetail().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [fetchDetail, lesson]);

  const activeSubtitle = useMemo(
    () =>
      subtitles.find(
        (subtitle) => currentTime >= subtitle.start_seconds && currentTime < subtitle.end_seconds
      ),
    [currentTime, subtitles]
  );

  const handleSeek = (seconds: number) => {
    const video = document.querySelector<HTMLVideoElement>('video');
    if (!video) return;
    video.currentTime = seconds;
    video.play().catch(() => undefined);
    setCurrentTime(seconds);
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6">
          <h1 className="mb-2 text-2xl font-bold text-gray-100">无法加载视频学习资料</h1>
          <p className="mb-6 text-sm text-red-200">{error || '资料不存在'}</p>
          <Link href="/study/videos" className="rounded-md bg-red-500 px-4 py-2 text-sm font-semibold text-white hover:bg-red-400">
            返回视频列表
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
      <Link href="/study/videos" className="mb-5 inline-flex items-center gap-2 text-sm font-semibold text-gray-400 hover:text-gray-200">
        <ArrowLeft className="h-4 w-4" />
        返回视频列表
      </Link>

      <div className="grid min-h-[calc(100vh-150px)] gap-5 lg:grid-cols-[minmax(0,1fr)_420px]">
        <div className="space-y-5">
          <VideoStudyPlayer
            lesson={lesson}
            subtitles={subtitles}
            currentTime={currentTime}
            onTimeChange={setCurrentTime}
            onLessonChange={setLesson}
            onSubtitlesChange={setSubtitles}
          />

          {activeSubtitle && (
            <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-5">
              <div className="mb-2 text-sm font-semibold text-blue-300">当前句</div>
              <p className="text-xl leading-8 text-gray-100">{activeSubtitle.text}</p>
              {activeSubtitle.translation && (
                <p className="mt-3 text-base leading-7 text-gray-400">{activeSubtitle.translation}</p>
              )}
            </div>
          )}
        </div>

        <div className="min-h-[560px] lg:h-[calc(100vh-150px)]">
          <SubtitleTimeline
            lessonId={lesson.id}
            subtitles={subtitles}
            activeSubtitleId={activeSubtitle?.id}
            onSeek={handleSeek}
            onSubtitlesChange={setSubtitles}
            onWordClick={(word, subtitle, position) =>
              setTooltip({ word, context: subtitle.text, position })
            }
          />
        </div>
      </div>

      {tooltip && (
        <TranslationTooltip
          selectedText={tooltip.word}
          position={tooltip.position}
          mode="dictionary"
          context={tooltip.context}
          onClose={() => setTooltip(null)}
        />
      )}
    </div>
  );
}
