'use client';

import { useEffect, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { authAPI, resolveAPIAssetURL } from '@/lib/api';
import { useAuthStore } from '@/store/authStore';
import {
  BookOpen,
  Camera,
  Clock,
  Crown,
  Loader2,
  LogOut,
  Mail,
  User,
  UserCircle,
} from 'lucide-react';
import { format } from 'date-fns';
import Toast from '@/components/Toast';

interface Profile {
  id: number;
  username: string;
  email: string;
  nickname?: string;
  avatar?: string;
  is_admin: boolean;
  is_premium: boolean;
  membership_type?: 'free' | 'monthly' | 'yearly' | 'lifetime';
  membership_expiry?: string | null;
  total_read_time: number;
  articles_read: number;
  words_learned: number;
  created_at: string;
}

export default function ProfilePage() {
  const router = useRouter();
  const { user, token, isAuthenticated, logout, updateUser } = useAuthStore();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [avatarUploading, setAvatarUploading] = useState(false);
  const [error, setError] = useState('');
  const [avatarError, setAvatarError] = useState('');
  const [avatarSuccess, setAvatarSuccess] = useState('');
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

    const fetchProfile = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await authAPI.getProfile();
        const data = response.data.data as Profile;
        setProfile(data);
        updateUser({
          username: data.username,
          email: data.email,
          nickname: data.nickname,
          avatar: data.avatar,
          is_admin: data.is_admin,
          is_premium: data.is_premium,
          membership_type: data.membership_type,
          membership_expiry: data.membership_expiry,
        });
      } catch (err: any) {
        setError(err.response?.data?.error || '个人资料加载失败');
      } finally {
        setLoading(false);
      }
    };

    fetchProfile();
  }, [isAuthenticated, mounted, router, token, updateUser]);

  const handleLogout = () => {
    logout();
    router.push('/login');
  };

  const handleAvatarChange = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';

    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setAvatarError('请选择图片文件');
      return;
    }

    if (file.size > 2 * 1024 * 1024) {
      setAvatarError('头像图片不能超过 2MB');
      return;
    }

    try {
      setAvatarUploading(true);
      setAvatarError('');
      setAvatarSuccess('');

      const formData = new FormData();
      formData.append('avatar', file);
      const response = await authAPI.uploadAvatar(formData);
      const avatar = response.data.data.avatar as string;

      setProfile((current) => (current ? { ...current, avatar } : current));
      updateUser({ avatar });
      setAvatarSuccess('头像上传成功');
    } catch (err: any) {
      setAvatarError(err.response?.data?.error || '头像上传失败');
    } finally {
      setAvatarUploading(false);
    }
  };

  if (!mounted || loading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-blue-500" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl px-4 py-16 sm:px-6 lg:px-8">
        <div className="rounded-lg border border-red-500/40 bg-red-500/10 p-6">
          <h1 className="mb-2 text-2xl font-bold">无法加载个人中心</h1>
          <p className="mb-6 text-sm text-red-200">{error}</p>
          <Link
            href="/login"
            className="inline-flex rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium hover:bg-blue-700"
          >
            重新登录
          </Link>
        </div>
      </div>
    );
  }

  const displayUser = profile || user;

  if (!displayUser) return null;

  const membershipLabel: Record<string, string> = {
    free: '免费用户',
    monthly: '月度会员',
    yearly: '年度会员',
    lifetime: '终身会员',
  };

  const membershipType = displayUser.membership_type || 'free';
  const membershipExpiry =
    membershipType === 'lifetime'
      ? '永久有效'
      : displayUser.membership_expiry
        ? format(new Date(displayUser.membership_expiry), 'yyyy-MM-dd')
        : '未开通';

  const stats = [
    {
      label: '阅读时长',
      value: `${profile?.total_read_time ?? 0} 分钟`,
      icon: Clock,
    },
    {
      label: '已读文章',
      value: `${profile?.articles_read ?? 0} 篇`,
      icon: BookOpen,
    },
    {
      label: '已学单词',
      value: `${profile?.words_learned ?? 0} 个`,
      icon: UserCircle,
    },
  ];
  const avatarURL = displayUser.avatar ? resolveAPIAssetURL(displayUser.avatar) : '';

  return (
    <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <section className="mb-8 rounded-lg border border-gray-800 bg-gray-900/50 p-6">
        <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-4">
            <div className="relative h-16 w-16 shrink-0">
              {avatarURL ? (
                <Image
                  src={avatarURL}
                  alt="用户头像"
                  width={64}
                  height={64}
                  unoptimized
                  className="h-16 w-16 rounded-full object-cover ring-2 ring-gray-800"
                />
              ) : (
                <div className="flex h-16 w-16 items-center justify-center rounded-full bg-blue-600 text-2xl font-bold ring-2 ring-gray-800">
                  {(displayUser.nickname || displayUser.username).slice(0, 1).toUpperCase()}
                </div>
              )}
              <label className="absolute -bottom-1 -right-1 flex h-8 w-8 cursor-pointer items-center justify-center rounded-full border border-gray-700 bg-gray-950 text-gray-200 transition-colors hover:border-blue-500 hover:text-blue-300">
                {avatarUploading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Camera className="h-4 w-4" />
                )}
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  className="sr-only"
                  disabled={avatarUploading}
                  onChange={handleAvatarChange}
                />
              </label>
            </div>
            <div>
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <h1 className="text-3xl font-bold">
                  {displayUser.nickname || displayUser.username}
                </h1>
                {displayUser.is_premium && (
                  <span className="inline-flex items-center gap-1 rounded-full bg-yellow-500/10 px-3 py-1 text-xs font-medium text-yellow-300">
                    <Crown className="h-3.5 w-3.5" />
                    高级会员
                  </span>
                )}
              </div>
              <p className="text-sm text-gray-400">
                @{displayUser.username}
                {profile?.created_at
                  ? ` · 加入于 ${format(new Date(profile.created_at), 'yyyy-MM-dd')}`
                  : ''}
              </p>
              {avatarError && <p className="mt-2 text-sm text-red-300">{avatarError}</p>}
            </div>
          </div>
          <button
            onClick={handleLogout}
            className="inline-flex items-center justify-center gap-2 rounded-lg border border-gray-700 px-4 py-2 text-sm font-medium text-red-300 transition-colors hover:border-red-500 hover:bg-red-500/10"
          >
            <LogOut className="h-4 w-4" />
            退出登录
          </button>
        </div>
      </section>

      <section className="mb-8 grid grid-cols-1 gap-4 md:grid-cols-3">
        {stats.map((item) => {
          const Icon = item.icon;
          return (
            <div
              key={item.label}
              className="rounded-lg border border-gray-800 bg-gray-900/50 p-5"
            >
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-blue-600/20 text-blue-400">
                <Icon className="h-5 w-5" />
              </div>
              <p className="mb-1 text-sm text-gray-400">{item.label}</p>
              <p className="text-2xl font-bold">{item.value}</p>
            </div>
          );
        })}
      </section>

      <section className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="mb-5 text-xl font-bold">账号信息</h2>
          <div className="space-y-4">
            <div className="flex items-center gap-3 rounded-lg bg-gray-950/50 p-4">
              <User className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">用户名</p>
                <p className="font-medium">{displayUser.username}</p>
              </div>
            </div>
            <div className="flex items-center gap-3 rounded-lg bg-gray-950/50 p-4">
              <Mail className="h-5 w-5 text-gray-500" />
              <div>
                <p className="text-xs text-gray-500">邮箱</p>
                <p className="font-medium">{displayUser.email}</p>
              </div>
            </div>
            <Link
              href="/membership"
              className="flex items-center justify-between gap-4 rounded-lg bg-gray-950/50 p-4 transition-colors hover:bg-gray-800"
            >
              <div className="flex items-center gap-3">
                <Crown className="h-5 w-5 text-yellow-400" />
                <div>
                  <p className="text-xs text-gray-500">会员状态</p>
                  <p className="font-medium">{membershipLabel[membershipType]}</p>
                </div>
              </div>
              <span className="text-right text-sm text-gray-500">{membershipExpiry}</span>
            </Link>
          </div>
        </div>

        <div className="rounded-lg border border-gray-800 bg-gray-900/50 p-6">
          <h2 className="mb-5 text-xl font-bold">学习入口</h2>
          <div className="space-y-3">
            <Link
              href="/vocabulary"
              className="flex items-center justify-between rounded-lg bg-gray-950/50 p-4 transition-colors hover:bg-gray-800"
            >
              <span className="font-medium">我的生词本</span>
              <span className="text-sm text-gray-500">查看收藏单词</span>
            </Link>
            <Link
              href="/"
              className="flex items-center justify-between rounded-lg bg-gray-950/50 p-4 transition-colors hover:bg-gray-800"
            >
              <span className="font-medium">继续阅读</span>
              <span className="text-sm text-gray-500">浏览英文文章</span>
            </Link>
            <Link
              href="/membership"
              className="flex items-center justify-between rounded-lg bg-gray-950/50 p-4 transition-colors hover:bg-gray-800"
            >
              <span className="font-medium">会员中心</span>
              <span className="text-sm text-gray-500">权益与续费</span>
            </Link>
          </div>
        </div>
      </section>
      {avatarSuccess && <Toast message={avatarSuccess} onClose={() => setAvatarSuccess('')} />}
    </div>
  );
}
