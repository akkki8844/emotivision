/**
 * Camera handling. Frames never leave the <video> element except as pixels read
 * into in-memory canvases for inference; nothing is recorded or uploaded.
 */

export class CameraError extends Error {
  constructor(
    message: string,
    public readonly code: 'insecure' | 'denied' | 'not-found' | 'in-use' | 'unsupported' | 'unknown',
  ) {
    super(message);
    this.name = 'CameraError';
  }
}

function describe(err: unknown): CameraError {
  const name = (err as DOMException)?.name ?? '';
  switch (name) {
    case 'NotAllowedError':
    case 'SecurityError':
      return new CameraError(
        'Camera permission was denied. Allow camera access for this site in your browser settings, then press Start camera.',
        'denied',
      );
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return new CameraError('No camera was found on this device.', 'not-found');
    case 'NotReadableError':
    case 'TrackStartError':
      return new CameraError(
        'The camera is in use by another application or tab. Close it and try again.',
        'in-use',
      );
    case 'OverconstrainedError':
      return new CameraError('The selected camera does not support the requested settings.', 'unsupported');
    default:
      return new CameraError(`Could not start the camera (${name || 'unknown error'}).`, 'unknown');
  }
}

export interface CameraInfo {
  label: string;
  width: number;
  height: number;
  frameRate: number;
}

export class Camera {
  private stream: MediaStream | null = null;

  constructor(private readonly video: HTMLVideoElement) {}

  get active(): boolean {
    return this.stream !== null;
  }

  async listDevices(): Promise<MediaDeviceInfo[]> {
    if (!navigator.mediaDevices?.enumerateDevices) return [];
    const all = await navigator.mediaDevices.enumerateDevices();
    return all.filter((d) => d.kind === 'videoinput');
  }

  async start(deviceId?: string): Promise<CameraInfo> {
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new CameraError(
        'This browser cannot access the camera here. Use a current browser and open the app via http://localhost or https.',
        window.isSecureContext ? 'unsupported' : 'insecure',
      );
    }
    this.stop();
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          deviceId: deviceId ? { exact: deviceId } : undefined,
          facingMode: deviceId ? undefined : 'user',
          width: { ideal: 1280 },
          height: { ideal: 720 },
          frameRate: { ideal: 30 },
        },
      });
    } catch (err) {
      throw describe(err);
    }

    this.video.srcObject = this.stream;
    this.video.muted = true;
    this.video.playsInline = true;
    await this.video.play();
    if (!this.video.videoWidth) {
      await new Promise<void>((resolve) =>
        this.video.addEventListener('loadedmetadata', () => resolve(), { once: true }),
      );
    }

    const track = this.stream.getVideoTracks()[0];
    const s = track.getSettings();
    // If the device is unplugged mid-session, release everything.
    track.addEventListener('ended', () => this.stop());
    return {
      label: track.label || 'Camera',
      width: this.video.videoWidth,
      height: this.video.videoHeight,
      frameRate: s.frameRate ?? 0,
    };
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
  }
}
