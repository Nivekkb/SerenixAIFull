export interface AISettings {
  name: string;
  avatar: string; // emoji or ID
  style: 'empathetic' | 'calm' | 'encouraging';
}

export interface UserProfile {
  uid: string;
  displayName: string;
  email: string;
  photoURL?: string;
  createdAt: string;
  preferredName?: string;
  aiSettings?: AISettings;
}

export interface MeditationExercise {
  id: string;
  title: string;
  theme: 'stress relief' | 'focus' | 'sleep';
  duration: 5 | 10 | 15;
  text: string;
  audioUrl?: string;
}

export interface Circle {
  id: string;
  name: string;
  description: string;
  createdBy: string;
  members: string[];
  createdAt: string;
  aiPresence?: 'quiet' | 'facilitation' | 'reflection';
}

export interface Message {
  id: string;
  content: string;
  senderId: string;
  senderName: string;
  timestamp: string;
  type: 'text' | 'ai';
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
