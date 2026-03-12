export type ResponseLength = 'short' | 'medium' | 'long';

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: string;
  preferredName?: string;
  responseLength?: ResponseLength;
  chatRetentionMode?: 'ephemeral' | 'persistent';
  sensitiveDataConsentAt?: string | null;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: string[];
  createdAt: string;
  inviteCode?: string;
  inviteExpiresAt?: string | null;
  inviteUpdatedAt?: string | null;
  inviteRevokedAt?: string | null;
  aiPresence?: 'quiet' | 'facilitation' | 'reflection';
  safetyPauseActive?: boolean;
  safetyPauseReason?: string | null;
  safetyPauseAt?: string | null;
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  timestamp: string;
  type: 'text' | 'ai';
  writtenBy?: 'trusted_backend';
  writerService?: string;
  writerRoute?: string;
  writerMode?: string;
  writerModel?: string | null;
  writerGeneratedAt?: string;
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string;
    email?: string;
    emailVerified?: boolean;
    isAnonymous?: boolean;
    tenantId?: string | null;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}
