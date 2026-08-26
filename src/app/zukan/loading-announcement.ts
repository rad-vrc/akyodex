import { createElement } from 'react';

interface LoadingAnnouncementProps {
  text: string;
}

export function LoadingAnnouncement({ text }: LoadingAnnouncementProps) {
  return createElement(
    'div',
    {
      className:
        'inline-flex items-center gap-3 rounded-full bg-white px-4 py-2 text-sm shadow-sm',
      role: 'status',
      'aria-live': 'polite',
      'aria-atomic': 'true',
    },
    createElement('div', {
      className: 'h-5 w-5 animate-spin rounded-full border-2 border-orange-200 border-t-orange-600',
      'aria-hidden': 'true',
    }),
    createElement(
      'span',
      { className: 'font-medium text-gray-700' },
      text,
    ),
  );
}
