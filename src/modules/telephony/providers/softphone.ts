// The browser side of a calling provider (Decision 24).
export type SoftphoneErrorKind = "mic_denied" | "no_mic" | "connection_lost" | "refused" | "failed";

export interface SoftphoneEvents {
  ringing(): void;
  connected(): void;
  ended(): void;
  error(kind: SoftphoneErrorKind): void;
  connectionLost(): void;
}

export interface SoftphoneClient {
  connect(credentials: { token: string; expiresAt: string }): Promise<void>;
  dial(callRef: string, phone: string): Promise<void>;
  answer(callId: string): Promise<void>;
  hangup(): Promise<void>;
  mute(on: boolean): Promise<void>;
  hold(on: boolean): Promise<void>;
  sendDtmf(digit: string): Promise<void>;
  disconnect(): void;
}

export type SoftphoneFactory = (events: SoftphoneEvents) => SoftphoneClient;
