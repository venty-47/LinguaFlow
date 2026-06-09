'use client';

import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { FileUp, Loader2, RotateCcw, SkipBack, SkipForward } from 'lucide-react';
import { resolveAPIAssetURL, videoLessonAPI } from '@/lib/api';
import { VideoLesson, VideoSubtitle } from '@/types';
import { formatDuration, isProcessingStatus } from './VideoLessonCard';

interface VideoStudyPlayerProps {
  lesson: VideoLesson;
  subtitles: VideoSubtitle[];
  currentTime: number;
  onTimeChange: (seconds: number) => void;
  onLessonChange: (lesson: VideoLesson) => void;
  onSubtitlesChange: (subtitles: VideoSubtitle[]) => void;
}

const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  extracting_audio: '正在提取音频',
  transcribing: '正在生成字幕',
  segmenting: '正在整理字幕',
  ready: '可学习',
  failed: '处理失败',
  cancelled: '已取消',
};

export default function VideoStudyPlayer({
  lesson,
  subtitles,
  currentTime,
  onTimeChange,
  onLessonChange,
  onSubtitlesChange,
}: VideoStudyPlayerProps) {
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const lastSavedRef = useRef(0);
  const watchedRef = useRef(0);
  const lastPlaybackTimeRef = useRef<number | null>(null);
  const [processing, setProcessing] = useState(false);
  const [importing, setImporting] = useState(false);
  const [playbackRate, setPlaybackRate] = useState(1);

  const activeIndex = useMemo(
    () =>
      subtitles.findIndex(
        (subtitle) => currentTime >= subtitle.start_seconds && currentTime < subtitle.end_seconds
      ),
    [currentTime, subtitles]
  );

  useEffect(() => {
    const video = videoRef.current;
    if (
      video &&
      lesson.last_position_seconds > 0 &&
      Math.abs(video.currentTime - lesson.last_position_seconds) > 1
    ) {
      video.currentTime = lesson.last_position_seconds;
    }
  }, [lesson.id, lesson.last_position_seconds]);

  useEffect(() => {
    if (videoRef.current) {
      videoRef.current.playbackRate = playbackRate;
    }
  }, [playbackRate]);

  const saveProgress = async (completed = false) => {
    const video = videoRef.current;
    if (!video) return;
    const watchedSeconds = Math.max(0, Math.round(watchedRef.current));
    watchedRef.current = 0;
    const response = await videoLessonAPI.updateProgress(lesson.id, {
      last_position_seconds: video.currentTime,
      completed,
      watched_seconds: watchedSeconds,
    });
    onLessonChange(response.data.data as VideoLesson);
    lastSavedRef.current = Date.now();
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;
    onTimeChange(video.currentTime);
    if (!video.paused && lastPlaybackTimeRef.current !== null) {
      const delta = video.currentTime - lastPlaybackTimeRef.current;
      if (delta > 0 && delta < 2) {
        watchedRef.current += delta;
      }
    }
    lastPlaybackTimeRef.current = video.currentTime;
    if (Date.now() - lastSavedRef.current > 30000) {
      saveProgress(false).catch(() => undefined);
    }
  };

  const handleProcess = async () => {
    try {
      setProcessing(true);
      const response = await videoLessonAPI.process(lesson.id);
      onLessonChange(response.data.data as VideoLesson);
    } finally {
      setProcessing(false);
    }
  };

  const handleSubtitleImport = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const data = new FormData();
    data.append('file', file);
    try {
      setImporting(true);
      const response = await videoLessonAPI.importSubtitles(lesson.id, data);
      onSubtitlesChange(response.data.data as VideoSubtitle[]);
      const lessonResponse = await videoLessonAPI.get(lesson.id);
      onLessonChange(lessonResponse.data.data as VideoLesson);
    } finally {
      setImporting(false);
      event.target.value = '';
    }
  };

  const seekRelative = (delta: number) => {
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = Math.max(0, video.currentTime + delta);
  };

  const seekSubtitle = (direction: -1 | 1) => {
    const next = subtitles[activeIndex + direction];
    if (!next || !videoRef.current) return;
    videoRef.current.currentTime = next.start_seconds;
    videoRef.current.play().catch(() => undefined);
  };

  const completed = lesson.completed_at || (lesson.duration_seconds > 0 && currentTime / lesson.duration_seconds >= 0.9);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <div className="mb-2 flex flex-wrap items-center gap-2">
            <span className="rounded-md border border-blue-500/30 bg-blue-500/10 px-2 py-1 text-xs font-semibold text-blue-300">
              {statusLabels[lesson.status] || lesson.status}
            </span>
            <span className="text-xs text-gray-500">{formatDuration(lesson.duration_seconds)}</span>
            {completed && <span className="text-xs font-semibold text-green-300">已完成</span>}
          </div>
          <h1 className="text-2xl font-black text-gray-100">{lesson.title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <label className="inline-flex cursor-pointer items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900">
            {importing ? <Loader2 className="h-4 w-4 animate-spin" /> : <FileUp className="h-4 w-4" />}
            导入字幕
            <input type="file" accept=".srt,.vtt" onChange={handleSubtitleImport} className="hidden" />
          </label>
          {(lesson.status === 'uploaded' || lesson.status === 'failed') && (
            <button
              type="button"
              onClick={handleProcess}
              disabled={processing}
              className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
            >
              {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
              生成字幕
            </button>
          )}
        </div>
      </div>

      <video
        ref={videoRef}
        src={resolveAPIAssetURL(lesson.video_path)}
        controls
        playsInline
        onTimeUpdate={handleTimeUpdate}
        onPlay={() => {
          lastPlaybackTimeRef.current = videoRef.current?.currentTime ?? null;
        }}
        onSeeking={() => {
          lastPlaybackTimeRef.current = videoRef.current?.currentTime ?? null;
        }}
        onPause={() => {
          lastPlaybackTimeRef.current = null;
          saveProgress(false).catch(() => undefined);
        }}
        onEnded={() => saveProgress(true).catch(() => undefined)}
        className="aspect-video w-full rounded-md bg-black"
      />

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => seekRelative(-5)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
        >
          <SkipBack className="h-4 w-4" />
          5s
        </button>
        <button
          type="button"
          onClick={() => seekSubtitle(-1)}
          disabled={activeIndex <= 0}
          className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
        >
          上一句
        </button>
        <button
          type="button"
          onClick={() => seekSubtitle(1)}
          disabled={activeIndex < 0 || activeIndex >= subtitles.length - 1}
          className="rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-40"
        >
          下一句
        </button>
        <button
          type="button"
          onClick={() => seekRelative(5)}
          className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900"
        >
          5s
          <SkipForward className="h-4 w-4" />
        </button>
        <select
          value={playbackRate}
          onChange={(event) => setPlaybackRate(Number(event.target.value))}
          className="rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm font-semibold text-gray-300 outline-none focus:border-blue-500"
        >
          <option value={0.75}>0.75x</option>
          <option value={1}>1x</option>
          <option value={1.25}>1.25x</option>
          <option value={1.5}>1.5x</option>
        </select>
      </div>

      {isProcessingStatus(lesson.status) && (
        <div className="mt-4 rounded-md border border-blue-500/30 bg-blue-500/10 p-3">
          <div className="mb-2 flex items-center justify-between text-sm text-blue-100">
            <span>{statusLabels[lesson.status]}</span>
            <span>{lesson.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full bg-blue-500" style={{ width: `${Math.max(5, lesson.progress)}%` }} />
          </div>
        </div>
      )}

      {lesson.status === 'failed' && lesson.error && (
        <div className="mt-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-sm leading-6 text-amber-200">
          {lesson.error}
        </div>
      )}
    </div>
  );
}
