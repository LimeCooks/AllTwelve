'use client';
import { useEffect, useState } from 'react';
import { Search } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  loadSearchRecords,
  matchingRecords,
  type SearchResult,
} from '@/lib/workspace-search';

export function WorkspaceSearch({
  onOpenRecord,
}: {
  onOpenRecord: (record: SearchResult) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [records, setRecords] = useState<SearchResult[]>([]);
  const [failures, setFailures] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [retry, setRetry] = useState(0);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController();
    let active = true;
    void loadSearchRecords(fetch, controller.signal).then((result) => {
      if (!active) return;
      setRecords(result.records);
      setFailures(result.failures);
      setLoading(false);
    });
    return () => {
      active = false;
      controller.abort();
    };
  }, [open, retry]);
  const resetSearch = () => {
    setLoading(true);
    setRecords([]);
    setFailures([]);
  };
  const matches = matchingRecords(records, query);
  return (
    <>
      <Button
        variant="ghost"
        className="workspace-search-trigger"
        onClick={() => {
          resetSearch();
          setQuery('');
          setOpen(true);
        }}
        aria-label="Search saved records"
      >
        <Search size={18} />
        <span>Search plays, athletes, film…</span>
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Search your workspace</DialogTitle>
            <DialogDescription>
              Saved plays, athlete names and film titles.
            </DialogDescription>
          </DialogHeader>
          <Input
            aria-label="Search saved records"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Name, formation, position or jersey number"
          />
          {failures.length > 0 && (
            <div role="alert">
              Could not search: {failures.join(', ')}. Results are incomplete.{' '}
              <Button
                variant="outline"
                onClick={() => {
                  resetSearch();
                  setRetry((n) => n + 1);
                }}
              >
                Retry
              </Button>
            </div>
          )}
          <div aria-live="polite">
            {loading
              ? 'Loading saved records…'
              : query.trim()
                ? `${matches.length} match${matches.length === 1 ? '' : 'es'}${failures.length ? ' in available records' : ''}`
                : 'Type to find a saved record.'}
          </div>
          {!loading && query.trim() && matches.length === 0 && (
            <p>
              {failures.length
                ? 'No matches in the records that loaded.'
                : 'No saved records match your search.'}
            </p>
          )}
          <ul className="workspace-search-results" aria-label="Search results">
            {matches.map((record) => (
              <li key={`${record.kind}:${record.id}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (onOpenRecord(record)) setOpen(false);
                  }}
                >
                  <strong>{record.name}</strong>
                  <span>
                    {record.kind === 'play'
                      ? 'Play'
                      : record.kind === 'athlete'
                        ? 'Athlete'
                        : 'Film'}{' '}
                    · {record.detail}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}
