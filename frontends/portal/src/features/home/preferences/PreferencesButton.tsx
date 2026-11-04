import React, { useEffect, useId, useRef, useState } from 'react';
import { Trigger as DialogTrigger } from '@radix-ui/react-dialog';
import { CalendarDays, Hash, LayoutGrid, LayoutList, List, RotateCcw, Rows2, SlidersHorizontal, UserRound } from 'lucide-react';
import { Button, Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '../../../ui';
import type { HomePreferencesModel } from './useHomePreferences';
import type { HomePreferencePatch, HomePreferences } from './model';
import './preferences.css';

type ControlsProps = { model: HomePreferencesModel; className?: string };
type Props = ControlsProps & { disabled?: boolean; label?: string };
const fields = [
  { key: 'owner', label: '创建者', Icon: UserRound },
  { key: 'instances', label: '实例数', Icon: Hash },
  { key: 'createdAt', label: '创建时间', Icon: CalendarDays },
] as const;

export function PreferenceControls({ model, className = '' }: ControlsProps) {
  const id = useId();
  const [notice, setNotice] = useState('');
  useEffect(() => setNotice(''), [model.update]);
  const change = (patch: HomePreferencePatch) => { setNotice(''); model.update(patch); };
  const values = model.preferences;
  const status = model.resetUnconfirmed
    ? '本页已恢复默认，但本机旧偏好未能清除；刷新后可能重新载入旧设置。'
    : model.persistence === 'unavailable'
      ? '浏览器未能记住本次更改；刷新后可能恢复之前的显示。'
      : model.persistence === 'recovered'
        ? '本机偏好已失效，当前使用默认显示。'
        : model.persistence === 'loading' ? '正在读取本机显示偏好…' : notice;
  const scope = model.scope === 'account' ? '仅本人 · 此浏览器' : model.scope === 'demo' ? '演示 · 当前页面' : '匿名 · 当前页面';
  return <div className={`mc-preference-controls ${className}`}>
    <fieldset className="mc-preference-section">
      <legend>资料呈现</legend>
      <div className="mc-preference-segments">
        {([{ value: 'list', label: '资料清单', Icon: LayoutList }, { value: 'cards', label: '资料索引', Icon: LayoutGrid }] as const).map(option =>
          <label className="mc-preference-choice" key={option.value}>
            <input type="radio" name={`${id}-layout`} value={option.value} checked={values.layout === option.value} onChange={() => change({ layout: option.value })} />
            <span><option.Icon size={18} strokeWidth={1.6} />{option.label}</span>
          </label>)}
      </div>
    </fieldset>
    <fieldset className="mc-preference-section">
      <legend>信息密度</legend>
      <div className="mc-preference-segments">
        {([{ value: 'comfortable', label: '舒适', Icon: Rows2 }, { value: 'compact', label: '紧凑', Icon: List }] as const).map(option =>
          <label className="mc-preference-choice" key={option.value}>
            <input type="radio" name={`${id}-density`} value={option.value} checked={values.density === option.value} onChange={() => change({ density: option.value })} />
            <span><option.Icon size={18} strokeWidth={1.6} />{option.label}</span>
          </label>)}
      </div>
    </fieldset>
    <div className="mc-preference-group-row">
      <label htmlFor={`${id}-group`}>资料分组</label>
      <select id={`${id}-group`} value={values.groupBy} onChange={event => change({ groupBy: event.target.value as HomePreferences['groupBy'] })}>
        <option value="none">不分组</option><option value="source">按来源分组</option>
      </select>
    </div>
    <fieldset className="mc-preference-section mc-preference-fields">
      <legend>显示信息</legend>
      {fields.map(field => <label className="mc-preference-field" key={field.key}>
        <field.Icon size={16} strokeWidth={1.6} /><span>{field.label}</span>
        <input type="checkbox" checked={values.fields[field.key]} onChange={event => change({ fields: { [field.key]: event.target.checked } })} />
      </label>)}
    </fieldset>
    {status && <p className={`mc-preference-status ${model.persistence === 'unavailable' || model.resetUnconfirmed ? 'is-warning' : ''}`} role="status">{status}</p>}
    <footer className="mc-preference-footer"><Button variant="ghost" onClick={() => { model.reset(); setNotice('已恢复默认显示。'); }}><RotateCcw size={15} />恢复默认</Button><span>{scope}</span></footer>
  </div>;
}

export default function PreferencesButton({ model, className = '', disabled = false, label = '显示' }: Props) {
  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState<React.CSSProperties>({});
  const trigger = useRef<HTMLButtonElement>(null);
  useEffect(() => { setOpen(false); }, [model.update]);
  useEffect(() => {
    if (!open) return;
    const place = () => {
      const rect = trigger.current?.getBoundingClientRect();
      if (!rect) return;
      const below = window.innerHeight - rect.bottom - 20;
      const above = rect.top - 20;
      const useAbove = below < 440 && above > below;
      setPosition({
        right: Math.max(16, window.innerWidth - rect.right),
        ...(useAbove ? { top: 'auto', bottom: window.innerHeight - rect.top + 8, maxHeight: Math.max(160, above) }
          : { top: Math.max(16, rect.bottom + 8), bottom: 'auto', maxHeight: Math.max(160, below) }),
      });
    };
    place();
    window.addEventListener('resize', place);
    window.addEventListener('scroll', place, true);
    return () => { window.removeEventListener('resize', place); window.removeEventListener('scroll', place, true); };
  }, [open]);
  return <Dialog open={open} onOpenChange={setOpen} modal={false}>
    <DialogTrigger asChild><Button ref={trigger} variant="outline" className={className} disabled={disabled} aria-label="显示设置" title="显示设置" dataCY="home-display-preferences"><SlidersHorizontal size={16} />{label}</Button></DialogTrigger>
    <DialogContent className="mc-preferences-panel" style={position} data-cy="home-display-preferences-panel">
      <DialogHeader><DialogTitle>资料显示</DialogTitle><DialogDescription className="sr-only">个人显示偏好，不改变资料或访问权限</DialogDescription></DialogHeader>
      <PreferenceControls model={model} />
    </DialogContent>
  </Dialog>;
}
