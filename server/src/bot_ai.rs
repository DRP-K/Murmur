use reqwest::Client;
use serde_json::Value;
use serde_json::json;
use tracing::warn;

use crate::auth::user_id_for_pubkey;
use crate::wire::PostAssistResponse;

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

pub async fn generate_post_assist(
    client: &Client,
    api_key: &str,
    prefix: &str,
) -> Option<PostAssistResponse> {
    let system_prompt = "You autocomplete short posts for Murmur, a private social app. \
        Given the user's partial post, infer a natural complete post they may want to publish. \
        Also infer a referenced media item only when the post clearly points to a movie, song, album, artist, or game. \
        Return strict JSON only with keys completed_content, category, media_ref_name. \
        category must be one of movies, music, games, or null. \
        media_ref_name must be the exact likely title/name or null. \
        completed_content must start with the user's partial post, be casual, and be at most 500 characters.";
    let user_prompt = format!("Partial post: {prefix}");
    let history = [ChatMessage {
        role: "user",
        content: user_prompt,
    }];
    let text =
        call_deepseek_with_options(client, api_key, system_prompt, &history, 220, 0.6).await?;
    sanitize_post_assist_json(prefix, &text)
}

pub fn sanitize_post_assist_json(prefix: &str, text: &str) -> Option<PostAssistResponse> {
    let value: Value = serde_json::from_str(text)
        .or_else(|_| {
            let start = text
                .find('{')
                .ok_or(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "missing json object",
                )))?;
            let end = text
                .rfind('}')
                .ok_or(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    "missing json object",
                )))?;
            serde_json::from_str(&text[start..=end])
        })
        .map_err(|e| warn!(error = %e, "post assist json parse failed"))
        .ok()?;

    let trimmed_prefix = prefix.trim();
    let mut completed = value["completed_content"].as_str()?.trim().to_string();
    completed = truncate_chars(&completed, 500);
    if completed.is_empty() || !completed.starts_with(trimmed_prefix) {
        completed = format!("{trimmed_prefix} {}", completed).trim().to_string();
        completed = truncate_chars(&completed, 500);
    }

    let category = value["category"]
        .as_str()
        .map(str::trim)
        .and_then(|category| match category {
            "movies" | "music" | "games" => Some(category.to_string()),
            _ => None,
        });
    let media_ref_name = value["media_ref_name"]
        .as_str()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .map(str::to_string);
    let (category, media_ref_name) = match (category, media_ref_name) {
        (Some(category), Some(media_ref_name)) => (Some(category), Some(media_ref_name)),
        _ => (None, None),
    };

    Some(PostAssistResponse {
        completed_content: completed,
        category,
        media_ref_name,
    })
}

fn truncate_chars(value: &str, max_chars: usize) -> String {
    value
        .chars()
        .take(max_chars)
        .collect::<String>()
        .trim_end()
        .to_string()
}

async fn call_deepseek_with_history(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    history: &[ChatMessage],
) -> Option<String> {
    call_deepseek_with_options(client, api_key, system_prompt, history, 150, 0.8).await
}

async fn call_deepseek_with_options(
    client: &Client,
    api_key: &str,
    system_prompt: &str,
    history: &[ChatMessage],
    max_tokens: u16,
    temperature: f32,
) -> Option<String> {
    let mut messages = vec![json!({"role": "system", "content": system_prompt})];
    for m in history {
        messages.push(json!({"role": m.role, "content": m.content}));
    }
    let body = json!({
        "model": "deepseek-chat",
        "messages": messages,
        "max_tokens": max_tokens,
        "temperature": temperature
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

#[cfg(test)]
mod tests {
    use super::sanitize_post_assist_json;

    #[test]
    fn sanitize_post_assist_accepts_allowed_media() {
        let response = sanitize_post_assist_json(
            "Recently playing",
            r#"{"completed_content":"Recently playing Portal 2 again tonight","category":"games","media_ref_name":"Portal 2"}"#,
        )
        .expect("response should parse");

        assert_eq!(
            response.completed_content,
            "Recently playing Portal 2 again tonight"
        );
        assert_eq!(response.category.as_deref(), Some("games"));
        assert_eq!(response.media_ref_name.as_deref(), Some("Portal 2"));
    }

    #[test]
    fn sanitize_post_assist_drops_invalid_media() {
        let response = sanitize_post_assist_json(
            "Thinking about",
            r#"{"completed_content":"Thinking about Portal 2 puzzles","category":"books","media_ref_name":"Portal 2"}"#,
        )
        .expect("response should parse");

        assert_eq!(response.category, None);
        assert_eq!(response.media_ref_name, None);
    }

    #[test]
    fn sanitize_post_assist_truncates_unicode_safely() {
        let long_text = format!("我想聊聊{}", "游戏".repeat(300));
        let payload = serde_json::json!({
            "completed_content": long_text,
            "category": null,
            "media_ref_name": null
        })
        .to_string();

        let response = sanitize_post_assist_json("我想", &payload).expect("response should parse");
        assert_eq!(response.completed_content.chars().count(), 500);
    }
}
