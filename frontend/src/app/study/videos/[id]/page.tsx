'use client';

import { MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ArrowLeft, Languages, Loader2, Pause, Play, RefreshCw, Repeat, SkipBack, SkipForward, Trash2, TriangleAlert } from 'lucide-react';
import TranslationTooltip from '@/components/TranslationTooltip';
import VideoUnderstandingPanel from '@/components/VideoUnderstandingPanel';
import { resolveAPIAssetURL, videoLessonAPI } from '@/lib/api';
import {
  findActiveSubtitle,
  formatVideoTime,
  getSubtitleContext,
  normalizeSubtitleWord,
  splitSubtitleTokens,
} from '@/lib/videoSubtitles';
import { useAuthStore } from '@/store/authStore';
import { SubtitleDisplayMode, VideoLesson, VideoSubtitle } from '@/types';

const activeStatuses = ['uploaded', 'extracting_audio', 'transcribing', 'segmenting'];

const statusLabels: Record<VideoLesson['status'], string> = {
  uploaded: '已上传',
  extracting_audio: '抽取音频',
  transcribing: '识别字幕',
  segmenting: '整理字幕',
  ready: '可学习',
  failed: '失败',
  cancelled: '已取消',
};

export default function VideoLessonPage() {
  const params = useParams();
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const activeSubtitleRef = useRef<HTMLDivElement | null>(null);
  const progressTimerRef = useRef<number | null>(null);
  const lessonId = Number(params.id);

  const [mounted, setMounted] = useState(false);
  const [lesson, setLesson] = useState<VideoLesson | null>(null);
  const [subtitles, setSubtitles] = useState<VideoSubtitle[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState('');
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loopSubtitle, setLoopSubtitle] = useState(false);
  const [subtitleMode, setSubtitleMode] = useState<SubtitleDisplayMode>('bilingual');
  const [translating, setTranslating] = useState(false);
  const [activeView, setActiveView] = useState<'subtitles' | 'understanding'>('subtitles');
  const [tooltip, setTooltip] = useState<{
    word: string;
    context: string;
    x: number;
    y: number;
  } | null>(null);

  useEffect(() => setMounted(true), []);

  const activeSubtitle = useMemo(() => findActiveSubtitle(subtitles, currentTime), [currentTime, subtitles]);
  const activeIndex = useMemo(
    () => (activeSubtitle ? subtitles.findIndex((item) => item.id === activeSubtitle.id) : -1),
    [activeSubtitle, subtitles]
  );

  const loadLesson = useCallback(async () => {
    if (!Number.isFinite(lessonId) || lessonId <= 0) {
      setError('无效的视频 ID');
      setLoading(false);
      return;
    }

    try {
      setError('');
      const lessonResponse = await videoLessonAPI.getLesson(lessonId);
      const nextLesson = lessonResponse.data.data as VideoLesson;
      setLesson(nextLesson);
      if (nextLesson.status === 'ready') {
        const subtitleResponse = await videoLessonAPI.getSubtitles(lessonId);
        setSubtitles(subtitleResponse.data.data || []);
      }
    } catch (err: any) {
      setError(err.response?.data?.error || '视频加载失败');
    } finally {
      setLoading(false);
    }
  }, [lessonId]);

  useEffect(() => {
    if (!mounted) return;
    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }
    loadLesson();
  }, [isAuthenticated, loadLesson, mounted, router, token]);

  useEffect(() => {
    if (!lesson || !activeStatuses.includes(lesson.status)) return;
    const timer = window.setInterval(loadLesson, 5000);
    return () => window.clearInterval(timer);
  }, [lesson, loadLesson]);

  useEffect(() => {
    activeSubtitleRef.current?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [activeSubtitle?.id]);

  useEffect(() => {
    return () => {
      if (progressTimerRef.current) {
        window.clearTimeout(progressTimerRef.current);
      }
    };
  }, []);

  const saveProgress = (position: number, completed = false) => {
    if (!lesson) return;
    if (progressTimerRef.current) {
      window.clearTimeout(progressTimerRef.current);
    }
    progressTimerRef.current = window.setTimeout(() => {
      videoLessonAPI.updateProgress(lesson.id, { position_seconds: position, completed }).catch(() => {
        // Progress should not interrupt playback.
      });
    }, 800);
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    const time = video.currentTime;
    setCurrentTime(time);

    if (loopSubtitle) {
      const active = findActiveSubtitle(subtitles, time);
      if (active && time >= active.end_seconds - 0.08) {
        video.currentTime = active.start_seconds;
        video.play().catch(() => undefined);
        return;
      }
    }

    if (Math.floor(time) % 10 === 0) {
      saveProgress(time, false);
    }
  };

  const seekToSubtitle = (subtitle: VideoSubtitle) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, subtitle.start_seconds + 0.02);
    setCurrentTime(video.currentTime);
    video.play().catch(() => undefined);
  };

  const seekBy = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, Math.min(video.duration || duration || 0, video.currentTime + delta));
  };

  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;
    if (video.paused) {
      video.play().catch(() => undefined);
    } else {
      video.pause();
    }
  };

  const handleDeleteLesson = async () => {
    if (!lesson || !window.confirm(`删除视频「${lesson.title}」？`)) return;

    try {
      setDeleting(true);
      setError('');
      await videoLessonAPI.deleteLesson(lesson.id);
      router.push('/study/videos');
    } catch (err: any) {
      setError(err.response?.data?.error || '删除失败');
    } finally {
      setDeleting(false);
    }
  };

  const handleRegenerateSubtitles = async () => {
    if (!lesson || !window.confirm(`重新生成「${lesson.title}」的字幕？`)) return;

    try {
      setRegenerating(true);
      setError('');
      const response = await videoLessonAPI.regenerateSubtitles(lesson.id);
      setLesson(response.data.data as VideoLesson);
      setSubtitles([]);
    } catch (err: any) {
      setError(err.response?.data?.error || '重新生成字幕失败');
    } finally {
      setRegenerating(false);
    }
  };

  const handleTranslateSubtitles = async () => {
    if (!lesson) return;

    try {
      setTranslating(true);
      setError('');
      await videoLessonAPI.translateSubtitles(lesson.id, { target_lang: 'zh' });
      const subtitleResponse = await videoLessonAPI.getSubtitles(lessonId);
      setSubtitles(subtitleResponse.data.data || []);
    } catch (err: any) {
      setError(err.response?.data?.error || '翻译失败');
    } finally {
      setTranslating(false);
    }
  };

  const handleWordClick = (event: MouseEvent<HTMLButtonElement>, subtitle: VideoSubtitle, token: string) => {
    event.stopPropagation();
    const word = normalizeSubtitleWord(token);
    if (!word) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setTooltip({
      word,
      context: getSubtitleContext(subtitle, subtitles),
      x: Math.min(rect.left, window.innerWidth - 440),
      y: rect.bottom + window.scrollY + 8,
    });
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center text-gray-500 dark:text-gray-300">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载视频...
      </div>
    );
  }

  if (error || !lesson) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-12">
        <Link href="/study/videos" className="mb-6 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white">
          <ArrowLeft className="h-4 w-4" />
          返回视频学习
        </Link>
        <div className="rounded-lg border border-amber-300 bg-amber-50 p-4 text-amber-800 dark:border-amber-500/40 dark:bg-amber-500/10 dark:text-amber-200">
          {error || '视频不存在'}
        </div>
      </div>
    );
  }

  const videoURL = resolveAPIAssetURL(`/${lesson.video_path}`);

  return (
    <div className="mx-auto max-w-[1460px] px-4 py-6 sm:px-6 lg:px-8">
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <Link href="/study/videos" className="mb-2 inline-flex items-center gap-2 text-sm text-gray-500 hover:text-gray-950 dark:text-gray-400 dark:hover:text-white">
            <ArrowLeft className="h-4 w-4" />
            返回视频学习
          </Link>
          <h1 className="text-2xl font-bold text-gray-950 dark:text-white">{lesson.title}</h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={loadLesson}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-gray-300 px-3 text-sm font-medium text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-900"
          >
            <RefreshCw className="h-4 w-4" />
            刷新状态
          </button>
          {lesson.status === 'ready' && subtitles.length > 0 && (
            <button
              onClick={handleTranslateSubtitles}
              disabled={translating}
              className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-blue-300 px-3 text-sm font-medium text-blue-700 hover:bg-blue-50 disabled:opacity-60 dark:border-blue-800 dark:text-blue-300 dark:hover:bg-blue-950/40"
            >
              {translating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Languages className="h-4 w-4" />}
              生成双语字幕
            </button>
          )}
          <button
            onClick={handleRegenerateSubtitles}
            disabled={regenerating || activeStatuses.includes(lesson.status)}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-teal-300 px-3 text-sm font-medium text-teal-700 hover:bg-teal-50 disabled:opacity-60 dark:border-teal-800 dark:text-teal-300 dark:hover:bg-teal-950/40"
          >
            {regenerating ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            重新生成字幕
          </button>
          <button
            onClick={handleDeleteLesson}
            disabled={deleting || regenerating}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-red-300 px-3 text-sm font-medium text-red-600 hover:bg-red-50 disabled:opacity-60 dark:border-red-800 dark:text-red-300 dark:hover:bg-red-950/40"
          >
            {deleting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
            删除
          </button>
        </div>
      </div>

      {lesson.status !== 'ready' && (
        <div className="mb-5 rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-800 dark:bg-gray-900">
          <div className="flex items-center justify-between gap-4">
            <div>
              <div className="font-medium text-gray-950 dark:text-white">{statusLabels[lesson.status]}</div>
              <div className="mt-1 text-sm text-gray-500 dark:text-gray-400">
                {lesson.status === 'failed' ? lesson.error || '处理失败' : '字幕生成中，页面会自动刷新。'}
              </div>
            </div>
            {lesson.status === 'failed' ? (
              <TriangleAlert className="h-6 w-6 text-amber-500" />
            ) : (
              <Loader2 className="h-6 w-6 animate-spin text-teal-600" />
            )}
          </div>
          {lesson.status !== 'failed' && (
            <div className="mt-4 h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
              <div className="h-full bg-teal-600" style={{ width: `${Math.max(5, lesson.progress)}%` }} />
            </div>
          )}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        <section className="min-w-0">
          <div className="video-learning-player overflow-hidden rounded-lg">
            <video
              ref={videoRef}
              src={videoURL}
              controls
              preload="metadata"
              className="h-full w-full"
              onLoadedMetadata={(event) => {
                const video = event.currentTarget;
                setDuration(video.duration || lesson.duration_seconds || 0);
                if (lesson.last_position_seconds > 0 && lesson.last_position_seconds < video.duration - 3) {
                  video.currentTime = lesson.last_position_seconds;
                }
              }}
              onTimeUpdate={handleTimeUpdate}
              onPlay={() => setPlaying(true)}
              onPause={() => {
                setPlaying(false);
                saveProgress(videoRef.current?.currentTime || currentTime, false);
              }}
              onEnded={() => {
                setPlaying(false);
                saveProgress(videoRef.current?.currentTime || currentTime, true);
              }}
            >
            </video>
            {activeSubtitle && subtitleMode !== 'off' && (
              <div className="pointer-events-none absolute inset-x-3 bottom-14 z-10 flex justify-center">
                <div className="max-w-[92%] rounded-md bg-black/75 px-4 py-2 text-center text-lg font-semibold leading-7 text-white shadow-lg">
                  {subtitleMode === 'en' && <div>{activeSubtitle.text}</div>}
                  {subtitleMode === 'zh' && (
                    <div>{activeSubtitle.translation || activeSubtitle.text}</div>
                  )}
                  {subtitleMode === 'bilingual' && (
                    <>
                      <div>{activeSubtitle.text}</div>
                      {activeSubtitle.translation && (
                        <div className="mt-1 text-base text-gray-200">{activeSubtitle.translation}</div>
                      )}
                    </>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-2 rounded-lg border border-gray-200 bg-white p-3 dark:border-gray-800 dark:bg-gray-900">
            <button onClick={togglePlay} className="inline-flex h-9 items-center gap-2 rounded-md bg-teal-700 px-3 text-sm font-medium text-white hover:bg-teal-600">
              {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              {playing ? '暂停' : '播放'}
            </button>
            <button onClick={() => seekBy(-5)} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <SkipBack className="h-4 w-4" />
              5s
            </button>
            <button onClick={() => seekBy(5)} className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 px-3 text-sm text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800">
              <SkipForward className="h-4 w-4" />
              5s
            </button>
            <button
              onClick={() => setLoopSubtitle((value) => !value)}
              className={`inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm ${
                loopSubtitle
                  ? 'border-teal-600 bg-teal-600 text-white'
                  : 'border-gray-300 text-gray-700 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800'
              }`}
            >
              <Repeat className="h-4 w-4" />
              单句循环
            </button>
            <div className="flex items-center gap-1 rounded-md border border-gray-300 dark:border-gray-700">
              <button
                onClick={() => setSubtitleMode('en')}
                className={`h-9 px-2 text-xs font-medium ${
                  subtitleMode === 'en' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                英文
              </button>
              <button
                onClick={() => setSubtitleMode('zh')}
                className={`h-9 px-2 text-xs font-medium ${
                  subtitleMode === 'zh' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                中文
              </button>
              <button
                onClick={() => setSubtitleMode('bilingual')}
                className={`h-9 px-2 text-xs font-medium ${
                  subtitleMode === 'bilingual' ? 'bg-teal-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                双语
              </button>
              <button
                onClick={() => setSubtitleMode('off')}
                className={`h-9 px-2 text-xs font-medium ${
                  subtitleMode === 'off' ? 'bg-gray-600 text-white' : 'text-gray-600 hover:bg-gray-50 dark:text-gray-300 dark:hover:bg-gray-800'
                }`}
              >
                关闭
              </button>
            </div>
            <div className="ml-auto text-sm tabular-nums text-gray-500 dark:text-gray-400">
              {formatVideoTime(currentTime)} / {formatVideoTime(duration || lesson.duration_seconds)}
            </div>
          </div>

          {activeSubtitle && (
            <div className="mt-4 rounded-lg border border-teal-500/30 bg-teal-500/10 p-4 dark:bg-teal-300/10">
              <div className="mb-1 text-xs font-medium text-teal-700 dark:text-teal-300">当前字幕</div>
              <p className="text-xl leading-9 text-gray-950 dark:text-white">{activeSubtitle.text}</p>
              {activeSubtitle.translation && (
                <p className="mt-2 text-base leading-7 text-gray-700 dark:text-gray-300">{activeSubtitle.translation}</p>
              )}
            </div>
          )}
        </section>

        <aside className="min-h-[520px] rounded-lg border border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-900">
          <div className="border-b border-gray-200 dark:border-gray-800">
            <div className="flex">
              <button
                onClick={() => setActiveView('subtitles')}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  activeView === 'subtitles'
                    ? 'border-b-2 border-teal-600 text-teal-600'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                字幕列表
              </button>
              <button
                onClick={() => setActiveView('understanding')}
                className={`flex-1 px-4 py-3 text-sm font-medium ${
                  activeView === 'understanding'
                    ? 'border-b-2 border-teal-600 text-teal-600'
                    : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
                }`}
              >
                视频理解
              </button>
            </div>
          </div>

          <div className="max-h-[calc(100vh-220px)] overflow-y-auto p-2">
            {activeView === 'subtitles' ? (
              subtitles.length === 0 ? (
                <div className="p-4 text-sm text-gray-500 dark:text-gray-400">
                  {lesson.status === 'ready' ? '暂无字幕' : '字幕生成完成后会显示在这里。'}
                </div>
              ) : (
                subtitles.map((subtitle, index) => {
                  const active = activeSubtitle?.id === subtitle.id;
                  return (
                    <div
                      key={subtitle.id}
                      ref={active ? activeSubtitleRef : undefined}
                      onClick={() => seekToSubtitle(subtitle)}
                      className={`mb-1 cursor-pointer rounded-md px-3 py-2 transition-colors ${
                        active
                          ? 'bg-teal-600 text-white'
                          : 'text-gray-700 hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800'
                      }`}
                    >
                      <div className={`mb-1 text-xs tabular-nums ${active ? 'text-teal-50' : 'text-gray-500 dark:text-gray-400'}`}>
                        {String(index + 1).padStart(2, '0')} · {formatVideoTime(subtitle.start_seconds)} - {formatVideoTime(subtitle.end_seconds)}
                      </div>
                      <p className="leading-7">
                        {splitSubtitleTokens(subtitle.text).map((token, tokenIndex) => {
                          const word = normalizeSubtitleWord(token);
                          if (!word) return <span key={`${subtitle.id}-${tokenIndex}`}>{token}</span>;
                          return (
                            <button
                              key={`${subtitle.id}-${tokenIndex}`}
                              type="button"
                              onClick={(event) => handleWordClick(event, subtitle, token)}
                              className={`rounded px-0.5 text-left hover:underline ${active ? 'hover:bg-white/15' : 'hover:bg-teal-500/10'}`}
                            >
                              {token}
                            </button>
                          );
                        })}
                      </p>
                      {subtitle.translation && (
                        <p className={`mt-1 text-sm leading-6 ${active ? 'text-teal-50' : 'text-gray-600 dark:text-gray-400'}`}>
                          {subtitle.translation}
                        </p>
                      )}
                    </div>
                  );
                })
              )
            ) : (
              <VideoUnderstandingPanel
                lesson={lesson}
                onSeek={(seconds) => {
                  const video = videoRef.current;
                  if (video) {
                    video.currentTime = seconds;
                    video.play().catch(() => undefined);
                  }
                }}
              />
            )}
          </div>
        </aside>
      </div>

      {tooltip && (
        <TranslationTooltip
          selectedText={tooltip.word}
          position={{ x: tooltip.x, y: tooltip.y }}
          onClose={() => setTooltip(null)}
          mode="dictionary"
          context={tooltip.context}
        />
      )}
    </div>
  );
}
