import type {
  CalendarEventRecord,
  InstallItemRecord,
  InstallReview,
} from '@/types/domain';

// Publish an overview only when both sources have returned complete results.
// A failed request must never become a misleading zero-count workspace.
export async function loadDashboard(fetcher: typeof fetch = fetch) {
  const [calendarResponse, installResponse] = await Promise.all([
    fetcher('/api/calendar-events', { cache: 'no-store' }),
    fetcher('/api/install', { cache: 'no-store' }),
  ]);
  if (!calendarResponse.ok || !installResponse.ok)
    throw new Error('Unable to load the team overview.');
  const [calendar, install] = await Promise.all([
    calendarResponse.json() as Promise<{ events: CalendarEventRecord[] }>,
    installResponse.json() as Promise<{
      items: InstallItemRecord[];
      reviews: InstallReview[];
    }>,
  ]);
  if (
    !calendar ||
    !install ||
    !Array.isArray(calendar.events) ||
    !Array.isArray(install.items) ||
    !Array.isArray(install.reviews)
  )
    throw new Error('The team overview response was incomplete.');
  return {
    events: calendar.events,
    install: { items: install.items, reviews: install.reviews },
  };
}
