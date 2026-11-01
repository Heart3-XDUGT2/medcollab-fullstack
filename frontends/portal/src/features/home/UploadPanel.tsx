import React, { useEffect, useId, useRef, useState } from 'react';
import { Button, Icons, Input, Label } from '../../ui';
import type { HomeApi, Identity } from './api';
import { MAX_UPLOAD_BYTES, runUpload } from './upload';
import type { UploadProgress } from './upload';
import './upload-panel.css';

type Props = {
  mode: 'real' | 'demo';
  api: HomeApi;
  identity: Identity | null;
  scopeSignal: AbortSignal;
  enabled: boolean;
  loginUrl: string | null;
  onBusyChange: (busy: boolean) => void;
  onBlocked: (status: number, kind?: string) => void;
  onCompleted: () => void;
  onClose: () => void;
};

function sizeLabel(bytes: number) {
  if (!Number.isFinite(bytes)) return '大小未知';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}

const identityKey = (identity: Identity | null) =>
  identity ? JSON.stringify([identity.issuer, identity.subject]) : null;

export default function UploadPanel(props: Props) {
  const { mode, api, identity, scopeSignal, enabled, loginUrl } = props;
  const [name, setName] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const [scopeAborted, setScopeAborted] = useState(scopeSignal.aborted);
  const [uncertain, setUncertain] = useState(false);
  const [error, setError] = useState('');
  const [nameInvalid, setNameInvalid] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const filesRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const chooseRef = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const pending = useRef(false);
  const operation = useRef(0);
  const active = useRef<AbortController | null>(null);
  const pickerContext = useRef<{ mode: Props['mode']; identity: string | null } | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const previousContext = useRef({ mode, identity: identityKey(identity) });
  const id = useId();
  const contextChanged =
    previousContext.current.mode !== mode ||
    Boolean(
      identity &&
        previousContext.current.identity &&
        previousContext.current.identity !== identityKey(identity)
    );
  const locked = Boolean(progress?.dataset || progress?.stopped || uncertain);
  const selectionDisabled =
    busy || locked || scopeAborted || contextChanged || (mode === 'real' && !enabled);
  const startDisabled =
    mode === 'demo' || !enabled || !identity || busy || locked || scopeAborted || contextChanged;
  const folderAttributes = { webkitdirectory: '' };

  function releaseBusy() {
    if (pending.current) {
      pending.current = false;
      latest.current.onBusyChange(false);
    }
    if (mounted.current) {
      setBusy(false);
      setCancelling(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      operation.current++;
      active.current?.abort();
      active.current = null;
      releaseBusy();
    };
  }, []);

  useEffect(() => {
    setScopeAborted(scopeSignal.aborted);
    const abort = () => {
      if (mounted.current) setScopeAborted(true);
      operation.current++;
      active.current?.abort();
      active.current = null;
      if (pending.current && mounted.current) {
        setUncertain(true);
        setError('操作上下文已变化，上传已停止；请刷新影像集核对，已上传内容不会自动回滚。');
      }
      releaseBusy();
    };
    scopeSignal.addEventListener('abort', abort, { once: true });
    if (scopeSignal.aborted) abort();
    return () => {
      scopeSignal.removeEventListener('abort', abort);
      operation.current++;
      active.current?.abort();
      active.current = null;
      if (pending.current && mounted.current) {
        setUncertain(true);
        setError('操作上下文已变化，上传已停止；请刷新影像集核对，已上传内容不会自动回滚。');
      }
      releaseBusy();
    };
  }, [scopeSignal]);

  useEffect(() => {
    const currentIdentity = identityKey(identity);
    const previous = previousContext.current;
    const changed =
      previous.mode !== mode ||
      (currentIdentity && previous.identity && previous.identity !== currentIdentity);
    if (changed || (!currentIdentity && pending.current)) {
      operation.current++;
      active.current?.abort();
      active.current = null;
      if (!changed) {
        setUncertain(true);
        setError('登录状态已变化，上传已停止；请重新确认会话并刷新影像集核对。');
      }
      releaseBusy();
    }
    if (changed) {
      setName('');
      setFiles([]);
      setProgress(null);
      setUncertain(false);
      setError('');
      setNameInvalid(false);
    }
    previousContext.current = {
      mode,
      identity: currentIdentity || (previous.mode === mode ? previous.identity : null),
    };
  }, [mode, identity?.issuer, identity?.subject]);

  function select(event: React.ChangeEvent<HTMLInputElement>) {
    const openedContext = pickerContext.current;
    pickerContext.current = null;
    const stalePicker =
      openedContext &&
      (openedContext.mode !== mode || openedContext.identity !== identityKey(identity));
    if (!selectionDisabled && !scopeSignal.aborted && !pending.current && !stalePicker) {
      setFiles(Array.from(event.currentTarget.files || []));
      setError('');
    }
    event.currentTarget.value = '';
  }

  function choose(input: React.RefObject<HTMLInputElement>) {
    pickerContext.current = { mode, identity: identityKey(identity) };
    input.current?.click();
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending.current || locked || contextChanged) return;
    if (mode === 'demo') {
      setError('本机演示不会读取或上传文件。');
      return;
    }
    if (!enabled || !identity || scopeSignal.aborted) {
      setError('请先连接服务并确认登录状态，再上传影像。');
      return;
    }

    const controller = new AbortController();
    active.current = controller;
    const currentOperation = ++operation.current;
    const currentIdentity = { issuer: identity.issuer, subject: identity.subject };
    const isCurrent = () =>
      mounted.current &&
      operation.current === currentOperation &&
      latest.current.mode === mode &&
      latest.current.scopeSignal === scopeSignal &&
      identityKey(latest.current.identity) === identityKey(currentIdentity);
    let enteredQueue = false;
    let completed = false;
    pending.current = true;
    setBusy(true);
    setCancelling(false);
    setError('');
    setNameInvalid(false);
    props.onBusyChange(true);
    try {
      const next = await runUpload(api, {
        name,
        files,
        identity: currentIdentity,
        signal: controller.signal,
        onProgress: (value) => {
          enteredQueue = true;
          if (isCurrent()) setProgress(value);
        },
      });
      if (isCurrent()) {
        setProgress(next);
        if (next.stopped && typeof next.blockingStatus === 'number') {
          latest.current.onBlocked(next.blockingStatus, next.blockingKind);
        }
        completed = !next.stopped && next.completed === next.total && !scopeSignal.aborted;
      }
    } catch (failure) {
      if (isCurrent()) {
        if (enteredQueue) {
          setUncertain(true);
          setError('本次操作结果尚未确认，请刷新影像集核对，勿直接重复上传。');
        } else {
          setError(failure instanceof Error ? failure.message : '无法开始上传，请核对所选文件。');
          const invalidName = !name.trim() || name.trim().length > 200;
          setNameInvalid(invalidName);
          if (invalidName) nameRef.current?.focus();
          else if (!files.length) chooseRef.current?.focus();
        }
      }
    } finally {
      if (active.current === controller) active.current = null;
      if (isCurrent()) releaseBusy();
    }
    if (completed && isCurrent()) latest.current.onCompleted();
  }

  function close() {
    if (pending.current) return;
    setFiles([]);
    setName('');
    props.onClose();
  }

  const status = busy
    ? cancelling
      ? '正在停止后续上传…'
      : progress?.dataset
        ? '正在逐个上传文件'
        : '正在创建影像集'
    : progress?.stopped || uncertain
      ? '上传已停止'
      : progress && progress.completed === progress.total
        ? progress.failed
          ? '处理结束，部分文件未导入'
          : '上传处理完成'
        : '';

  return (
    <form className="mc-upload" onSubmit={submit} noValidate aria-busy={busy}>
      <p className="mc-upload-note">
        {mode === 'demo'
          ? '本机演示不会读取或上传文件。'
          : '支持 DICOM 文件或文件夹，单个文件不超过 64 MiB。不支持 ZIP。'}
      </p>
      {mode === 'real' && !enabled && (
        <p className="mc-upload-access">
          当前尚不能上传，请先确认服务和登录状态。
          {loginUrl && (
            <a href={loginUrl} target="_blank" rel="noopener noreferrer">
              在新标签页登录
            </a>
          )}
        </p>
      )}
      <Label className="mc-upload-label" htmlFor={`${id}-name`}>
        新影像集名称
      </Label>
      <Input
        id={`${id}-name`}
        ref={nameRef}
        className="mc-upload-name"
        data-cy="home-upload-name"
        value={name}
        disabled={selectionDisabled}
        placeholder="输入影像集名称"
        aria-invalid={nameInvalid}
        aria-describedby={nameInvalid ? `${id}-error` : undefined}
        onChange={(event) => {
          setName(event.target.value);
          setNameInvalid(false);
          setError('');
        }}
      />
      <div className="mc-upload-pickers">
        <Button
          ref={chooseRef}
          type="button"
          variant="outline"
          className="mc-upload-secondary"
          dataCY="home-upload-choose-files"
          disabled={selectionDisabled}
          onClick={() => choose(filesRef)}
        >
          <Icons.Upload aria-hidden="true" />
          选择文件
        </Button>
        <Button
          type="button"
          variant="outline"
          className="mc-upload-secondary"
          dataCY="home-upload-choose-folder"
          disabled={selectionDisabled}
          onClick={() => choose(folderRef)}
        >
          选择文件夹
        </Button>
      </div>
      <input
        ref={filesRef}
        hidden
        type="file"
        multiple
        data-cy="home-upload-files"
        disabled={selectionDisabled}
        onChange={select}
        aria-label="选择 DICOM 文件"
      />
      <input
        ref={folderRef}
        hidden
        type="file"
        multiple
        {...folderAttributes}
        data-cy="home-upload-folder"
        disabled={selectionDisabled}
        onChange={select}
        aria-label="选择 DICOM 文件夹"
      />
      <div className="mc-upload-selection">
        <span>已选 {files.length} 个文件</span>
        {files.length > 0 && !selectionDisabled && (
          <Button
            type="button"
            variant="ghost"
            className="mc-upload-clear"
            onClick={() => {
              setFiles([]);
              setError('');
            }}
          >
            清空选择
          </Button>
        )}
      </div>
      {files.length ? (
        <ul className="mc-upload-files" aria-label="所选文件">
          {files.map((file, index) => (
            <li key={`${index}:${file.name}:${file.lastModified}`}>
              <span title={file.webkitRelativePath || file.name}>
                {file.webkitRelativePath || file.name}
              </span>
              <span className={file.size > MAX_UPLOAD_BYTES ? 'is-invalid' : undefined}>
                {sizeLabel(file.size)}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mc-upload-empty">尚未选择文件</p>
      )}
      {error && (
        <p id={`${id}-error`} className="mc-upload-error" role="alert">
          {error}
        </p>
      )}
      {progress && (
        <section
          className="mc-upload-progress"
          data-cy="home-upload-progress"
          aria-label="上传进度"
        >
          <p className="mc-upload-status" role="status">
            {status}
          </p>
          <progress
            max={progress.total || 1}
            value={progress.completed}
            aria-label="已确认处理的文件数"
          />
          <div className="mc-upload-summary" data-cy="home-upload-summary">
            <span>
              已处理 {progress.completed} / {progress.total}
            </span>
            <span>成功 {progress.success}</span>
            <span>已存在 {progress.alreadyStored}</span>
            <span>失败 {progress.failed}</span>
          </div>
          {progress.errors.length > 0 && (
            <ul className="mc-upload-errors" aria-label="上传问题">
              {progress.errors.map((item, index) => (
                <li key={`${index}:${item.name}`}>
                  <strong>{item.name}</strong>
                  <span>{item.message}</span>
                </li>
              ))}
            </ul>
          )}
          {!busy && (
            <p className="mc-upload-note">
              影像集及已上传文件不会自动撤回。请关闭后刷新资料库核对，本次操作不能直接重新开始。
            </p>
          )}
        </section>
      )}
      {mode === 'real' && !progress && (
        <p className="mc-upload-note">文件逐个上传，停止后已上传内容仍会保留。</p>
      )}
      <div className="mc-upload-actions">
        {busy ? (
          <Button
            type="button"
            variant="outline"
            className="mc-upload-secondary"
            dataCY="home-upload-cancel"
            disabled={cancelling}
            onClick={() => {
              setCancelling(true);
              active.current?.abort();
            }}
          >
            {cancelling ? '正在停止…' : '停止后续上传'}
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            className="mc-upload-secondary"
            dataCY="home-upload-close"
            onClick={close}
          >
            {progress ? '关闭' : '取消'}
          </Button>
        )}
        <Button
          type="submit"
          className="mc-upload-primary"
          dataCY="home-upload-start"
          disabled={startDisabled}
        >
          {busy ? '上传中…' : '开始上传'}
        </Button>
      </div>
    </form>
  );
}
