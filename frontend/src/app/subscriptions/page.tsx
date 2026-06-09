'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import ArticleCard from '@/components/ArticleCard';
import { subscriptionAPI } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import { Subscription } from '@/types';
import { Loader2 } from 'lucide-react';

export default function SubscriptionsPage() {
  const router = useRouter();
  const { isAuthenticated, token } = useAuthStore();
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([]);
  const [loading, setLoading] = useState(true);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!mounted) return;

    if (!isAuthenticated || !token) {
      router.replace('/login');
      return;
    }

    const fetchSubscriptions = async () => {
      try {
        setLoading(true);
        const response = await subscriptionAPI.getSubscriptions();
        setSubscriptions(response.data.data);
      } catch (err) {
        console.error('Failed to fetch subscriptions:', err);
      } finally {
        setLoading(false);
      }
    };

    fetchSubscriptions();
  }, [isAuthenticated, mounted, router, token]);

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-gray-500" />
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-7xl px-4 py-10 sm:px-6 lg:px-8">
      <div className="mb-8">
        <h1 className="mb-2 text-3xl font-black">我的收藏</h1>
        <p className="text-gray-500">这里汇总你收藏过的文章。</p>
      </div>

      {subscriptions.length === 0 ? (
        <div className="rounded-lg border border-gray-800 bg-gray-900/40 p-10 text-center text-gray-500">
          还没有收藏文章。打开文章详情页，点击“收藏”即可添加。
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-3">
          {subscriptions.map((subscription) =>
            subscription.article ? (
              <ArticleCard key={subscription.id} article={subscription.article} />
            ) : null
          )}
        </div>
      )}
    </div>
  );
}
