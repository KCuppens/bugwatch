'use client';

import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { logSavedSearchesApi, type LogListParams } from '@/lib/api';
import { toast } from 'sonner';
import { Bookmark, ChevronDown, Plus, Trash2, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';

interface SavedSearchBarProps {
  projectId: string;
  currentFilters: LogListParams;
  onLoadSearch: (filters: LogListParams) => void;
}

export function SavedSearchBar({ projectId, currentFilters, onLoadSearch }: SavedSearchBarProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [newName, setNewName] = useState('');
  const dropdownRef = useRef<HTMLDivElement>(null);
  const queryClient = useQueryClient();

  // Close on outside click
  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: ['log-saved-searches', projectId],
    queryFn: () => logSavedSearchesApi.list(projectId),
    staleTime: 60_000,
    enabled: !!projectId && isOpen,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => logSavedSearchesApi.create(projectId, name, currentFilters),
    onSuccess: () => {
      toast.success('Search saved');
      setNewName('');
      setIsSaving(false);
      void queryClient.invalidateQueries({ queryKey: ['log-saved-searches', projectId] });
    },
    onError: () => {
      toast.error('Failed to save search');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (searchId: string) => logSavedSearchesApi.delete(projectId, searchId),
    onSuccess: () => {
      toast.success('Search deleted');
      void queryClient.invalidateQueries({ queryKey: ['log-saved-searches', projectId] });
    },
    onError: () => {
      toast.error('Failed to delete search');
    },
  });

  const savedSearches = data?.data ?? [];

  function handleSave() {
    const name = newName.trim();
    if (!name) return;
    createMutation.mutate(name);
  }

  return (
    <div className="relative" ref={dropdownRef}>
      <Button
        variant="outline"
        size="sm"
        className="h-8 text-xs gap-1.5"
        onClick={() => setIsOpen((v) => !v)}
      >
        <Bookmark className="h-3.5 w-3.5" />
        Saved Searches
        <ChevronDown className={cn('h-3 w-3 transition-transform', isOpen && 'rotate-180')} />
      </Button>

      {isOpen && (
        <div className="absolute left-0 top-full mt-1 z-50 w-72 rounded-lg border border-border-subtle bg-[hsl(var(--surface-1))] shadow-lg">
          {/* Saved list */}
          <div className="p-2 border-b border-border-subtle">
            <p className="text-xs font-medium text-muted-foreground px-1 mb-1">Saved Searches</p>
            {isLoading ? (
              <div className="flex items-center gap-2 px-2 py-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" />
                Loading...
              </div>
            ) : savedSearches.length === 0 ? (
              <p className="px-2 py-2 text-xs text-muted-foreground">No saved searches yet.</p>
            ) : (
              <ul className="max-h-40 overflow-y-auto">
                {savedSearches.map((search) => (
                  <li
                    key={search.id}
                    className="flex items-center justify-between rounded px-2 py-1.5 hover:bg-white/5 group"
                  >
                    <button
                      className="flex-1 text-left text-xs truncate"
                      onClick={() => {
                        onLoadSearch(search.filters);
                        setIsOpen(false);
                      }}
                    >
                      {search.name}
                    </button>
                    <button
                      className="shrink-0 text-muted-foreground hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100"
                      onClick={(e) => {
                        e.stopPropagation();
                        deleteMutation.mutate(search.id);
                      }}
                      disabled={deleteMutation.isPending}
                      aria-label={`Delete saved search "${search.name}"`}
                    >
                      <Trash2 className="h-3 w-3" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Save current search */}
          <div className="p-2">
            {isSaving ? (
              <div className="flex items-center gap-2">
                <Input
                  className="h-7 text-xs flex-1"
                  placeholder="Search name…"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') handleSave();
                    if (e.key === 'Escape') {
                      setIsSaving(false);
                      setNewName('');
                    }
                  }}
                  autoFocus
                />
                <Button
                  size="sm"
                  className="h-7 text-xs shrink-0"
                  onClick={handleSave}
                  disabled={!newName.trim() || createMutation.isPending}
                >
                  {createMutation.isPending ? (
                    <Loader2 className="h-3 w-3 animate-spin" />
                  ) : (
                    'Save'
                  )}
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  className="h-7 text-xs shrink-0"
                  onClick={() => {
                    setIsSaving(false);
                    setNewName('');
                  }}
                >
                  Cancel
                </Button>
              </div>
            ) : (
              <button
                className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors w-full px-1 py-1"
                onClick={() => setIsSaving(true)}
              >
                <Plus className="h-3 w-3" />
                Save current search
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
