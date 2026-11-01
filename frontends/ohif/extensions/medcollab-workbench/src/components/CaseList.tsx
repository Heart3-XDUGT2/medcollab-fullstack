import React from 'react';

import CaseRow from './CaseRow';
import type { DivisionMode, WorkbenchCase } from '../types';

interface CaseListProps {
  cases: WorkbenchCase[];
  selectedCaseId: string | null;
  focusedDivision: DivisionMode;
  onSelectCase: (caseId: string) => void;
}

function CaseList({ cases, selectedCaseId, focusedDivision, onSelectCase }: CaseListProps) {
  const focusedCount = cases.filter(item => item.divisionMode === focusedDivision).length;

  return (
    <section
      className="flex min-w-0 flex-col gap-2"
      aria-label="演示病例列表"
    >
      <div className="text-muted-foreground flex min-w-0 flex-wrap items-center justify-between gap-1 text-xs">
        <span>
          共 <span className="text-foreground">{cases.length}</span> 例 · 当前分工{' '}
          <span className="text-primary">{focusedCount}</span> 例
        </span>
        <span className="text-muted-foreground/70">列表与详情均为演示 mock 数据</span>
      </div>

      {cases.length === 0 ? (
        <div className="border-border bg-card text-muted-foreground rounded border border-dashed px-4 py-10 text-center text-sm">
          没有符合条件的演示病例；请调整筛选或搜索关键词。
        </div>
      ) : (
        <ul className="flex min-w-0 flex-col gap-2">
          {cases.map(caseRecord => (
            <li
              key={caseRecord.caseId}
              className="min-w-0"
            >
              <CaseRow
                caseRecord={caseRecord}
                selected={caseRecord.caseId === selectedCaseId}
                focusedDivision={focusedDivision}
                onSelect={onSelectCase}
              />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

export default CaseList;
