'use client';

import { useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { Article } from '@/types';
import { isRemoteHTTPURL, resolveAPIAssetURL } from '@/lib/api';
import { Calendar, Clock, Eye, BookOpen } from 'lucide-react';
import { format } from 'date-fns';
import { zhCN } from 'date-fns/locale';

interface ArticleCardProps {
  article: Article;
}

const difficultyColors = {
  easy: 'bg-green-500/20 text-green-400',
  medium: 'bg-yellow-500/20 text-yellow-400',
  hard: 'bg-red-500/20 text-red-400',
};

const difficultyLabels = {
  easy: '简单',
  medium: '中等',
  hard: '困难',
};

export default function ArticleCard({ article }: ArticleCardProps) {
  const [imageError, setImageError] = useState(false);
  const coverImageURL = article.cover_image ? resolveAPIAssetURL(article.cover_image) : '';
  const shouldBypassImageOptimizer = isRemoteHTTPURL(coverImageURL);

  return (
    <Link
      href={`/articles/${article.slug}`}
      className="block bg-gray-900/50 border border-gray-800 rounded-lg overflow-hidden hover:border-blue-500 transition-all duration-300 group"
    >
      {/* Cover Image */}
      {coverImageURL && !imageError ? (
        <div className="relative h-48 w-full overflow-hidden bg-gray-800">
          <Image
            src={coverImageURL}
            alt={article.title}
            fill
            className="object-cover group-hover:scale-105 transition-transform duration-300"
            unoptimized={shouldBypassImageOptimizer}
            onError={() => setImageError(true)}
          />
        </div>
      ) : (
        <div className="h-48 w-full bg-gradient-to-br from-gray-800 to-gray-900 flex items-center justify-center">
          <BookOpen className="w-16 h-16 text-gray-700" />
        </div>
      )}

      <div className="p-5">
        {/* Category and Difficulty */}
        <div className="flex items-center justify-between mb-3">
          <span className="text-xs font-medium text-blue-400">
            {article.category?.name || article.source || 'MIT Technology Review'}
          </span>
          <span
            className={`text-xs px-2 py-1 rounded ${
              difficultyColors[article.difficulty_level]
            }`}
          >
            {difficultyLabels[article.difficulty_level]}
          </span>
        </div>

        {/* Title */}
        <h3 className="text-lg font-semibold mb-2 line-clamp-2 group-hover:text-blue-400 transition-colors">
          {article.title}
        </h3>

        {/* Summary */}
        {article.summary && (
          <p className="text-sm text-gray-400 line-clamp-2 mb-4">
            {article.summary}
          </p>
        )}

        {/* Chinese Translation */}
        {article.title_cn && (
          <p className="text-xs text-gray-500 mb-4">{article.title_cn}</p>
        )}

        {/* Meta Info */}
        <div className="flex items-center justify-between text-xs text-gray-500">
          <div className="flex items-center space-x-4">
            <div className="flex items-center space-x-1">
              <Calendar className="w-3.5 h-3.5" />
              <span>
                {format(new Date(article.published_at), 'yyyy-MM-dd')}
              </span>
            </div>
            <div className="flex items-center space-x-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{article.reading_time}分钟</span>
            </div>
          </div>
          <div className="flex items-center space-x-1">
            <Eye className="w-3.5 h-3.5" />
            <span>{article.view_count}次</span>
          </div>
        </div>
      </div>
    </Link>
  );
}
