'use client';

import { IconExclamationCircle, IconLock, IconSignIn } from '@/components/icons';
import type { AdminRole } from '@/types/akyo';
import { FormEvent, useState } from 'react';

interface AdminLoginProps {
  onLogin: (role: AdminRole) => void;
}

const INVALID_PASSWORD_MESSAGE = 'Akyoワードが正しくありません';
// サーバー側のレート制限（IP 単位 / 全体）。カウンタは 1 分で自動的に消える
const RATE_LIMITED_MESSAGE = 'ログイン試行が多すぎます。1分ほど待ってから再度お試しください';

/**
 * Admin Login Component
 * 管理画面のログイン（完全再現）
 */
export function AdminLogin({ onLogin }: AdminLoginProps) {
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    // サーバーサイド認証を使用（セキュリティ向上）
    try {
      const response = await fetch('/api/admin/login', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password }),
      });

      const data = await response.json();

      if (data.success && data.role) {
        onLogin(data.role);
      } else if (response.status === 429) {
        setError(RATE_LIMITED_MESSAGE);
      } else {
        setError(INVALID_PASSWORD_MESSAGE);
      }
    } catch (error) {
      console.error('Login error:', error);
      setError(INVALID_PASSWORD_MESSAGE);
    }
  };

  return (
    <div className="flex items-center justify-center min-h-[calc(100vh-80px)]">
      <div className="bg-white rounded-2xl shadow-2xl p-8 max-w-md w-full mx-4">
        <div className="text-center mb-8">
          <div className="w-20 h-20 bg-gradient-to-r from-red-500 to-orange-500 rounded-full flex items-center justify-center mx-auto mb-4">
            <IconLock size="w-8 h-8" className="text-white" />
          </div>
          <h2 className="text-2xl font-bold text-gray-800 mb-2">ファインダー認証</h2>
          <p className="text-gray-600 text-sm">Akyoワードを入力してファインダー機能にアクセス</p>
        </div>

        <form onSubmit={handleSubmit}>
          <div className="mb-6">
            <label htmlFor="admin-login-password" className="block text-gray-700 text-sm font-medium mb-2">
              Akyoワード
            </label>
            <input
              id="admin-login-password"
              type="password"
              aria-invalid={error !== null}
              aria-describedby={error ? 'admin-login-error' : undefined}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full px-4 py-3 border border-gray-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500"
              placeholder="Akyoワードを入力"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="w-full bg-gradient-to-r from-red-500 to-orange-500 text-white py-3 rounded-lg font-medium hover:opacity-90 transition-opacity"
          >
            <IconSignIn size="w-4 h-4" className="mr-2" /> ログイン
          </button>

          {error && (
            <div
              id="admin-login-error"
              className="mt-4 p-3 bg-red-100 text-red-700 rounded-lg text-sm"
              role="alert"
            >
              <IconExclamationCircle size="w-4 h-4" className="mr-1" /> {error}
            </div>
          )}
        </form>

        <div className="mt-6 p-4 bg-yellow-50 border border-yellow-200 rounded-lg text-sm text-gray-700">
          <p className="font-semibold mb-2">見つけたAkyoを登録したい？</p>
          <p className="mb-2">次のいずれかのアカウント宛に：</p>
          <ul className="list-disc pl-5 space-y-1">
            <li>
              <a
                href="https://x.com/rad_vrc"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                らど https://x.com/rad_vrc
              </a>
            </li>
            <li>
              <a
                href="https://x.com/nknmnThe_VRC"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                ネコノミ https://x.com/nknmnThe_VRC
              </a>
            </li>
            <li>
              <a
                href="https://x.com/KAYA_Vchat"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                カヤ https://x.com/KAYA_Vchat
              </a>
            </li>
            <li>
              <a
                href="https://x.com/zhoney666"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-600 underline hover:text-blue-800"
              >
                ジョニー https://x.com/zhoney666
              </a>
            </li>
          </ul>
          <p className="mt-2">「ひみつのAkyoワードを教えて」とメッセージを送ってみてね！</p>
        </div>
      </div>
    </div>
  );
}
