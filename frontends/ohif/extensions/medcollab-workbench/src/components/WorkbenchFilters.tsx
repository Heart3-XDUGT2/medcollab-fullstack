import React from 'react';
import { Input, Tabs, TabsList, TabsTrigger } from '@ohif/ui-next';

import { FILTERS } from '../data/mockCases';
import type { WorkbenchFilter } from '../types';

interface WorkbenchFiltersProps {
  filter: WorkbenchFilter;
  counts: Record<WorkbenchFilter, number>;
  search: string;
  onFilterChange: (filter: WorkbenchFilter) => void;
  onSearchChange: (search: string) => void;
}

function WorkbenchFilters({
  filter,
  counts,
  search,
  onFilterChange,
  onSearchChange,
}: WorkbenchFiltersProps) {
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
      <Tabs
        value={filter}
        onValueChange={value => onFilterChange(value as WorkbenchFilter)}
      >
        <TabsList className="border-border bg-card h-auto flex-wrap gap-1 border p-1">
          {FILTERS.map(item => (
            <TabsTrigger
              key={item.value}
              value={item.value}
              className="text-muted-foreground data-[state=active]:bg-primary/20 data-[state=active]:text-primary gap-1 px-2 py-1 text-sm"
            >
              {item.label}
              <span className="text-xxs text-muted-foreground tabular-nums">
                {counts[item.value]}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="flex min-w-[220px] flex-1 items-center justify-end sm:flex-none">
        <Input
          value={search}
          onChange={event => onSearchChange(event.target.value)}
          placeholder="搜索病例 ID / 名称"
          aria-label="搜索病例 ID 或名称"
          className="h-8 max-w-[320px]"
        />
      </div>
    </div>
  );
}

export default WorkbenchFilters;
