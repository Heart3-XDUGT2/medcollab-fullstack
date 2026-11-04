import React, { StrictMode, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Eye, RefreshCw, UserRound } from 'lucide-react';
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '../../src/styles.css';
import '../../src/ui/ui.css';
import Brand from '../../src/ui/Brand';
import { Button } from '../../src/ui';
import { createHomeApi } from '../../src/features/home/api';
import {
  DatasetCoverage,
  makeSyntheticDatasetStatistics,
  useAnnotationStatistics,
} from '../../src/features/home/statistics';
import './validation.css';

const api = createHomeApi({
  apiEnabled: true,
  authOrigin: null,
  logoutOrigins: [],
  workspacePath: null,
  publicSamplePath: null,
});
const fixtures = {
  d: makeSyntheticDatasetStatistics('d', {
    totalSlices: 10,
    annotatedSlices: 4,
    publishedAnnotatedSlices: 3,
  }),
  zero: makeSyntheticDatasetStatistics('zero', {
    totalSlices: 10,
    annotatedSlices: 0,
    publishedAnnotatedSlices: 0,
  }),
  empty: makeSyntheticDatasetStatistics('empty', {
    totalSlices: 0,
    annotatedSlices: 0,
    publishedAnnotatedSlices: 0,
  }),
  almost: makeSyntheticDatasetStatistics('almost', {
    totalSlices: 1000000,
    annotatedSlices: 999999,
    publishedAnnotatedSlices: 999999,
  }),
  erased: makeSyntheticDatasetStatistics('erased', {
    totalSlices: 12,
    annotatedSlices: 0,
    publishedAnnotatedSlices: 8,
    archiveError: 'synthetic archive failure',
  }),
  archived: makeSyntheticDatasetStatistics('archived', {
    totalSlices: 10,
    annotatedSlices: 0,
    publishedAnnotatedSlices: 0,
    publishedVersion: 2,
  }),
};
const records = [
  ['d', '共享画布与归档差异'],
  ['zero', '真实零值 · 尚未发布'],
  ['empty', '无可统计 CT'],
  ['almost', '接近全部 · 舍入边界'],
  ['erased', '已擦空画布 · 归档异常'],
  ['archived', '已有归档 · 掩码为空'],
  ['unknown', '未提供合成统计'],
];
function Validation() {
  const [scenario, setScenario] = useState(
    new URLSearchParams(location.search).get('case') === 'protocol' ? 'protocol' : 'synthetic'
  );
  const [visible, setVisible] = useState(true);
  const [account, setAccount] = useState('fixture-a');
  const [issues, setIssues] = useState<number[]>([]);
  const mode = scenario === 'synthetic' ? 'demo' : scenario === 'anonymous' ? 'anonymous' : 'real';
  const model = useAnnotationStatistics({
    mode,
    apiEnabled: scenario !== 'unconfigured',
    identity: mode === 'real' ? { issuer: 'fixture-issuer', subject: account } : null,
    demoData: fixtures,
    sessionApi: api,
    onAccessIssue: (issue) => setIssues((previous) => [...previous, issue.status]),
  });
  const shownRecords = scenario === 'synthetic' ? records : records.slice(0, 1);
  return (
    <main className="stats-validation">
      <header className="stats-validation-header">
        <Brand />
        <span>本地验证 · 全部为合成数据</span>
      </header>
      <h1>CT 帧覆盖率</h1>
      <div className="stats-validation-toolbar">
        <label>
          验证场景
          <select
            aria-label="验证场景"
            value={scenario}
            onChange={(event) => {
              setScenario(event.target.value);
              setIssues([]);
            }}
          >
            <option value="synthetic">合成示例</option>
            <option value="protocol">受控接口响应</option>
            <option value="unconfigured">未配置服务</option>
            <option value="anonymous">未登录</option>
          </select>
        </label>
        <Button
          variant="ghost"
          aria-pressed={visible}
          onClick={() => setVisible((value) => !value)}
        >
          <Eye aria-hidden="true" />
          {visible ? '隐藏统计' : '显示统计'}
        </Button>
        <Button
          variant="ghost"
          title="刷新可见统计"
          aria-label="刷新可见统计"
          size="icon"
          onClick={() => model.refreshWatched()}
        >
          <RefreshCw aria-hidden="true" />
        </Button>
        <Button
          variant="ghost"
          title="切换验证身份"
          aria-label="切换验证身份"
          size="icon"
          onClick={() => setAccount(account === 'fixture-a' ? 'fixture-b' : 'fixture-a')}
        >
          <UserRound aria-hidden="true" />
        </Button>
      </div>
      {visible && (
        <div className="stats-validation-content">
          <section className="stats-validation-selected" aria-label="选中资料">
            <h2>选中资料 · 共享画布与归档差异</h2>
            <DatasetCoverage model={model} datasetId="d" variant="detail" active />
          </section>
          <section aria-label="资料索引">
            <h2>资料索引</h2>
            <div className="stats-validation-records">
              {shownRecords.map(([id, name]) => (
                <article key={id} data-cy={`record-${id}`}>
                  <h3>{name}</h3>
                  <DatasetCoverage
                    model={model}
                    datasetId={id}
                    active={scenario === 'synthetic' ? true : undefined}
                  />
                </article>
              ))}
            </div>
          </section>
        </div>
      )}
      <output data-cy="access-issues" className="stats-validation-events">
        访问事件 {issues.length}
        {issues.length ? ` · ${issues.join(', ')}` : ''}
      </output>
    </main>
  );
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Validation />
  </StrictMode>
);
