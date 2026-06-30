const RECORDING_MIME_TYPES = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

export function getRecordingMimeType() {
  return RECORDING_MIME_TYPES.find((type) => MediaRecorder.isTypeSupported(type)) || '';
}
