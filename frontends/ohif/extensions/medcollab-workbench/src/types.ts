/**
 * Types for the MedCollab workbench demo page.
 *
 * Everything in this extension is front-end only: the data is mock data and no
 * save/publish action is simulated. `backendCaseId` exists so that, once the
 * Java backend is connected, a case loaded from the backend can be opened
 * through `annotationWorkspaceService.openCase`; mock cases leave it unset.
 */

export type DivisionMode = 'case' | 'series' | 'block' | 'organ';

export type CaseStatus = 'annotating' | 'review' | 'published' | 'conflict';

export type WorkbenchFilter = 'all' | 'mine' | 'shared' | 'review';

export type OpenIntent = 'edit' | 'review';

export interface DemoUser {
  id: string;
  name: string;
  role: string;
}

export interface Collaborator extends DemoUser {
  /** Demo-only access description, e.g. "区块 41–80 · 编辑". */
  access: string;
}

export interface VersionEntry {
  version: string;
  author: string;
  createdAt: string;
  note: string;
}

export interface BlockAssignment {
  blockId: string;
  /** Inclusive 1-based slice range, e.g. "1–40". */
  sliceRange: string;
  ownerId: string;
  ownerName: string;
  note?: string;
}

export interface WorkbenchCase {
  caseId: string;
  /**
   * Case identifier understood by the Java backend. Only set for cases loaded
   * from the backend; mock cases do not have one and therefore fall back to
   * demo navigation.
   */
  backendCaseId?: string;
  name: string;
  modality: string;
  seriesDescription: string;
  studyInstanceUID: string;
  seriesInstanceUID: string;
  seriesCount: number;
  sliceCount: number;
  status: CaseStatus;
  owner: DemoUser;
  divisionMode: DivisionMode;
  version: string;
  updatedAt: string;
  collaborators: Collaborator[];
  versions: VersionEntry[];
  blocks?: BlockAssignment[];
  description: string;
}

export interface AnnotationWorkspaceServiceLike {
  openCase?: (request: {
    caseId: string;
    intent: OpenIntent;
    locale: 'zh' | 'en-US';
  }) => Promise<unknown>;
}

export interface WorkbenchServicesManager {
  services?: Record<string, unknown> & {
    annotationWorkspaceService?: AnnotationWorkspaceServiceLike;
  };
}

export interface WorkbenchPageProps {
  servicesManager?: WorkbenchServicesManager;
  [key: string]: unknown;
}

export interface OpenCaseError {
  code: string;
  message: string;
}

/** Result of the last open attempt, shown inline in the detail panel. */
export interface OpenCaseState {
  caseId: string;
  intent: OpenIntent;
  error?: OpenCaseError;
  note?: string;
}
