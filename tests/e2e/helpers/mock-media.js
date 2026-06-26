export const MEDIA_MOCK_INIT_SCRIPT = () => {
  class MockMediaRecorder {
    constructor(stream, options = {}) {
      this.stream = stream;
      this.mimeType = options.mimeType || 'audio/webm';
      this.state = 'inactive';
      this.ondataavailable = null;
      this.onstop = null;
    }

    static isTypeSupported(type) {
      return String(type).includes('webm') || String(type).includes('mp4') || String(type).includes('ogg');
    }

    start() {
      this.state = 'recording';
    }

    stop() {
      if (this.state === 'inactive') return;
      this.state = 'inactive';
      const data = new Uint8Array(1400);
      const blob = new Blob([data], { type: this.mimeType });
      this.ondataavailable?.({ data: blob, size: blob.size });
      queueMicrotask(() => this.onstop?.());
    }

    requestData() {
      const data = new Uint8Array(900);
      const blob = new Blob([data], { type: this.mimeType });
      this.ondataavailable?.({ data: blob, size: blob.size });
    }
  }

  navigator.mediaDevices.getUserMedia = async () => {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    const ctx = new Ctx();
    const dest = ctx.createMediaStreamDestination();
    return dest.stream;
  };

  window.MediaRecorder = MockMediaRecorder;
};
