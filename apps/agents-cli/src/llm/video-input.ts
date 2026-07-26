export const NATIVE_VIDEO_INPUT_PROTOCOLS = new Set([
  "google-v1beta",
]);

export function supportsNativeVideoInputProtocol(protocol: string | undefined): boolean {
  return Boolean(protocol && NATIVE_VIDEO_INPUT_PROTOCOLS.has(protocol));
}

export function createNativeVideoInputUnsupportedError(protocol: string): Error {
  return new Error(
    `native_video_input_unsupported: protocol=${protocol} does not support complete video input. ` +
      "Configure a native-video model in ModelPanel -> Critic; frame extraction fallback is disabled.",
  );
}
