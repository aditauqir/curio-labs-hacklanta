export type VoiceErrorKind = "not_configured" | "upstream";

export class VoiceError extends Error {
  constructor(
    public kind: VoiceErrorKind,
    message: string,
  ) {
    super(message);
  }
}
