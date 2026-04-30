'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cn } from '@/lib/utils';
import { logsApi, type LogListParams } from '@/lib/api';
import { X, ChevronRight, ChevronDown, Loader2 } from 'lucide-react';

interface LogFacetSidebarProps {
  projectId: string;
  filters: LogListParams;
  onFilterChange: (filters: LogListParams) => void;
}

function getActiveAttributeFilters(filters: LogListParams): Array<{ key: string; value: string }> {
  return Object.entries(filters)
    .filter(([key]) => key.startsWith('attribute.'))
    .map(([key, value]) => ({ key: key.slice('attribute.'.length), value: String(value) }));
}

function FacetKeyValues({
  projectId,
  facetKey,
  filters,
  onFilterChange,
}: {
  projectId: string;
  facetKey: string;
  filters: LogListParams;
  onFilterChange: (filters: LogListParams) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['log-facet-values', projectId, facetKey],
    queryFn: () => logsApi.getFacets(projectId, facetKey),
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
        <Loader2 className="h-3 w-3 animate-spin" />
        Loading...
      </div>
    );
  }

  const values = data?.values ?? [];
  if (values.length === 0) {
    return <p className="px-3 py-2 text-xs text-muted-foreground">No values found.</p>;
  }

  const paramKey = `attribute.${facetKey}`;
  const activeValue = filters[paramKey];

  return (
    <ul className="py-1">
      {values.map(({ value, count }) => {
        const isActive = activeValue === value;
        return (
          <li key={value}>
            <button
              className={cn(
                'w-full flex items-center justify-between px-3 py-1 text-xs hover:bg-white/5 transition-colors',
                isActive && 'text-[hsl(var(--accent))]'
              )}
              onClick={() => {
                if (isActive) {
                  // Remove filter
                  const next = { ...filters };
                  delete next[paramKey];
                  onFilterChange(next);
                } else {
                  onFilterChange({ ...filters, [paramKey]: value });
                }
              }}
            >
              <span className="truncate">{value}</span>
              <span className="ml-2 text-muted-foreground shrink-0">{count}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}

export function LogFacetSidebar({ projectId, filters, onFilterChange }: LogFacetSidebarProps) {
  const [expandedKey, setExpandedKey] = useState<string | null>(null);

  const { data: facetsData, isLoading } = useQuery({
    queryKey: ['log-facet-keys', projectId],
    queryFn: () => logsApi.getFacets(projectId),
    staleTime: 120_000,
    enabled: !!projectId,
  });

  const activeAttributeFilters = getActiveAttributeFilters(filters);
  const facetKeys = facetsData?.keys ?? [];

  return (
    <aside className="w-56 shrink-0 space-y-3" aria-label="Log facets">
      {/* Active attribute filter chips */}
      {activeAttributeFilters.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground px-1">Active Filters</p>
          <div className="flex flex-wrap gap-1">
            {activeAttributeFilters.map(({ key, value }) => (
              <span
                key={key}
                className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs bg-[hsl(var(--accent))]/15 text-[hsl(var(--accent))] border border-[hsl(var(--accent))]/30"
              >
                <span className="max-w-[80px] truncate">{key}={value}</span>
                <button
                  onClick={() => {
                    const next = { ...filters };
                    delete next[`attribute.${key}`];
                    onFilterChange(next);
                  }}
                  className="hover:text-white"
                  aria-label={`Remove ${key} filter`}
                >
                  <X className="h-2.5 w-2.5" />
                </button>
              </span>
            ))}
          </div>
        </div>
      )}

      {/* Facet key list */}
      <div className="rounded-lg border border-border-subtle overflow-hidden">
        <div className="px-3 py-2 bg-black/10 border-b border-border-subtle">
          <p className="text-xs font-medium">Attributes</p>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 p-3 text-xs text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Loading attributes...
          </div>
        ) : facetKeys.length === 0 ? (
          <p className="p-3 text-xs text-muted-foreground">No attribute facets available.</p>
        ) : (
          <ul>
            {facetKeys.map((key) => {
              const isExpanded = expandedKey === key;
              return (
                <li key={key} className="border-b border-border-subtle last:border-0">
                  <button
                    className="w-full flex items-center justify-between px-3 py-2 text-xs hover:bg-white/5 transition-colors"
                    onClick={() => setExpandedKey(isExpanded ? null : key)}
                    aria-expanded={isExpanded}
                  >
                    <span className="truncate">{key}</span>
                    {isExpanded ? (
                      <ChevronDown className="h-3 w-3 text-muted-foreground shrink-0" />
                    ) : (
                      <ChevronRight className="h-3 w-3 text-muted-foreground shrink-0" />
                    )}
                  </button>
                  {isExpanded && (
                    <FacetKeyValues
                      projectId={projectId}
                      facetKey={key}
                      filters={filters}
                      onFilterChange={onFilterChange}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </aside>
  );
}
