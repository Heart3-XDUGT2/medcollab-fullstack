export type OpenCaseRequest = {
  caseId: string;
  intent: 'edit' | 'review' | 'view';
  versionId?: string;
  locale: 'zh' | 'en-US';
};

export type SourceManifest = {
  id: string;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  frameOfReferenceUID: string;
  frames: { sopInstanceUID: string; frameNumber: number }[];
};

export type LaunchContext = {
  caseId: string;
  dataSourceId: string;
  sourceManifest: SourceManifest;
  revision: string;
  permissions: { canView: boolean; canEdit: boolean };
  version: null | {
    id: string;
    kind: 'draft' | 'submission';
    sourceManifestId: string;
    // Exact instances belonging to this version, not "latest SEG in study".
    sopInstanceUIDs: string[];
    instances: { sopInstanceUID: string; seriesInstanceUID: string }[];
  };
};

export type EditLease = { leaseId: string; generation: number; expiresAt: string };
export type DraftReceipt = {
  caseId: string;
  draftVersionId: string;
  revision: string;
  persistedAt: string;
};
export type Artifact = {
  bytes: Blob;
  format: 'DICOM_SEG';
  sopInstanceUID: string;
  sopClassUID: string;
  seriesInstanceUID: string;
  sourceManifestId: string;
};
export type SaveOperation = {
  operationId: string;
  caseId: string;
  sourceManifestId: string;
  baseDraftVersionId: string | null;
  revision: string;
  lease: EditLease;
  artifactIds: string[];
};

// Implemented by owner 3 / a trusted same-origin host. No guessed endpoints,
// embedded credentials, or success-returning default transport is provided.
export interface WorkspaceBackend {
  getLaunchContext(request: OpenCaseRequest): Promise<LaunchContext>;
  acquireLease(caseId: string, revision: string): Promise<EditLease>;
  renewLease?(caseId: string, lease: EditLease): Promise<EditLease>;
  releaseLease(caseId: string, lease: EditLease): Promise<void>;
  persistArtifacts(operation: SaveOperation, artifacts: Artifact[]): Promise<string[]>;
  commitDraft(operation: SaveOperation): Promise<DraftReceipt>;
}

export type EditState = {
  caseId: string | null;
  sessionId: string | null;
  intent: OpenCaseRequest['intent'] | null;
  versionId: string | null;
  ready: boolean;
  dirty: boolean;
  saving: boolean;
  leaseValid: boolean;
  readOnly: boolean;
};
export type WorkspaceEvent = {
  type: 'ready' | 'dirtyChanged' | 'saveStarted' | 'saveSucceeded' | 'saveFailed' | 'leaseLost' | 'closed';
  caseId: string;
  sessionId: string;
  state: EditState;
  receipt?: DraftReceipt;
  errorCode?: string;
};
export interface WorkspaceDriver {
  validateContext(context: LaunchContext): void;
  open(request: OpenCaseRequest, context: LaunchContext, sessionId: string): Promise<void>;
  captureArtifacts(context: LaunchContext): Promise<Artifact[]>;
  setReadOnly(readOnly: boolean): void;
  clear(): void;
}
export type LeaveDecision = 'save' | 'discard' | 'stay';
