/** Backend increment 2026-11-07. Use the existing same-origin authenticated request adapter. */
export type LibrarySource = 'all' | 'personal' | 'team' | 'public';
export type LibraryDataset = {
  id: string; name: string; access: 'owner' | 'shared' | 'public';
  ownerUsername: string | null; instanceCount: number; createdAt: string;
  scope: 'personal' | 'team'; teamId: string | null; teamName: string | null;
  uploaderSubject: string | null; canDelete: boolean;
};
export type LibraryQuery = {
  source?: LibrarySource; teamId?: string; q?: string;
  page?: number; size?: number; sort?: 'created-desc';
};
export type LibraryPage = {
  items: LibraryDataset[]; total: number; page: number; size: number;
  sourceCounts: { personal: number; team: number; public: number };
};
export type TeamDissolutionResult = {
  success: true; teamId: string; deletedDatasets: number;
  deletedObjects: number; retainedObjects: number; pendingObjects: number;
};
export type LibraryTeamHealth = {
  datasetLibraryApi?: 'v1'; teamDissolutionApi?: 'clear-library-v1';
  dicomImportFormatPolicy?: 'known-nondicom-reject-v1';
};
