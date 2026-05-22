import { useState } from "react";
import { cmd } from "../commands";
import { useStore } from "../store";
import Header from "../components/Header";

export default function MePage() {
  const { identity, setIdentity } = useStore();
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(identity?.display_name ?? "");
  const [saving, setSaving] = useState(false);

  const save = async () => {
    if (!name.trim()) return;
    setSaving(true);
    await cmd.setDisplayName(name.trim());
    const updated = await cmd.getOrCreateIdentity();
    setIdentity(updated);
    setSaving(false);
    setEditing(false);
  };

  return (
    <div className="flex flex-col h-full">
      <Header title="Me" />
      <div className="flex-1 overflow-y-auto pb-16 px-4 pt-8">
        <div className="flex flex-col items-center gap-3 mb-8">
          <div className="w-20 h-20 rounded-full bg-indigo-100 text-indigo-700 font-bold text-3xl flex items-center justify-center">
            {(identity?.display_name ?? "?").slice(0, 1).toUpperCase()}
          </div>
          {editing ? (
            <div className="flex gap-2 mt-1">
              <input
                autoFocus
                className="border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-300"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Display name"
              />
              <button
                onClick={save}
                disabled={saving}
                className="bg-indigo-600 text-white rounded-xl px-4 text-sm font-medium disabled:opacity-40"
              >
                {saving ? "…" : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="text-gray-400 text-sm px-2"
              >
                ×
              </button>
            </div>
          ) : (
            <button
              onClick={() => { setEditing(true); setName(identity?.display_name ?? ""); }}
              className="text-base font-semibold text-gray-900 hover:text-indigo-600"
            >
              {identity?.display_name ?? "Set display name"} ✎
            </button>
          )}
          <p className="text-xs text-gray-400">
            Shown only to friends who added you
          </p>
        </div>

        <div className="bg-white rounded-2xl border border-gray-100 divide-y divide-gray-100">
          <div className="px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Your ID</p>
            <p className="font-mono text-xs text-gray-700 break-all">
              {identity?.user_id}
            </p>
          </div>
          <div className="px-4 py-3">
            <p className="text-xs text-gray-400 mb-1">Public key</p>
            <p className="font-mono text-xs text-gray-500 break-all">
              {identity?.pubkey_hex}
            </p>
          </div>
        </div>

        <p className="text-xs text-center text-gray-400 mt-6 leading-relaxed px-4">
          Your identity is a cryptographic keypair stored locally.
          No account, no email, no phone number required.
        </p>
      </div>
    </div>
  );
}
