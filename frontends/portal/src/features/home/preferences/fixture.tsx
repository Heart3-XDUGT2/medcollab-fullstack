import React, { useState } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/inter/latin-400.css';
import '@fontsource/inter/latin-600.css';
import '../../../styles.css';
import '../../../ui/ui.css';
import PreferencesButton from './PreferencesButton';
import { useHomePreferences } from './useHomePreferences';
import type { PreferenceContext } from './model';
import './fixture.css';

const rows = [
  { id: 'fixture-one', name: '资料显示验证 · 长名称样例与比较字段', source: '我创建的', owner: '验证身份甲', instances: 128, date: '2026-11-03' },
  { id: 'fixture-two', name: '资料显示验证 · 协作样例', source: '与我共享', owner: '验证身份乙', instances: 42, date: '2026-11-01' },
];
function Fixture() {
  const [identity, setIdentity] = useState('A');
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState('fixture-one');
  const context: PreferenceContext = identity === 'demo' || identity === 'anonymous' ? { mode: identity }
    : { mode: 'real', identity: { issuer: identity === 'realm' ? 'https://fixture.invalid/realm-two' : 'https://fixture.invalid/realm-one', subject: identity === 'B' ? 'fixture-B' : 'fixture-A' } };
  const display = useHomePreferences(context);
  const values = display.preferences;
  return <main className="mc-preference-fixture">
    <div className="mc-preference-fixture-marker">隔离组件验证 · 合成身份与资料 · 不连接业务服务</div>
    <header><h1>资料显示验证</h1><label>测试身份<select aria-label="测试身份" value={identity} onChange={event => setIdentity(event.target.value)}><option value="A">账号甲</option><option value="B">账号乙</option><option value="realm">同 subject，不同 issuer</option><option value="anonymous">匿名</option><option value="demo">演示</option></select></label><PreferencesButton model={display} /></header>
    <div className="mc-preference-fixture-toolbar"><label>查找资料<input aria-label="查找验证资料" value={search} onChange={event => setSearch(event.target.value)} /></label><span data-cy="fixture-persistence">{display.persistence}</span></div>
    <section data-cy="preference-preview" data-layout={values.layout} data-density={values.density} data-group={values.groupBy} data-selected={selected} className="mc-preference-fixture-data">
      {values.groupBy === 'source' && <h2>按来源分组</h2>}
      {rows.filter(row => row.name.includes(search)).map(row => <article key={row.id} data-selected={row.id === selected}><button onClick={() => setSelected(row.id)}>{row.name}</button><p>{row.source}</p><dl>{values.fields.owner && <div data-field="owner"><dt>创建者</dt><dd>{row.owner}</dd></div>}{values.fields.instances && <div data-field="instances"><dt>实例数</dt><dd>{row.instances}</dd></div>}{values.fields.createdAt && <div data-field="createdAt"><dt>创建时间</dt><dd>{row.date}</dd></div>}</dl></article>)}
    </section>
  </main>;
}
createRoot(document.getElementById('root')!).render(<Fixture />);
