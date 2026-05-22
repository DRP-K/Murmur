import { useEffect, useRef, useState } from "react";
import { cmd } from "../commands";
import QRCode from "qrcode";
import Header from "../components/Header";

interface Props {
  onBack: () => void;
}

export default function AddFriend({ onBack }: Props) {
  const [tab, setTab] = useState<"show" | "scan" | "id">("show");
  const [qrDataUrl, setQrDataUrl] = useState<string | null>(null);
  const [userId, setUserId] = useState<string>("");
  const [pendingPayload, setPendingPayload] = useState<string | null>(null);
  const [note, setNote] = useState("");
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
    if (tab === "scan" && !pendingPayload) startCamera();
    else stopCamera();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, pendingPayload]);

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
      if (code?.data) {
        stopCamera();
        setAddError(null);
        setPendingPayload(code.data);
        setNote("");
      }
    });
  };

  const confirmAdd = async () => {
    if (!pendingPayload) return;
    setAdding(true);
    setAddError(null);
    try {
      await cmd.addFriendFromQr(pendingPayload, note.trim() || undefined);
      onBack();
    } catch (e) {
      setAddError(String(e));
      setAdding(false);
    }
  };

  const cancelPending = () => {
    setPendingPayload(null);
    setNote("");
    setAddError(null);
  };

  // Note-entry confirmation step (shown after scan)
  if (pendingPayload) {
    return (
      <div className="flex flex-col h-full">
        <Header title="Add Friend" onBack={cancelPending} />
        <div className="flex-1 flex flex-col items-center justify-center px-6 gap-5">
          <div className="w-full max-w-sm bg-green-50 border border-green-200 rounded-xl px-4 py-3 text-sm text-green-800 text-center">
            QR scanned — friend ready to add
          </div>
          <div className="w-full max-w-sm">
            <label className="block text-sm font-medium text-gray-700 mb-1">
              Where did you meet? <span className="text-gray-400 font-normal">(optional)</span>
            </label>
            <input
              autoFocus
              className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-300"
              placeholder="e.g. Fresher's Fair, game convention…"
              value={note}
              onChange={(e) => setNote(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && confirmAdd()}
            />
            <p className="text-xs text-gray-400 mt-1.5">
              This is private — only you can see it.
            </p>
          </div>
          {addError && (
            <p className="text-xs text-red-500">{addError}</p>
          )}
          <div className="flex gap-3 w-full max-w-sm">
            <button
              onClick={cancelPending}
              className="flex-1 py-2.5 rounded-xl border border-gray-200 text-sm text-gray-600"
            >
              Cancel
            </button>
            <button
              onClick={confirmAdd}
              disabled={adding}
              className="flex-1 py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-40"
            >
              {adding ? "Adding…" : "Add Friend"}
            </button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      <Header title="Add Friend" onBack={onBack} />

      {/* Tabs */}
      <div className="flex border-b border-gray-200 bg-white shrink-0">
        {(["show", "scan", "id"] as const).map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`flex-1 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t
                ? "border-indigo-600 text-indigo-600"
                : "border-transparent text-gray-500"
            }`}
          >
            {t === "show" ? "My QR" : t === "scan" ? "Scan QR" : "By ID"}
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
              <div className="absolute inset-0 flex items-center justify-center">
                <div className="w-48 h-48 border-2 border-white/70 rounded-xl" />
              </div>
            </div>
            <p className="text-sm text-gray-500">Align the QR code in the box</p>
          </div>
        )}

        {tab === "id" && (
          <AddById onDone={onBack} />
        )}
      </div>
    </div>
  );
}

function AddById({ onDone }: { onDone: () => void }) {
  const [inputId, setInputId] = useState("");
  const [note, setNote] = useState("");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const id = inputId.trim();
    if (!id || adding) return;
    setAdding(true);
    setError(null);
    try {
      await cmd.addFriendById(id, note.trim() || undefined);
      onDone();
    } catch (e) {
      setError(String(e));
      setAdding(false);
    }
  };

  return (
    <div className="flex flex-col items-center pt-8 px-6 gap-4 w-full max-w-sm mx-auto">
      <p className="text-sm text-gray-500 text-center">
        Enter your friend's user ID to add them directly.
      </p>
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 mb-1">User ID</label>
        <input
          autoFocus
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm font-mono focus:outline-none focus:border-indigo-300"
          placeholder="Paste their ID here…"
          value={inputId}
          onChange={(e) => setInputId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      <div className="w-full">
        <label className="block text-sm font-medium text-gray-700 mb-1">
          Where did you meet? <span className="text-gray-400 font-normal">(optional)</span>
        </label>
        <input
          className="w-full border border-gray-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-indigo-300"
          placeholder="e.g. Fresher's Fair…"
          value={note}
          onChange={(e) => setNote(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
        />
      </div>
      {error && <p className="text-xs text-red-500 text-center">{error}</p>}
      <button
        onClick={submit}
        disabled={!inputId.trim() || adding}
        className="w-full py-2.5 rounded-xl bg-indigo-600 text-white text-sm font-medium disabled:opacity-40"
      >
        {adding ? "Looking up…" : "Add Friend"}
      </button>
    </div>
  );
}
