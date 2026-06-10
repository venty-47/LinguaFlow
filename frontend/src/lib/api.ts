import axios from 'axios';
import { AdminArticleInput } from '@/types';

export const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8080/api';
export const API_ORIGIN = API_URL.replace(/\/api\/?$/, '');

function authHeaders(): Record<string, string> {
  const token = localStorage.getItem('token');
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export function resolveAPIAssetURL(path: string) {
  if (/^https?:\/\//i.test(path)) return path;
  return `${API_ORIGIN}${path.startsWith('/') ? path : `/${path}`}`;
}

export function isRemoteHTTPURL(path: string) {
  return /^https?:\/\//i.test(path);
}

const api = axios.create({
  baseURL: API_URL,
});

function postForm(url: string, data: FormData) {
  return api.post(url, data);
}

// 请求拦截器 - 添加 token
api.interceptors.request.use(
  (config) => {
    const token = localStorage.getItem('token');
    if (token) {
      config.headers.Authorization = `Bearer ${token}`;
    }
    return config;
  },
  (error) => {
    return Promise.reject(error);
  }
);

// 响应拦截器 - 处理错误
api.interceptors.response.use(
  (response) => response,
  (error) => {
    if (error.response?.status === 401) {
      // Token 过期或无效，清除本地存储
      localStorage.removeItem('token');
      localStorage.removeItem('user');
      window.location.href = '/login';
    }
    return Promise.reject(error);
  }
);

// 认证 API
export const authAPI = {
  register: (data: { username: string; email: string; password: string; nickname?: string }) =>
    api.post('/auth/register', data),
  login: (data: { email: string; password: string }) =>
    api.post('/auth/login', data),
  getProfile: () =>
    api.get('/profile'),
  uploadAvatar: (data: FormData) =>
    postForm('/profile/avatar', data),
};

// 文章 API
export const articleAPI = {
  getArticles: (params?: {
    page?: number;
    page_size?: number;
    category?: string;
    difficulty?: string;
    source?: string;
    search?: string;
  }) => api.get('/articles', { params }),
  getFeaturedArticles: (limit?: number) =>
    api.get('/articles/featured', { params: { limit } }),
  getArticleBySlug: (slug: string) =>
    api.get(`/articles/${slug}`),
  updateReadProgress: (id: number, data: { progress: number; read_time: number }) =>
    api.post(`/articles/${id}/progress`, data),
  discussWithAssistant: (
    id: number,
    data: { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  ) => api.post(`/articles/${id}/assistant`, data),
  streamAssistant: (
    id: number,
    data: { messages: Array<{ role: 'user' | 'assistant'; content: string }> }
  ) =>
    fetch(`${API_URL}/articles/${id}/assistant`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...authHeaders(),
      },
      body: JSON.stringify(data),
    }),
  getCompletion: (id: number) =>
    api.get(`/article-completions/${id}`),
  getKnowledgeGraph: (id: number) =>
    api.get(`/article-knowledge-graph/${id}`),
  getStudyNote: (id: number) =>
    api.get(`/article-notes/${id}`),
  generateStudyNote: (id: number, force = false) =>
    api.post(`/article-notes/${id}`, { force }),
  getQuiz: (id: number) =>
    api.get(`/article-quizzes/${id}`),
  submitQuiz: (id: number, answers: number[]) =>
    api.post(`/article-quizzes/${id}/submit`, { answers }),
};

// 分类 API
export const categoryAPI = {
  getCategories: () => api.get('/categories'),
};

// RSS API
export const rssAPI = {
  getFeeds: () => api.get('/rss/feeds'),
  importFeeds: () => api.post('/admin/rss/import'),
};

export const ao3API = {
  search: (params: { q: string; page?: number }) =>
    api.get('/ao3/search', { params }),
  getWork: (id: string) =>
    api.get(`/ao3/works/${id}`),
};

export const adminArticleAPI = {
  getArticles: (params?: {
    page?: number;
    page_size?: number;
    status?: string;
    category?: string;
    source?: string;
    search?: string;
  }) => api.get('/admin/articles', { params }),
  getArticle: (id: number) => api.get(`/admin/articles/${id}`),
  createArticle: (data: AdminArticleInput) => api.post('/admin/articles', data),
  updateArticle: (id: number, data: AdminArticleInput) => api.put(`/admin/articles/${id}`, data),
  updateStatus: (id: number, status: 'draft' | 'published' | 'archived') =>
    api.patch(`/admin/articles/${id}/status`, { status }),
  updateFeatured: (id: number, is_featured: boolean) =>
    api.patch(`/admin/articles/${id}/featured`, { is_featured }),
  deleteArticle: (id: number) => api.delete(`/admin/articles/${id}`),
};

// 翻译 API
export const translationAPI = {
  translate: (data: { text: string; target_lang: string; source_lang?: string; article_id?: number; context?: string }) =>
    api.post('/translate', data),
  lookupWord: (word: string, params?: { article_id?: number; context?: string }) =>
    api.get('/dictionary', { params: { word, ...params } }),
  analyzeSentence: (text: string, data?: { article_id?: number; context?: string }) =>
    api.post('/sentences/analyze', { text, ...data }),
};

export const ttsAPI = {
  generateSpeech: (data: {
    text: string;
    voice?: string;
    speed?: number;
    format?: string;
    instructions?: string;
  }) => api.post('/tts', data),
};

export const videoLessonAPI = {
  upload: (data: FormData) =>
    postForm('/video-lessons', data),
  getLessons: (params?: { page?: number; page_size?: number; status?: string }) =>
    api.get('/video-lessons', { params }),
  getLesson: (id: number) =>
    api.get(`/video-lessons/${id}`),
  deleteLesson: (id: number) =>
    api.delete(`/video-lessons/${id}`),
  regenerateSubtitles: (id: number) =>
    api.post(`/video-lessons/${id}/regenerate-subtitles`),
  getSubtitles: (id: number) =>
    api.get(`/video-lessons/${id}/subtitles`),
  getSubtitleVTTURL: (id: number) =>
    `${API_URL}/video-lessons/${id}/subtitles.vtt`,
  updateProgress: (id: number, data: { position_seconds: number; completed?: boolean }) =>
    api.post(`/video-lessons/${id}/progress`, data),
};

// 生词本 API
export const vocabularyAPI = {
  getVocabulary: (params?: { due?: boolean; article_id?: number; weak?: boolean }) =>
    api.get('/vocabulary', { params }),
  getReviewExercises: (params?: { due?: boolean; weak?: boolean; limit?: number }) =>
    api.get('/vocabulary/review-exercises', { params }),
  getKnowledgeGraph: (id: number) =>
    api.get(`/vocabulary/${id}/knowledge-graph`),
  addWord: (data: {
    word: string;
    article_id?: number;
    context?: string;
    phonetic?: string;
    definition?: string;
    translation?: string;
    examples?: string;
  }) => api.post('/vocabulary', data),
  markLearned: (id: number) =>
    api.patch(`/vocabulary/${id}/learned`),
  reviewWord: (id: number, rating: 'forgot' | 'hard' | 'good') =>
    api.post(`/vocabulary/${id}/review`, { rating }),
  deleteWord: (id: number) =>
    api.delete(`/vocabulary/${id}`),
  submitAnswer: (id: number, data: { type: string; answer: string }) =>
    api.post(`/vocabulary/${id}/review-answer`, data),
};

export const knowledgeGraphAPI = {
  getOverview: () =>
    api.get('/knowledge-graph/overview'),
  refresh: () =>
    api.post('/knowledge-graph/refresh'),
  getGraph: (params?: {
    focus_type?: string;
    focus_id?: number;
    focus_key?: string;
    depth?: number;
    limit?: number;
    types?: string;
    search?: string;
  }) => api.get('/knowledge-graph', { params }),
};

// 订阅 API
export const subscriptionAPI = {
  getSubscriptions: () => api.get('/subscriptions'),
  addSubscription: (article_id: number) =>
    api.post('/subscriptions', { article_id }),
  removeSubscription: (article_id: number) =>
    api.delete(`/subscriptions/${article_id}`),
};

// 会员 API
export const membershipAPI = {
  getInfo: () => api.get('/membership/info'),
  getPlans: () => api.get('/membership/plans'),
  getBenefits: () => api.get('/membership/benefits'),
  createOrder: (product_type: 'monthly' | 'yearly' | 'lifetime') =>
    api.post('/membership/orders', { product_type }),
  getOrders: () => api.get('/membership/orders'),
  activateOrder: (order_no: string) =>
    api.post(`/membership/orders/${order_no}/activate`),
};

// 历史记录 API
export const historyAPI = {
  getReadHistory: () => api.get('/history'),
};

// 学习闭环 API
export const studyAPI = {
  getToday: () => api.get('/study/today'),
  getDiagnostics: () => api.get('/study/diagnostics'),
  updateGoal: (data: {
    daily_read_minutes: number;
    daily_review_words: number;
    daily_articles: number;
  }) => api.put('/study/goal', data),
};

export default api;
