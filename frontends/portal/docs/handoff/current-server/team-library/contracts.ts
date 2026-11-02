/** Additive contracts for team-library-v1, 2026-11-02. Runtime validation is still required. */
export type Identity = { issuer: string; subject: string };
export type Items<T> = { items: T[]; total: number };
export type Team = {
  id: string; name: string; leaderSubject: string; leaderUsername: string;
  memberCount: number; role: 'leader' | 'member' | 'none'; createdAt: string;
};
export type Member = { subject: string; username: string; role: 'leader' | 'member'; joinedAt: string };
export type InviteResult = { team: Team; inviteCode: string };
export type TeamDataset = {
  id: string; name: string; access: 'owner' | 'shared'; ownerUsername: string;
  instanceCount: number; createdAt: string; scope: 'team'; teamId: string;
  uploaderSubject: string; canDelete: boolean;
};
export type Success = { success: true };
export type ErrorBody = { error: string };
export type NameRequest = { name: string };
export type MemberRequest = { subject: string };
export type JoinRequest = { teamId: string; inviteCode: string };
