import React from 'react';
import { Badge, Button } from '@ohif/ui-next';

import { DIVISION_MODES } from '../data/mockCases';
import type { DivisionMode } from '../types';

interface DivisionModeSwitchProps {
  value: DivisionMode;
  onChange: (mode: DivisionMode) => void;
}

function DivisionModeSwitch({ value, onChange }: DivisionModeSwitchProps) {
  const activeMode = DIVISION_MODES.find(mode => mode.value === value) ?? DIVISION_MODES[0];

  return (
    <section
      className="border-border bg-card flex min-w-0 flex-col gap-2 rounded border p-3"
      aria-label="分工方式"
    >
      <div className="flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <h2 className="text-foreground text-sm font-medium">分工方式</h2>
          <Badge
            variant="outline"
            className="border-border text-muted-foreground px-1.5 py-0.5"
            title="仅改变列表与详情的展示重点，不改动数据"
          >
            仅影响展示
          </Badge>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-1.5">
          {DIVISION_MODES.map(mode => {
            const isActive = mode.value === value;
            return (
              <Button
                key={mode.value}
                type="button"
                size="sm"
                variant={isActive ? 'default' : 'outline'}
                aria-pressed={isActive}
                data-testid={mode.value === 'block' ? 'division-mode-block' : undefined}
                title={mode.hint}
                disabled={mode.disabled}
                className={mode.disabled ? 'cursor-not-allowed' : undefined}
                onClick={() => {
                  if (mode.disabled) {
                    return;
                  }
                  onChange(mode.value);
                }}
              >
                {mode.label}
              </Button>
            );
          })}
        </div>
      </div>
      <p className="text-muted-foreground text-xs">
        当前视图：<span className="text-primary">{activeMode.shortLabel}分工</span> —{' '}
        {activeMode.hint}
      </p>
    </section>
  );
}

export default DivisionModeSwitch;
