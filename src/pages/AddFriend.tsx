import { useEffect, useRef, useState } from "react";
import { cmd } from "../commands";
import QRCode from "qrcode";
import Header from "../components/Header";

interface Props {
  onBack: () => void;
}

export default function AddFriend({ onBack }: Props) {
  const [tab, setTab] = useState<"show" | "scan">("show");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [manualId, setManualId] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const scanIntervalRef = useRef<number | null>(null);

  useEffect(() => {
    cmd.getQrPayload().then(async (payload) => {
      const parsed = JSON.parse(payload) as { user_id: string };
      setUserId(parsed.user_id);
      const url = await QRCode.toDataURL(payload, { width: 240, margin: 2 });
      setQrDataUrl(url);
    });
    return () => stopCamera();
  }, []);

  const startCamera = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.play();
      }
      scanIntervalRef.current = window.setInterval(scanFrame, 300);
    } catch {
      console.error("Camera access denied");
    }
  };

  const stopCamera = () => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (scanIntervalRef.current) clearInterval(scanIntervalRef.current);
  };

  useEffect(() => {
    if (tab === "scan") startCamera();
    else stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const scanFrame = () => {
    const video = videoRef.current;
    const canvas = canvasRef.current;
    if (!video || !canvas || video.readyState !== video.HAVE_ENOUGH_DATA) return;
    const ctx = canvas.getContext("2d")!;
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    ctx.drawImage(video, 0, 0);
    const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    import("jsqr").then(({ default: jsQR }) => {
      const code = jsQR(imageData.data, imageData.width, imageData.height);
      if (code?.data) handleQrPayload(code.data);
    });
  };

  const handleQrPayload = async (payload: string) => {
    stopCamera();
    setAdding(true);
    setAddError(null);
    try {
      await cmd.addFriendFromQr(payload);
      onBack();
    } catch (e) {
      setAddError(String(e));
      setAdding(false);
    }
  };

  const addManually = async () => {
    if (!manualId.trim()) return;
    await handleQrPayload(manualId.trim());
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Add Friend" onBack={onBack} />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white shrink-0">
        {(["show", "scan"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500"
            }`}
          >
            {t === "show" ? "My QR code" : "Scan QR"}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto pb-16 flex flex-col items-center">
        {tab === "show" && (
          <div className="flex flex-col items-center pt-8 px-6 gap-4">
            <p className="text-sm text-gray-500">Show this to your friend:</p>
            {qrDataUrl ? (
              <img
                src={qrDataUrl}
                alt="Your QR code"
                className="w-56 h-56 rounded-2xl border border-gray-200 shadow-sm"
              />
            ) : (
              <div className="w-56 h-56 bg-gray-100 rounded-2xl flex items-center justify-center text-gray-400 text-sm">
                Loading…
              </div>
            )}
            <div className="w-full bg-gray-50 rounded-xl p-3 border border-gray-100">
              <p className="text-xs text-gray-400 mb-1">Your ID</p>
              <p className="font-mono text-xs text-gray-700 break-all">{userId}</p>
            </div>
          </div>
        )}

        {tab === "scan" && (
          <div className="flex flex-col items-center pt-6 px-4 gap-4 w-full">
            <div className="relative w-full max-w-sm aspect-square bg-black rounded-2xl overflow-hidden">
              <video ref={videoRef} className="w-full h-full object-cover" muted playsInline />
              <canvas ref={canvasRef} className="hidden" />
              {/* Viewfinder overlay */}
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 border-2 border-white/70 rounded-xl" />
              </div>
            </div>
            <p className="text-sm text-gray-500">Align the QR code in the box</p>

            <div className="w-full max-w-sm mt-2">
              <p className="text-xs text-gray-400 mb-2 text-center">Or enter ID manually:</p>
              <div className="flex gap-2">
                <input
                  className="flex-1 border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-300"
                  placeholder="Paste friend's ID…"
                  value={manualId}
                  onChange={(e) => setManualId(e.target.value)}
                />
                <button
                  onClick={addManually}
                  disabled={!manualId.trim() || adding}
                  className="bg-indigo-600 text-white rounded-xl px-4 text-sm font-medium disabled:opacity-40"
                >
                  Add
                </button>
              </div>
              {addError && (
                <p className="text-xs text-red-500 mt-2">{addError}</p>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
