'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { BookOpen, Bot, Lightbulb, Loader2, MessageSquare, Plus, Send, Sparkles, Target, Trash2 } from 'lucide-react';
import { vocabularyAPI, videoLessonAPI } from '@/lib/api';
import { formatVideoTime } from '@/lib/videoSubtitles';
import { VideoConversationMessage, VideoKeyPoint, VideoLesson, VideoUnderstanding, VideoVocabulary } from '@/types';
import Toast from './Toast';

interface Props {
  lesson: VideoLesson;
  onSeek: (seconds: number) => void;
}

export default function VideoUnderstandingPanel({ lesson, onSeek }: Props) {
  const [understanding, setUnderstanding] = useState<VideoUnderstanding | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [conversations, setConversations] = useState<VideoConversationMessage[]>([]);
  const [message, setMessage] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [activeTab, setActiveTab] = useState<'summary' | 'keypoints' | 'vocab' | 'chat'>('summary');
  const [toastMessage, setToastMessage] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [conversations]);

  const loadUnderstanding = useCallback(async () => {
    try {
      setLoading(true);
      setError('');
      const response = await videoLessonAPI.getUnderstanding(lesson.id);
      const data = response.data.data as VideoUnderstanding;
      setUnderstanding(data);
    } catch (err: any) {
      if (err.response?.status !== 404) {
        setError(err.response?.data?.error || '加载失败');
      }
    } finally {
      setLoading(false);
    }
  }, [lesson.id]);

  const loadConversations = useCallback(async () => {
    try {
      const response = await videoLessonAPI.getConversations(lesson.id);
      setConversations(response.data.data || []);
    } catch (err: any) {
      console.error('加载对话历史失败', err);
    }
  }, [lesson.id]);

  useEffect(() => {
    loadUnderstanding();
    loadConversations();
  }, [loadUnderstanding, loadConversations]);

  const handleGenerate = async () => {
    try {
      setGenerating(true);
      setError('');
      const response = await videoLessonAPI.generateUnderstanding(lesson.id, {
        force: false,
        include_vocabulary: true,
        include_key_points: true,
      });
      const data = response.data.data as VideoUnderstanding;
      setUnderstanding(data);
    } catch (err: any) {
      setError(err.response?.data?.error || '生成失败');
    } finally {
      setGenerating(false);
    }
  };

  const handleSendMessage = async () => {
    if (!message.trim() || !understanding) return;

    const userMessage = message.trim();
    setMessage('');

    const optimisticUserMsg: VideoConversationMessage = {
      id: Date.now(),
      role: 'user',
      content: userMessage,
      created_at: new Date().toISOString(),
    };

    setConversations(prev => [...prev, optimisticUserMsg, {
      id: Date.now() + 1,
      role: 'assistant',
      content: '',
      created_at: new Date().toISOString()
    }]);
    setSending(true);
    setError('');

    try {
      const messages = [
        ...conversations.map(c => ({ role: c.role, content: c.content })),
        { role: 'user' as const, content: userMessage },
      ];

      await videoLessonAPI.chatWithVideoStream(lesson.id, messages, (delta) => {
        setConversations(prev => {
          const newConvs = [...prev];
          newConvs[newConvs.length - 1] = {
            ...newConvs[newConvs.length - 1],
            content: newConvs[newConvs.length - 1].content + delta
          };
          return newConvs;
        });
      });

      await loadConversations();
    } catch (err: any) {
      setError(err.message || '发送失败');
      setConversations(prev => prev.slice(0, -2));
    } finally {
      setSending(false);
    }
  };

  const handleAddToVocabulary = async (vocab: VideoVocabulary) => {
    try {
      await vocabularyAPI.addWord({
        word: vocab.word,
        translation: vocab.translation,
        context: vocab.context,
      });
      setToastMessage(`「${vocab.word}」已加入生词本`);
    } catch (err: any) {
      setToastMessage(err.response?.data?.error || '添加失败');
    }
  };

  const handleClearConversations = async () => {
    if (!window.confirm('确定清空对话历史？')) return;
    try {
      await videoLessonAPI.clearConversations(lesson.id);
      setConversations([]);
    } catch (err: any) {
      setError(err.response?.data?.error || '清空失败');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-gray-500 dark:text-gray-400">
        <Loader2 className="mr-2 h-5 w-5 animate-spin" />
        加载中...
      </div>
    );
  }

  if (!understanding) {
    return (
      <div className="py-8 text-center">
        <Sparkles className="mx-auto h-12 w-12 text-gray-400 dark:text-gray-600" />
        <h3 className="mt-4 text-lg font-medium text-gray-950 dark:text-white">视频理解</h3>
        <p className="mt-2 text-sm text-gray-600 dark:text-gray-400">
          AI 将分析视频内容，生成摘要、关键点和重点词汇
        </p>
        {error && (
          <div className="mx-auto mt-4 max-w-md rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
            {error}
          </div>
        )}
        <button
          onClick={handleGenerate}
          disabled={generating}
          className="mt-6 inline-flex items-center gap-2 rounded-md bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-700 disabled:opacity-60"
        >
          {generating ? (
            <>
              <Loader2 className="h-4 w-4 animate-spin" />
              AI 正在理解视频...
            </>
          ) : (
            <>
              <Sparkles className="h-4 w-4" />
              生成视频理解
            </>
          )}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {toastMessage && <Toast message={toastMessage} onClose={() => setToastMessage('')} />}
      <div className="flex items-center gap-2 border-b border-gray-200 dark:border-gray-800">
        <button
          onClick={() => setActiveTab('summary')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'summary'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <BookOpen className="inline h-4 w-4 mr-1" />
          摘要
        </button>
        <button
          onClick={() => setActiveTab('keypoints')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'keypoints'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Target className="inline h-4 w-4 mr-1" />
          关键点
        </button>
        <button
          onClick={() => setActiveTab('vocab')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'vocab'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <Lightbulb className="inline h-4 w-4 mr-1" />
          词汇
        </button>
        <button
          onClick={() => setActiveTab('chat')}
          className={`px-4 py-2 text-sm font-medium ${
            activeTab === 'chat'
              ? 'border-b-2 border-teal-600 text-teal-600'
              : 'text-gray-600 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-200'
          }`}
        >
          <MessageSquare className="inline h-4 w-4 mr-1" />
          AI 对话
        </button>
      </div>

      {error && (
        <div className="rounded-md bg-red-50 p-3 text-sm text-red-800 dark:bg-red-900/20 dark:text-red-200">
          {error}
        </div>
      )}

      {activeTab === 'summary' && (
        <div className="space-y-4">
          <div>
            <h3 className="mb-2 font-medium text-gray-950 dark:text-white">英文摘要</h3>
            <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">{understanding.summary_en}</p>
          </div>
          <div>
            <h3 className="mb-2 font-medium text-gray-950 dark:text-white">中文摘要</h3>
            <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">{understanding.summary_cn}</p>
          </div>
          <div>
            <h3 className="mb-2 font-medium text-gray-950 dark:text-white">主题</h3>
            <div className="flex flex-wrap gap-2">
              {understanding.topics.map((topic, i) => (
                <span
                  key={i}
                  className="rounded-full bg-teal-100 px-3 py-1 text-xs font-medium text-teal-700 dark:bg-teal-900/30 dark:text-teal-300"
                >
                  {topic}
                </span>
              ))}
            </div>
          </div>
          <div>
            <h3 className="mb-2 font-medium text-gray-950 dark:text-white">学习建议</h3>
            <p className="text-sm leading-7 text-gray-700 dark:text-gray-300">{understanding.study_guide}</p>
          </div>
        </div>
      )}

      {activeTab === 'keypoints' && (
        <div className="space-y-3">
          {understanding.key_points.map((kp: VideoKeyPoint, i: number) => (
            <div
              key={i}
              className="cursor-pointer rounded-lg border border-gray-200 p-3 hover:border-teal-500 hover:bg-teal-50/50 dark:border-gray-800 dark:hover:border-teal-800 dark:hover:bg-teal-950/20"
              onClick={() => onSeek(kp.timestamp)}
            >
              <div className="mb-1 flex items-center gap-2">
                <span className="text-xs font-medium text-teal-600 dark:text-teal-400">
                  {formatVideoTime(kp.timestamp)}
                </span>
                <h4 className="font-medium text-gray-950 dark:text-white">{kp.title}</h4>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-400">{kp.content}</p>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'vocab' && (
        <div className="space-y-2">
          {understanding.vocabulary.map((vocab: VideoVocabulary, i: number) => (
            <div
              key={i}
              className="flex items-start gap-3 rounded-lg border border-gray-200 p-3 dark:border-gray-800"
            >
              <div className="flex-1">
                <div className="mb-1 flex items-center gap-2">
                  <span className="font-medium text-gray-950 dark:text-white">{vocab.word}</span>
                  <span className="text-sm text-gray-600 dark:text-gray-400">{vocab.translation}</span>
                  <button
                    onClick={() => onSeek(vocab.timestamp)}
                    className="ml-auto text-xs text-teal-600 hover:underline dark:text-teal-400"
                  >
                    {formatVideoTime(vocab.timestamp)}
                  </button>
                </div>
                <p className="text-sm italic text-gray-600 dark:text-gray-400">{vocab.context}</p>
              </div>
              <button
                onClick={() => handleAddToVocabulary(vocab)}
                className="rounded-md p-1 text-gray-500 hover:bg-gray-100 hover:text-teal-600 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-teal-400"
                title="加入生词本"
              >
                <Plus className="h-4 w-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {activeTab === 'chat' && (
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-medium text-gray-950 dark:text-white">AI 助手</h3>
            {conversations.length > 0 && (
              <button
                onClick={handleClearConversations}
                className="text-xs text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400"
              >
                <Trash2 className="inline h-3 w-3 mr-1" />
                清空历史
              </button>
            )}
          </div>

          <div className="flex h-[500px] flex-col rounded-lg border border-gray-200 bg-gray-50 dark:border-gray-800 dark:bg-gray-900">
            <div className="flex-1 space-y-3 overflow-y-auto p-4">
              {conversations.length === 0 ? (
                <div className="flex h-full items-center justify-center text-center text-sm text-gray-500 dark:text-gray-400">
                  <div>
                    <Bot className="mx-auto mb-2 h-8 w-8 text-gray-400" />
                    向 AI 提问视频相关内容
                  </div>
                </div>
              ) : (
                <>
                  {conversations.map((msg, idx) => (
                    <div
                      key={`${msg.id}-${idx}`}
                      className={`flex gap-2 ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}
                    >
                      {msg.role === 'assistant' && (
                        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-teal-100 dark:bg-teal-900/30">
                          <Bot className="h-4 w-4 text-teal-600 dark:text-teal-400" />
                        </div>
                      )}
                      <div
                        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
                          msg.role === 'user'
                            ? 'bg-teal-600 text-white'
                            : 'bg-white text-gray-900 dark:bg-gray-800 dark:text-gray-100'
                        }`}
                      >
                        <p className="whitespace-pre-wrap text-sm leading-6">
                          {msg.content || (sending ? '思考中...' : '...')}
                        </p>
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </>
              )}
            </div>

            <div className="border-t border-gray-200 p-3 dark:border-gray-800">
              <div className="flex gap-2">
                <input
                  type="text"
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSendMessage();
                    }
                  }}
                  placeholder="询问视频相关问题..."
                  disabled={sending}
                  className="flex-1 rounded-md border border-gray-300 px-3 py-2 text-sm focus:border-teal-600 focus:outline-none focus:ring-1 focus:ring-teal-600 disabled:opacity-50 dark:border-gray-700 dark:bg-gray-800 dark:text-white"
                />
                <button
                  onClick={handleSendMessage}
                  disabled={sending || !message.trim()}
                  className="rounded-md bg-teal-600 px-4 py-2 text-white hover:bg-teal-700 disabled:opacity-60"
                >
                  {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
