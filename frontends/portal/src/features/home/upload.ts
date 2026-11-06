import type { Dataset, HomeApi, Identity } from './api';
import { MAX_UPLOAD_BYTES, UPLOAD_SIZE_LIMIT_LABEL } from './upload-policy';
export { MAX_UPLOAD_BYTES } from './upload-policy';

export type UploadProgress = {
  dataset: Dataset | null;
  completed: number;
  total: number;
  success: number;
  alreadyStored: number;
  failed: number;
  errors: { name: string; message: string }[];
  stopped: boolean;
  blockingStatus?: number;
  blockingKind?: string;
};

export type UploadOptions = {
  name: string;
  targetDataset?: Dataset;
  files: File[];
  identity: Identity;
  signal?: AbortSignal;
  onProgress?: (progress: UploadProgress) => void;
};

type UploadApi = Pick<HomeApi, 'createDataset' | 'importFile'>;
type Failure = { status: number; kind: string; message: string };

function datasetCopy(dataset: Dataset): Dataset {
  return {
    id: dataset.id,
    name: dataset.name,
    access: dataset.access,
    ownerUsername: dataset.ownerUsername,
    instanceCount: dataset.instanceCount,
    createdAt: dataset.createdAt,
  };
}

function snapshot(progress: UploadProgress): UploadProgress {
  const copy = {
    ...progress,
    dataset: progress.dataset ? datasetCopy(progress.dataset) : null,
    errors: progress.errors.map((error) => Object.freeze({ ...error })),
  };
  if (copy.dataset) Object.freeze(copy.dataset);
  Object.freeze(copy.errors);
  return Object.freeze(copy);
}

function failureOf(error: unknown, signal?: AbortSignal): Failure {
  const value =
    error && typeof error === 'object'
      ? (error as { status?: unknown; kind?: unknown; name?: unknown; message?: unknown })
      : {};
  const status = typeof value.status === 'number' ? value.status : 0;
  const kind =
    typeof value.kind === 'string'
      ? value.kind
      : signal?.aborted || value.name === 'AbortError'
        ? 'aborted'
        : status === 0
          ? 'network'
          : 'http';
  return {
    status,
    kind,
    message: typeof value.message === 'string' ? value.message : '上传请求未完成',
  };
}

function isUnconfirmed(failure: Failure) {
  return (
    failure.status === 0 ||
    failure.status === 408 ||
    failure.status >= 500 ||
    failure.kind === 'aborted' ||
    failure.kind === 'network' ||
    failure.kind === 'protocol'
  );
}

function isBlocking(failure: Failure) {
  return (
    isUnconfirmed(failure) ||
    [401, 403, 404, 429].includes(failure.status) ||
    failure.kind === 'identity-changed'
  );
}

function uploadFailureMessage(failure: Failure) {
  if (isUnconfirmed(failure)) {
    return '本次上传结果尚未确认，请刷新影像集核对；影像集及已上传文件不会自动回滚。';
  }
  if (failure.status === 401 || failure.kind === 'identity-changed') {
    return '登录会话已失效或账号已变化，上传已停止；请重新确认会话，已上传文件保留。';
  }
  if (failure.status === 403) {
    return '会话或访问权限已变化，上传已停止；请刷新会话后核对影像集，未自动重试。';
  }
  if (failure.status === 404) {
    return '影像集不存在或已失去访问权限，后续上传已停止。';
  }
  if (failure.status === 429) {
    return '请求过于频繁，后续上传已停止；已上传文件保留，请稍后核对。';
  }
  return failure.message;
}

export function unsupportedUploadFormat(file: Pick<File, 'name' | 'type'>): string | null {
  if (/\.nii(?:\.gz)?$/i.test(file.name)) return '.nii/.nii.gz（NIfTI）暂不支持导入；当前仅支持 DICOM 文件/文件夹。';
  if (/\.zip$/i.test(file.name) || ['application/zip', 'application/x-zip-compressed'].includes(file.type.toLowerCase()))
    return '暂不支持 ZIP，请选择 DICOM 文件或文件夹';
  return null;
}

