mod commands;
mod crypto;
mod db;
mod relay;

use commands::*;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir().expect("no app data dir");
            std::fs::create_dir_all(&data_dir).ok();
            let db_path = data_dir.join("social.db");
            db::init(db_path.to_str().unwrap()).expect("failed to open DB");

            // Optionally override server URL via env var
            if let Ok(url) = std::env::var("RELAY_URL") {
                relay::SERVER_URL.set(url).ok();
            }

            // Bootstrap relay in background (non-blocking — app starts even if server is down)
            let db_conn = db::get().lock().unwrap();
            let identity: Option<(String, String, String)> = db_conn
                .query_row(
                    "SELECT user_id, pubkey_hex, privkey_hex FROM identity LIMIT 1",
                    [],
                    |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?)),
                )
                .ok();
            drop(db_conn);

            if let Some((uid, pub_hex, prv_hex)) = identity {
                tauri::async_runtime::spawn(relay::bootstrap(uid, pub_hex, prv_hex));
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_or_create_identity,
            set_display_name,
            get_qr_payload,
            get_friends,
            add_friend_from_qr,
            set_nickname,
            block_friend,
            get_conversations,
            get_messages,
            send_message,
            get_feed,
            create_post,
            react_to_post,
            reach_out_anon,
            get_anon_threads,
            get_anon_messages,
            send_anon_message,
            reveal_identity,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
