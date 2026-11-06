import { useEffect, useRef, useState } from 'react';
import { Button } from '../../ui';
import { ApiError, type Dataset, type HomeApi, type Identity } from './api';

type Props = {
  dataset: Dataset; api: HomeApi; identity: Identity | null; scopeSignal: AbortSignal;
  onBusyChange(busy: boolean): void; onDeleted(): void; onClose(): void;
  onBlocked(status: number, kind?: string): void;
};

export default function DeleteDatasetPanel(props: Props) {
  const [busy, setBusy] = useState(false);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const request = useRef<AbortController | null>(null);
  const alive = useRef(false);
  const callbacks = useRef(props);
  callbacks.current = props;
  useEffect(() => {
    alive.current = true;
    const stop = () => request.current?.abort();
    props.scopeSignal.addEventListener('abort', stop, { once: true });
    return () => {
      alive.current = false; stop();
      props.scopeSignal.removeEventListener('abort', stop);
      callbacks.current.onBusyChange(false);
    };
  }, [props.scopeSignal]);

  async function remove() {
    if (request.current || uncertain || props.scopeSignal.aborted || !props.identity || props.dataset.canDelete !== true) return;
    const operation = new AbortController();
    request.current = operation;
    setBusy(true); setError(''); props.onBusyChange(true);
    try {
      await props.api.deleteDataset(props.dataset.id, { ...props.identity }, operation.signal);
      if (!alive.current || operation.signal.aborted || props.scopeSignal.aborted) return;
      props.onBusyChange(false);
      props.onDeleted();
    } catch (failure) {
      if (!alive.current || operation.signal.aborted || props.scopeSignal.aborted) return;
      const unknown = !(failure instanceof ApiError) || failure.status === 0 || failure.status === 408 || failure.status >= 500;
      setUncertain(unknown);
      setError(unknown ? '删除结果尚未确认，请关闭此窗口并重新读取列表核对；不会自动重试。'
        : failure instanceof Error ? failure.message : '删除未完成');
      if (failure instanceof ApiError && [401, 403].includes(failure.status)) props.onBlocked(failure.status, failure.kind);
    } finally {
      if (request.current === operation) request.current = null;
      if (alive.current) { setBusy(false); callbacks.current.onBusyChange(false); }
    }
  }
  return <div>
    <p>确认删除“{props.dataset.name}”？此操作不可撤销。</p>
    <p>只删除你持有的这份数据集，不影响其他人的副本。文件仍被其他数据集持有时会保留；无人持有后从存储库彻底清除，存储暂不可用时自动重试清理。</p>
    <p>浏览器中的草稿及已下载文件不会自动删除。</p>
    {error && <p role="alert" className="mc-library-error">{error}</p>}
    <div className="mc-library-dialog-actions">
      <Button variant="outline" onClick={props.onClose} disabled={busy}>{uncertain ? '关闭并核对' : '取消'}</Button>
      <Button onClick={() => void remove()} disabled={busy || uncertain || !props.identity} dataCY="home-delete-confirm">{busy ? '正在删除…' : '确认删除'}</Button>
    </div>
  </div>;
}
