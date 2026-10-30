import { useEffect } from 'react';

/**
 * Custom hook to completely disable background page scrolling when a modal or overlay is active.
 * Restores original overflow and padding on unmount or when isLocked becomes false.
 */
export const useLockBodyScroll = (isLocked: boolean = true) => {
  useEffect(() => {
    if (!isLocked) return;

    const originalOverflow = document.body.style.overflow;
    const originalPaddingRight = document.body.style.paddingRight;
    const originalHtmlOverflow = document.documentElement.style.overflow;

    // Calculate scrollbar width to prevent sudden layout shifts
    const scrollbarWidth = window.innerWidth - document.documentElement.clientWidth;

    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    if (scrollbarWidth > 0) {
      document.body.style.paddingRight = `${scrollbarWidth}px`;
    }

    return () => {
      document.body.style.overflow = originalOverflow;
      document.documentElement.style.overflow = originalHtmlOverflow;
      document.body.style.paddingRight = originalPaddingRight;
    };
  }, [isLocked]);
};

