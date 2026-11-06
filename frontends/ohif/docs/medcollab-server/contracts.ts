/** Current deployed contract snapshot, 2026-11-01. Reference types, not a generated SDK. */
export type Identity = { issuer: string; subject: string };
export type Items<T> = { items: T[]; total: number };
export type ApiErrorBody = { error: string };

export type Session = {
  loggedIn: boolean;
  username: string | null;
  issuer: string | null;
  subject: string | null;
  csrfToken: string;
  csrfHeaderName: string;
};
export type Health = {
  segmentationStorageGuard?: string; // single-process-rw-v1 after the 2026-11-06 fix
  status: string;
  message: string;
  application: string;
  workspaceApi: string; // current: dicomweb-labelmap-v1
  datasetDeletionApi?: string; // unreferenced-reclaim-v1
  niftiImport?: string; // unsupported
  teamApi: string; // team-library-v1
  sharingPolicy: string; // personal-forward-copy-v1
  javaVersion: string;
  osName: string;
  osArch: string;
  time: string;
};
export type OrthancStatus = {
  connected: boolean;
  name: string;
  version: string;
  instanceCount: number;
};
export type Dataset = {
  id: string; // Java business ID, not a DICOM UID
  name: string;
  access: 'owner' | 'shared' | 'public'; // Personal forwarded copies return owner
  canDelete?: boolean; // missing means unsupported; teams use their separate API
  ownerUsername: string;
  instanceCount: number;
  createdAt: string;
};
export type Instance = { id: string; instanceNumber: string };
export type User = { subject: string; username: string };
export type ImportResult = { status: 'Success' | 'AlreadyStored'; id: string };
export type Success = { success: true };
export type Logout = { logoutUrl: string };

export type LaunchSeries = {
  id: string; // Orthanc series ID for /segmentations/{seriesId}
  studyInstanceUID: string;
  seriesInstanceUID: string; // DICOM UID for DICOMweb paths
  frameOfReferenceUID: string;
  description: string;
  instanceCount: number;
};
export type Launch = { datasetId: string; series: LaunchSeries[] };
export type SourceImage = {
  id: string; // Orthanc instance ID for masks[].instanceId
  instanceNumber: string;
  seriesId: string;
  seriesDescription: string;
  rows: number;
  columns: number;
  sopInstanceUid: string;
};
export type Segment = { number: number; label: string; color: number[] };
export type LabelmapMask = {
  instanceId: string;
  runs: number[]; // repeated [start, length, labelNumber], not binary pairs
};
export type Labelmap = { segments: Segment[]; masks: LabelmapMask[] };
export type LabelmapRequest = {
  expectedPublishedVersion: number;
  publicationId: string;
  label: string;
  data: Labelmap;
};
export type SegmentationStatus = {
  seriesId: string;
  rows: number;
  columns: number;
  publishedVersion: number;
  publishedBy: string | null;
  publishedAt: string | null;
  label: string;
  orthancId: string | null;
};
export type LabelmapWorkspace = { status: SegmentationStatus; data: Labelmap };

/** Old simple-editor protocol. Do not send these pairs to /publish-labelmap. */
export type BinaryMask = { instanceId: string; runs: number[] }; // [start,length,...]
export type LegacyWorkspace = SegmentationStatus & { masks: BinaryMask[] };
export type LegacyDraft = { revision: number; baseVersion: number; label: string; masks: BinaryMask[] };
export type LegacyPublishRequest = {
  expectedPublishedVersion: number;
  publicationId: string;
  label: string;
  masks: BinaryMask[];
};

/** Local browser storage; NOT an HTTP body contract. */
export type OhifDraft = {
  data: Labelmap;
  label: string;
  baseVersion: number;
  sourceFingerprint: string;
  publicationId: string;
  publishAttempted?: boolean;
  schema: 1;
  updatedAt: string;
};
export type DraftRecord<T> = { key: string; revision: number; draft: T | null };
export interface BrowserDraftStore {
  key(identity: Identity, datasetId: string, seriesKey: string): string;
  fingerprint(sources: SourceImage[]): string;
  read<T = OhifDraft>(key: string): Promise<DraftRecord<T>>;
  write<T = OhifDraft>(
    key: string,
    expectedRevision: number,
    draft: T | null
  ): Promise<DraftRecord<T>>;
}

/** Existing frontend service surface; do not mutate state or use private methods. */
export type DatasetWorkspaceState = {
  ready: boolean;
  busy: boolean;
  dirty: boolean;
  local: boolean;
  username: string;
  datasetId: string;
  seriesId: string;
  version: number;
  savedAt: string;
  message: string;
  error: string;
  newerVersion: number;
};
export interface DatasetWorkspaceUi {
  readonly state: Readonly<DatasetWorkspaceState>;
  subscribe(listener: () => void): () => void;
  saveDraft(): Promise<void>;
  publish(): Promise<void>;
  exportFile(): Promise<void>;
  loadLatest(): Promise<void>;
}

/** DICOMweb JSON is an array of tag objects, never Items<T>. */
export type DicomAttribute = { vr: string; Value?: unknown[]; BulkDataURI?: string; InlineBinary?: string };
export type DicomJson = Record<string, DicomAttribute>;

/** 2026-11-03: lifetime accepted nonempty mask patches, NOT physical mouse gestures. */
export type PersonalAnnotationStats = {
  statisticVersion: 1;
  countingMethod: 'accepted-mask-edit-operation';
  scope: 'server-accepted-collaboration-history';
  historyIncluded: boolean;
  totalStrokes: number;
  totalAcceptedOperations: number;
  paintOperations: number;
  eraseOperations: number;
  mixedOperations: number;
  editedSliceCount: number;
  everPaintedSliceCount: number;
  editedDatasetCount: number;
  editedSeriesCount: number;
  firstEditAt: string | null;
  lastEditAt: string | null;
  generatedAt: string;
};
export type AnnotationProgress = {
  totalSlices: number;
  annotatedSlices: number;
  unannotatedSlices: number;
  ratio: number; // [0,1], unrounded
  percent: number; // [0,100], rounded to two decimal places
};
export type SeriesAnnotationStats = {
  datasetId: string;
  seriesId: string; // Orthanc ID, NOT SeriesInstanceUID
  progress: AnnotationProgress;
  publishedProgress: AnnotationProgress;
  seq: number;
  throughSeq: number;
  publishedVersion: number;
  pendingArchive: boolean;
  archiveError: string;
};
export type DatasetAnnotationStats = {
  datasetId: string;
  completionMethod: 'nonempty-mask-slices/ct-slices';
  seriesCount: number;
  progress: AnnotationProgress;
  publishedProgress: AnnotationProgress;
  pendingArchive: boolean;
  series: SeriesAnnotationStats[];
  generatedAt: string;
};

// 2026-11-04: account favorites and recent successful opens.
export type { ActivityDataset, ActivityPage, FavoriteItem, RecentItem, RecentPage, RecentContext, OpenRequest, OpenResult, FavoriteResult, FavoriteState, RecentClearResult, ActivityError } from './home-activity';

/** 2026-11-06: personal sharing is an independent snapshot, not a permission grant. */
export type ForwardResult = { success: true; recipientDatasetId: string; alreadyOwned: boolean };
export type DatasetDeletionResult = { success: true; datasetId: string; deletedObjects: number; retainedObjects: number; pendingObjects: number };
