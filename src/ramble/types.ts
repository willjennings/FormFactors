export type SlotType = 'text' | 'shortText' | 'date' | 'number' | 'enum' | 'reference';

export interface Slot {
  id: string;
  label: string;
  type: SlotType;
  required: boolean;
  constraint?: string;
  order: number;
}

export interface FormSchema {
  formId: string;
  title: string;
  slots: Slot[];
  capturedAt: number;
}

export type SlotStatus = 'empty' | 'filling' | 'draft' | 'confirmed' | 'needsInput';
export type SlotSource = 'heard' | 'inferred' | 'asked' | 'userEdited';
export type SlotOwner = 'agent' | 'user';

export interface SlotFill {
  slotId: string;
  value: string | null;
  status: SlotStatus;
  confidence: number;            // 0..1
  source: SlotSource;
  owner: SlotOwner;              // once 'user', the agent never overwrites
  provenanceUtteranceIds?: string[];
  updatedAt: number;
  pendingQuestion?: string | null;  // set while status==='needsInput'
  prior?: SlotFill | null;          // snapshot taken on user.editStart, for cancel-revert
}

export type Phase = 'capturing' | 'conversing' | 'recapping' | 'awaitingConsent' | 'submitting' | 'done';
export type Activity = 'listening' | 'thinking' | 'filling' | 'asking' | 'readingBack' | 'idle' | 'stalled';

export interface SessionState {
  phase: Phase;
  activity: Activity;
  activeSlotId: string | null;
  lastUpdateAt: number;
  fills: SlotFill[];
}

export type RambleEvent =
  | { type: 'slot.fillingStart'; slotId: string }
  | { type: 'slot.valueUpdate'; slotId: string; partialValue: string }
  | { type: 'slot.draft'; slotId: string; value: string; confidence: number; source: SlotSource }
  | { type: 'slot.needsInput'; slotId: string; question: string }
  | { type: 'slot.confirmed'; slotId: string }
  | { type: 'activity.change'; activity: Activity }
  | { type: 'session.phaseChange'; phase: Phase }
  | { type: 'heartbeat' }
  | { type: 'user.editStart'; slotId: string }
  | { type: 'user.editCommit'; slotId: string; value: string }
  | { type: 'user.editCancel'; slotId: string }
  | { type: 'user.openFullEditor' };
