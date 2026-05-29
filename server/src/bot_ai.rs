use reqwest::Client;
use serde_json::json;
use tracing::warn;

use crate::auth::user_id_for_pubkey;

#[derive(Clone)]
pub struct ChatMessage {
    pub role: &'static str, // "user" or "assistant"
    pub content: String,
}

/// One entry per bot, in the same order as `BOTS` in seed.rs.
pub struct BotPersona {
    pub seed: u8,
    pub name: &'static str,
    pub system_prompt: &'static str,
}

pub const BOT_PERSONAS: &[BotPersona] = &[
    BotPersona {
        seed: 1,
        name: "Timothy",
        system_prompt: "You are Timothy, a friendly and upbeat person on a private social app called Murmur. \
            You love indie music and met your friend at a London Indie Night. \
            Keep every reply casual and short — at most two sentences. Never use corporate-speak or emoji-heavy text.",
    },
    BotPersona {
        seed: 2,
        name: "Priya",
        system_prompt: "You are Priya, a film and gaming enthusiast on Murmur. \
            You met your friend at a Hack & Chill Meetup. \
            Keep every reply casual, enthusiastic, and short — at most two sentences. \
            Feel free to drop a gaming or film reference when it fits.",
    },
    BotPersona {
        seed: 3,
        name: "Marcus",
        system_prompt: "You are Marcus, a music and book lover on Murmur who recently discovered a tiny Icelandic band. \
            You met your friend at a Friday Film Club. \
            Keep every reply thoughtful but relaxed and short — at most two sentences.",
    },
];

fn signing_key_pubkey(seed: u8) -> [u8; 32] {
    ed25519_dalek::SigningKey::from_bytes(&[seed; 32])
        .verifying_key()
        .to_bytes()
}

pub fn bot_user_ids() -> Vec<String> {
    BOT_PERSONAS
        .iter()
        .map(|p| user_id_for_pubkey(&signing_key_pubkey(p.seed)))
        .collect()
}

pub fn persona_for_bot_id(bot_id: &str) -> Option<&'static BotPersona> {
    BOT_PERSONAS
        .iter()
        .find(|p| user_id_for_pubkey(&signing_key_pubkey(p.seed)) == bot_id)
}

pub fn is_bot_id(user_id: &str) -> bool {
    BOT_PERSONAS
        .iter()
        .any(|p| user_id_for_pubkey(&signing_key_pubkey(p.seed)) == user_id)
}

/// Generate a bot reply given the full conversation history for this (bot, user) pair.
/// `history` must already include the latest user message as the last entry.
pub async fn generate_reply(
    client: &Client,
    api_key: &str,
    persona: &BotPersona,
    history: &[ChatMessage],
) -> Option<String> {
    call_deepseek_with_history(client, api_key, persona.system_prompt, history).await
}

pub async fn generate_welcome(
    client: &Client,
    api_key: &str,
    persona: &BotPersona,
) -> Option<String> {
    let history = [ChatMessage {
        role: "user",
        content: "A new friend just joined the app. Write a short, warm welcome message to them."
            .to_string(),
    }];
    call_deepseek_with_history(client, api_key, persona.system_prompt, &history).await
}

async fn call_deepseek_with_history(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Option<String> {
    let mut messages = vec![json!({"role": "system", "content": system_prompt})];
    for m in history {
        messages.push(json!({"role": m.role, "content": m.content}));
    }
    let body = json!({
        "model": "deepseek-chat",
        "messages": messages,
        "max_tokens": 150,
        "temperature": 0.8
    });

    let resp = client
        .post("https://api.deepseek.com/v1/chat/completions")
        .bearer_auth(api_key)
        .json(&body)
        .send()
        .await
        .map_err(|e| warn!(error = %e, "deepseek request failed"))
        .ok()?;

    if !resp.status().is_success() {
        warn!(status = %resp.status(), "deepseek returned non-2xx");
        return None;
    }

    let json: serde_json::Value = resp
        .json()
        .await
        .map_err(|e| warn!(error = %e, "deepseek response parse failed"))
        .ok()?;

    json["choices"][0]["message"]["content"]
        .as_str()
        .map(str::to_owned)
}
