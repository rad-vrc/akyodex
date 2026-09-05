'use client';

import { IconHome, IconShield, IconSignOut } from '@/components/icons';
import type { AuthRole } from '@/types/akyo';
import Link from 'next/link';

/**
 * Props for the AdminHeader component
 */
interface AdminHeaderProps {
  /** Whether the admin is currently authenticated */
  isAuthenticated: boolean;
  /** The current user's role (owner or admin) */
  userRole: AuthRole;
  /** Callback to trigger logout */
  onLogout: () => void;
  pendingEdits: boolean;
  applyingEdits: boolean;
}

/**
 * Admin Header Component
 * Provides navigation and auth status for the administrative dashboard.
 *
 * @param props - Component properties
 * @returns Header element
 */
export function AdminHeader({ isAuthenticated, userRole, onLogout, pendingEdits, applyingEdits }: AdminHeaderProps) {
  const roleText = userRole === 'owner' ? 'オーナー' : userRole === 'admin' ? '管理者' : '';

  return (
    <header className="bg-gray-900 text-white shadow-lg sticky top-0 z-40">
      <div className="container mx-auto px-4 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 bg-gradient-to-r from-red-500 to-orange-500 rounded-full flex items-center justify-center" aria-hidden="true">
              <IconShield size="w-5 h-5" className="text-white" />
            </div>
            <h1 className="text-2xl font-bold">Akyoずかん ファインダーモード</h1>
          </div>

          <nav aria-label="管理者ナビゲーション" className="flex items-center gap-2">
            {isAuthenticated && userRole && (
              <span className="px-3 py-2 rounded-lg bg-gray-700 text-white text-sm">
                {roleText}
              </span>
            )}
            <Link
              href="/zukan"
              aria-disabled={applyingEdits || undefined}
              onNavigate={(event) => {
                if (applyingEdits || (pendingEdits && !confirm('保留中の更新があります。破棄して図鑑に戻りますか？'))) {
                  event.preventDefault();
                }
              }}
              className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
            >
              <IconHome size="w-4 h-4" className="mr-1" /> 図鑑に戻る
            </Link>
            {isAuthenticated && (
              <button
                onClick={onLogout}
                className="px-3 py-2 rounded-lg bg-gray-700 hover:bg-gray-600 text-white text-sm transition-colors"
                aria-label="ログアウト"
              >
                <IconSignOut size="w-4 h-4" className="mr-1" /> ログアウト
              </button>
            )}
          </nav>
        </div>
      </div>
    </header>
  );
}
