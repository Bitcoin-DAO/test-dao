// QR codes: rendering (SVG path) and scanning from the camera.
import qrcode from 'qrcode-generator';
import jsQR from 'jsqr';

export interface QrMatrix {
  size: number;
  path: string; // SVG path of dark modules, 1 unit each
}

/** Alphanumeric mode for identity cards (upper case), byte mode otherwise. */
export function qrMatrix(text: string, ecc: 'L' | 'M' | 'Q' | 'H' = 'M'): QrMatrix {
  const alnum = /^[0-9A-Z $%*+\-./:]*$/.test(text);
  const qr = qrcode(0, ecc);
  qr.addData(text, alnum ? 'Alphanumeric' : 'Byte');
  qr.make();
  const n = qr.getModuleCount();
  let path = '';
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) if (qr.isDark(r, c)) path += `M${c} ${r}h1v1h-1z`;
  return { size: n, path };
}

export interface Scanner {
  stop(): void;
}

interface BarcodeDetectorLike {
  detect(source: CanvasImageSource): Promise<{ rawValue: string }[]>;
}

/** Start the back camera in `video`, call onText for each decoded QR until stopped. */
export async function startScanner(video: HTMLVideoElement, onText: (text: string) => void, everyMs = 200): Promise<Scanner> {
  const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
  video.srcObject = stream;
  video.setAttribute('playsinline', 'true');
  await video.play();
  const BD = (window as unknown as { BarcodeDetector?: new (o: object) => BarcodeDetectorLike }).BarcodeDetector;
  const detector = BD ? new BD({ formats: ['qr_code'] }) : undefined;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
  let stopped = false;
  const tick = async () => {
    if (stopped) return;
    try {
      if (video.readyState >= 2) {
        let text: string | undefined;
        if (detector) {
          const r = await detector.detect(video);
          text = r[0]?.rawValue;
        } else {
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0);
          text = jsQR(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height)?.data;
        }
        if (text) onText(text);
      }
    } catch {
      /* keep scanning */
    }
    setTimeout(tick, everyMs);
  };
  tick();
  return {
    stop() {
      stopped = true;
      stream.getTracks().forEach(t => t.stop());
      video.srcObject = null;
    },
  };
}
