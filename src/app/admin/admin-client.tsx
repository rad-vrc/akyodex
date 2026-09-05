'use client';

import { AdminHeader } from '@/components/admin/admin-header';
import { AdminLogin } from '@/components/admin/admin-login';
import { AdminTabs } from '@/components/admin/admin-tabs';
import { useCallback, useEffect, useState } from 'react';

import type { AdminRole, AkyoData, AuthRole } from '@/types/akyo';

interface AdminClientProps {
  categories: string[];
  authors: string[];
  /** @deprecated use categories */
  attributes: string[];
  /** @deprecated use authors */
  creators: string[];
  akyoData: AkyoData[];
}

/**
 * Admin Client Component
 * 管理画面のメインコンポーネント（ログイン状態管理）
 */
export function AdminClient({ 
  categories, 
  authors, 
  attributes, 
  creators, 
  akyoData 
}: AdminClientProps) {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [userRole, setUserRole] = useState<AuthRole>(null);
  const [editState, setEditState] = useState({ pending: false, busy: false });
  const handlePendingEditsChange = useCallback((pending: boolean, busy: boolean) => {
    setEditState({ pending, busy });
  }, []);

  useEffect(() => {
    // サーバーサイドセッション検証を使用（セキュリティ向上）
    const verifySession = async () => {
      try {
        const response = await fetch('/api/admin/verify-session');
        const data = await response.json();

        if (data.authenticated && data.role) {
          setIsAuthenticated(true);
          setUserRole(data.role);
        }
      } catch (error) {
        console.error('Session verification error:', error);
      }
    };

    verifySession();
  }, []);

  const handleLogin = (role: AdminRole) => {
    setIsAuthenticated(true);
    setUserRole(role);
    // サーバーサイドセッションCookieが設定されている（sessionStorage不要）
  };

  const handleLogout = async () => {
    if (editState.busy) return;
    if (editState.pending && !confirm('保留中の更新があります。破棄してログアウトしますか？')) return;
    try {
      // サーバーサイドセッションを削除
      await fetch('/api/admin/logout', {
        method: 'POST',
      });
    } catch (error) {
      console.error('Logout error:', error);
    }

    setIsAuthenticated(false);
    setUserRole(null);
    setEditState({ pending: false, busy: false });
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-100 to-gray-200">
      <AdminHeader
        isAuthenticated={isAuthenticated}
        userRole={userRole}
        onLogout={handleLogout}
        pendingEdits={editState.pending}
        applyingEdits={editState.busy}
      />

      {!isAuthenticated ? (
        <AdminLogin onLogin={handleLogin} />
      ) : (
        <AdminTabs
          userRole={userRole!}
          // 暫定対応: AdminTabsが更新されるまで、新フィールドの値を旧プロップス名で渡す
          attributes={categories || attributes}
          creators={authors || creators}
          akyoData={akyoData}
          onPendingEditsChange={handlePendingEditsChange}
        />
      )}
    </div>
  );
}
