'use client';

import { FormEvent, useRef, useState } from 'react';
import { Upload, Loader2 } from 'lucide-react';
import { videoLessonAPI } from '@/lib/api';
import { VideoLesson } from '@/types';

interface VideoLessonUploaderProps {
  onCreated: (lesson: VideoLesson) => void;
}

export default function VideoLessonUploader({ onCreated }: VideoLessonUploaderProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [source, setSource] = useState('');
  const [sourceURL, setSourceURL] = useState('');
  const [description, setDescription] = useState('');
  const [autoProcess, setAutoProcess] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!file) {
      setError('请选择视频或音频文件');
      return;
    }

    const data = new FormData();
    data.append('file', file);
    data.append('title', title.trim());
    data.append('source', source.trim());
    data.append('source_url', sourceURL.trim());
    data.append('description', description.trim());
    data.append('language', 'en');
    data.append('auto_process', String(autoProcess));

    try {
      setUploading(true);
      setError('');
      const response = await videoLessonAPI.create(data);
      onCreated(response.data.data as VideoLesson);
      setFile(null);
      setTitle('');
      setSource('');
      setSourceURL('');
      setDescription('');
      if (inputRef.current) inputRef.current.value = '';
    } catch (err: any) {
      setError(err.response?.data?.error || '上传失败');
    } finally {
      setUploading(false);
    }
  };

  return (
    <form onSubmit={handleSubmit} className="rounded-lg border border-gray-800 bg-gray-900/60 p-5">
      <div className="mb-4 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-md bg-blue-600 text-white">
          <Upload className="h-5 w-5" />
        </div>
        <div>
          <h2 className="text-xl font-bold text-gray-100">上传视频学习资料</h2>
          <p className="text-sm text-gray-500">支持 MP4、WebM、MOV、MP3、M4A，上传后自动生成英文字幕。</p>
        </div>
      </div>

      {error && (
        <div className="mb-4 rounded-md border border-red-500/40 bg-red-500/10 px-3 py-2 text-sm text-red-200">
          {error}
        </div>
      )}

      <div className="grid gap-3 lg:grid-cols-2">
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-gray-400">视频或音频文件</span>
          <input
            ref={inputRef}
            type="file"
            accept=".mp4,.mov,.m4v,.webm,.mp3,.m4a,video/*,audio/*"
            onChange={(event) => setFile(event.target.files?.[0] || null)}
            className="block w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-sm text-gray-300 file:mr-3 file:rounded-md file:border-0 file:bg-blue-600 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-blue-500"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-gray-400">标题</span>
          <input
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            placeholder={file ? file.name.replace(/\.[^.]+$/, '') : '例如 TED 演讲标题'}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="block">
          <span className="mb-2 block text-sm font-semibold text-gray-400">来源</span>
          <input
            value={source}
            onChange={(event) => setSource(event.target.value)}
            placeholder="TED、课程、访谈"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-gray-400">来源链接</span>
          <input
            value={sourceURL}
            onChange={(event) => setSourceURL(event.target.value)}
            placeholder="可选"
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-2 block text-sm font-semibold text-gray-400">备注</span>
          <textarea
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={3}
            className="w-full rounded-md border border-gray-700 bg-gray-950 px-3 py-2 text-gray-100 outline-none focus:border-blue-500"
          />
        </label>
      </div>

      <div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <label className="inline-flex items-center gap-2 text-sm text-gray-400">
          <input
            type="checkbox"
            checked={autoProcess}
            onChange={(event) => setAutoProcess(event.target.checked)}
            className="h-4 w-4 rounded border-gray-700 bg-gray-950"
          />
          上传后自动生成字幕
        </label>
        <button
          type="submit"
          disabled={uploading}
          className="inline-flex items-center justify-center gap-2 rounded-md bg-blue-600 px-4 py-2 text-sm font-semibold text-white hover:bg-blue-500 disabled:opacity-50"
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          上传
        </button>
      </div>
    </form>
  );
}
