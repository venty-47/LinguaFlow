'use client';

import Link from 'next/link';
import { Clock3, FileVideo, Loader2, Play, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import { VideoLesson } from '@/types';

interface VideoLessonCardProps {
  lesson: VideoLesson;
  onProcess: (lesson: VideoLesson) => void;
  onDelete: (lesson: VideoLesson) => void;
  processing?: boolean;
}

const statusLabels: Record<string, string> = {
  uploaded: '已上传',
  extracting_audio: '提取音频',
  transcribing: '生成字幕',
  segmenting: '整理字幕',
  ready: '可学习',
  failed: '处理失败',
  cancelled: '已取消',
};

export function formatDuration(seconds: number) {
  if (!seconds || seconds < 0) return '未知时长';
  const total = Math.round(seconds);
  const mins = Math.floor(total / 60);
  const secs = total % 60;
  const hours = Math.floor(mins / 60);
  const restMins = mins % 60;
  if (hours > 0) return `${hours}:${String(restMins).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
  return `${restMins}:${String(secs).padStart(2, '0')}`;
}

export function isProcessingStatus(status: string) {
  return status === 'extracting_audio' || status === 'transcribing' || status === 'segmenting';
}

export default function VideoLessonCard({ lesson, onProcess, onDelete, processing }: VideoLessonCardProps) {
  const isReady = lesson.status === 'ready';
  const isFailed = lesson.status === 'failed';
  const inProgress = isProcessingStatus(lesson.status);

  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-4">
      <div className="mb-4 flex items-start gap-3">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-md bg-gray-800 text-blue-300">
          <FileVideo className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-bold text-gray-100">{lesson.title}</h3>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-gray-500">
            <span>{statusLabels[lesson.status] || lesson.status}</span>
            <span>·</span>
            <span>{formatDuration(lesson.duration_seconds)}</span>
            {lesson.source && (
              <>
                <span>·</span>
                <span>{lesson.source}</span>
              </>
            )}
          </div>
        </div>
      </div>

      {inProgress && (
        <div className="mb-4">
          <div className="mb-2 flex items-center justify-between text-xs text-gray-400">
            <span>处理进度</span>
            <span>{lesson.progress}%</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-gray-800">
            <div className="h-full bg-blue-500" style={{ width: `${Math.max(5, lesson.progress)}%` }} />
          </div>
        </div>
      )}

      {isFailed && lesson.error && (
        <div className="mb-4 rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs leading-5 text-amber-200">
          <div className="mb-1 flex items-center gap-1.5 font-semibold">
            <TriangleAlert className="h-3.5 w-3.5" />
            字幕生成失败
          </div>
          {lesson.error}
        </div>
      )}

      {lesson.last_position_seconds > 0 && (
        <div className="mb-4 flex items-center gap-2 text-xs text-gray-500">
          <Clock3 className="h-3.5 w-3.5" />
          上次学到 {formatDuration(lesson.last_position_seconds)}
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        <Link
          href={`/study/videos/${lesson.id}`}
          className="inline-flex items-center gap-2 rounded-md bg-blue-600 px-3 py-2 text-sm font-semibold text-white hover:bg-blue-500"
        >
          <Play className="h-4 w-4" />
          {isReady ? '开始学习' : '查看'}
        </Link>
        {(lesson.status === 'uploaded' || isFailed) && (
          <button
            type="button"
            onClick={() => onProcess(lesson)}
            disabled={processing}
            className="inline-flex items-center gap-2 rounded-md border border-gray-700 px-3 py-2 text-sm font-semibold text-gray-300 hover:bg-gray-900 disabled:opacity-50"
          >
            {processing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RotateCcw className="h-4 w-4" />}
            生成字幕
          </button>
        )}
        <button
          type="button"
          onClick={() => onDelete(lesson)}
          className="inline-flex items-center gap-2 rounded-md border border-red-500/40 px-3 py-2 text-sm font-semibold text-red-200 hover:bg-red-500/10"
        >
          <Trash2 className="h-4 w-4" />
          删除
        </button>
      </div>
    </div>
  );
}