function validate(name: string, files: File[]) {
  if (!name || name.length > 200) {
    throw new Error('影像集名称需为 1 至 200 个字符');
  }
  if (!files.length) {
    throw new Error('请选择至少一个 DICOM 文件');
  }
  for (const file of files) {
    if (!Number.isFinite(file.size) || file.size <= 0) {
      throw new Error(`文件“${file.name}”为空或大小无效`);
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      throw new Error(`文件“${file.name}”超过 ${UPLOAD_SIZE_LIMIT_LABEL} 限制`);
    }
    const unsupported = unsupportedUploadFormat(file);
    if (unsupported) throw new Error(unsupported);
  }
}

export async function runUpload(api: UploadApi, options: UploadOptions): Promise<UploadProgress> {
  const target = options.targetDataset ? datasetCopy(options.targetDataset) : null;
  if (target && (!target.id || typeof target.id !== 'string')) throw new Error('目标影像集无效');
  const name = (target ? target.name : options.name).trim();
  const files = [...options.files];
  const identity = { issuer: options.identity.issuer, subject: options.identity.subject };
  validate(name, files);
  const progress: UploadProgress = {
    dataset: target,
    completed: 0,
    total: files.length,
    success: 0,
    alreadyStored: 0,
    failed: 0,
    errors: [],
    stopped: false,
  };
  const emit = () => options.onProgress?.(snapshot(progress));
  const stop = (status: number, kind: string) => {
    progress.stopped = true;
    progress.blockingStatus = status;
    progress.blockingKind = kind;
  };
  emit();

  if (options.signal?.aborted) {
    stop(0, 'aborted');
    progress.errors.push({
      name,
      message: target
        ? '上传已取消，尚未上传文件，原影像集保持不变。'
        : '上传已取消，尚未创建影像集或上传文件。',
    });
    emit();
    return snapshot(progress);
  }

  if (!target)
    try {
      progress.dataset = datasetCopy(await api.createDataset(name, identity, options.signal));
    } catch (error) {
      const failure = failureOf(error, options.signal);
      stop(failure.status, failure.kind);
      progress.errors.push({
        name,
        message:
          failure.kind === 'unconfigured'
            ? '后端尚未配置，尚未创建影像集或上传文件。'
            : isUnconfirmed(failure)
              ? '影像集创建结果尚未确认，请刷新列表核对，勿直接重复创建。'
              : uploadFailureMessage(failure),
      });
      emit();
      return snapshot(progress);
    }
  emit();

  const datasetId = progress.dataset?.id;
  if (!datasetId) throw new Error('目标影像集尚未确认');
  for (const file of files) {
    if (options.signal?.aborted) {
      stop(0, 'aborted');
      progress.errors.push({
        name: file.name,
        message: '后续上传已停止，此文件尚未开始；影像集及已上传文件保留，未自动回滚。',
      });
      emit();
      return snapshot(progress);
    }

    let result;
    try {
      result = await api.importFile(datasetId, file, identity, options.signal);
    } catch (error) {
      const failure = failureOf(error, options.signal);
      // An unknown result is not a confirmed failure or a completed file.
      if (!isUnconfirmed(failure)) {
        progress.failed++;
        progress.completed++;
      }
      progress.errors.push({ name: file.name, message: uploadFailureMessage(failure) });
      if (isBlocking(failure)) stop(failure.status, failure.kind);
      emit();
      if (progress.stopped) return snapshot(progress);
      continue;
    }

    if (
      !result ||
      !['Success', 'AlreadyStored'].includes(result.status) ||
      typeof result.id !== 'string' ||
      !result.id
    ) {
      stop(0, 'protocol');
      progress.errors.push({
        name: file.name,
        message: uploadFailureMessage({ status: 0, kind: 'protocol', message: '' }),
      });
      emit();
      return snapshot(progress);
    }
    if (result.status === 'Success') progress.success++;
    else progress.alreadyStored++;
    progress.completed++;
    emit();
  }

  return snapshot(progress);
}
