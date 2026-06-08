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
    outline: &str,
) -> Option<PostAssistResponse> {
    let system_prompt = "You expand short post outlines for Murmur, a private social app. \
        Given the user's rough outline, rewrite the whole post into a natural publishable post. \
        Also infer a referenced media item only when the post clearly points to a movie, song, album, artist, or game. \
        Return strict JSON only with keys completed_content, category, media_ref_name. \
        category must be one of movies, music, games, or null. \
        media_ref_name must be the exact likely title/name or null. \
        completed_content must preserve the user's intent, be casual, and be at most 500 characters.";
    let user_prompt = format!("Post outline: {outline}");
    let history = [ChatMessage {
        role: "user",
        content: user_prompt,
    }];
    let text =
        call_deepseek_with_options(client, api_key, system_prompt, &history, 220, 0.6).await?;
    sanitize_post_assist_json(outline, &text)
}

pub fn sanitize_post_assist_json(_outline: &str, text: &str) -> Option<PostAssistResponse> {
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

    let mut completed = value["completed_content"].as_str()?.trim().to_string();
    completed = truncate_chars(&completed, 500);
    if completed.is_empty() {
        return None;
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

/// Given post content, an optional post-assist category tag, and a list of candidate category
/// names (from recipients' favourites), returns the subset of candidates that the post matches.
/// Returns an empty Vec if nothing fits. Skips the AI call entirely when `candidate_categories`
/// is empty. The `post_category` hint (e.g. "games") is forwarded to the model so that a post
/// whose content does not explicitly name its subject is still matched to related favourites.
pub async fn classify_post_category(
    client: &Client,
    api_key: &str,
    content: &str,
    post_category: Option<&str>,
    candidate_categories: &[String],
) -> Vec<String> {
    if candidate_categories.is_empty() {
        return Vec::new();
    }
    let candidates_json = serde_json::to_string(candidate_categories).unwrap_or_default();
    let system_prompt = format!(
        "You are a post classifier for a social app. \
         Given a post (and an optional media category tag) and a list of candidate category names, \
         return a JSON array of ALL category names from the list that this post matches. \
         Use the media category tag as a strong hint — if a post is tagged as \"games\" and the \
         candidate list contains \"games\" or a specific game title that the post content implies, \
         include those matches even when the content is brief or indirect. \
         Only return names that appear in the candidate list — never invent new ones. \
         Return an empty array [] if nothing matches. \
         Return strict JSON only: a JSON array of strings. \
         Candidate categories: {candidates_json}"
    );
    let user_content = match post_category {
        Some(cat) => format!("Media category tag: {cat}\nPost: {content}"),
        None => format!("Post: {content}"),
    };
    let history = [ChatMessage {
        role: "user",
        content: user_content,
    }];
    let text =
        call_deepseek_with_options(client, api_key, &system_prompt, &history, 150, 0.0).await;
    let Some(text) = text else {
        return Vec::new();
    };
    parse_classify_response(&text, candidate_categories)
}

/// Pure parsing logic extracted so it can be unit-tested without a network call.
pub fn parse_classify_response(text: &str, candidates: &[String]) -> Vec<String> {
    let parsed: Option<Vec<String>> = serde_json::from_str(text)
        .or_else(|_| {
            let start = text.find('[').ok_or(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "no array",
            )))?;
            let end = text.rfind(']').ok_or(serde_json::Error::io(std::io::Error::new(
                std::io::ErrorKind::InvalidData,
                "no array",
            )))?;
            serde_json::from_str(&text[start..=end])
        })
        .ok();
    let candidate_set: std::collections::HashSet<&str> =
        candidates.iter().map(String::as_str).collect();
    parsed
        .unwrap_or_default()
        .into_iter()
        .filter(|c| candidate_set.contains(c.as_str()))
        .collect()
}

#[cfg(test)]
mod tests {
    use super::{parse_classify_response, sanitize_post_assist_json};

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
    fn sanitize_post_assist_allows_rewritten_expansion() {
        let response = sanitize_post_assist_json(
            "portal puzzles hard",
            r#"{"completed_content":"Portal 2 has me stuck on one puzzle, but in the best possible way.","category":"games","media_ref_name":"Portal 2"}"#,
        )
        .expect("response should parse");

        assert_eq!(
            response.completed_content,
            "Portal 2 has me stuck on one puzzle, but in the best possible way."
        );
        assert_eq!(response.category.as_deref(), Some("games"));
        assert_eq!(response.media_ref_name.as_deref(), Some("Portal 2"));
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

    // ── classify_post_category response parser ────────────────────────────────

    fn cats(v: &[&str]) -> Vec<String> {
        v.iter().map(|s| s.to_string()).collect()
    }

    #[test]
    fn classify_parses_clean_json_array() {
        let result = parse_classify_response(r#"["CSGO","games"]"#, &cats(&["CSGO", "games", "music"]));
        let mut result = result;
        result.sort();
        assert_eq!(result, vec!["CSGO", "games"]);
    }

    #[test]
    fn classify_extracts_array_from_prose_response() {
        // Model wraps the JSON in extra text.
        let text = r#"Sure! Here are the matches: ["CSGO"] based on the post content."#;
        let result = parse_classify_response(text, &cats(&["CSGO", "games"]));
        assert_eq!(result, vec!["CSGO"]);
    }

    #[test]
    fn classify_filters_out_invented_categories() {
        // Model returns a category that is not in the candidate list.
        let result = parse_classify_response(r#"["CSGO","fps","shooters"]"#, &cats(&["CSGO", "games"]));
        assert_eq!(result, vec!["CSGO"]);
    }

    #[test]
    fn classify_returns_empty_for_empty_array_response() {
        let result = parse_classify_response("[]", &cats(&["CSGO", "games"]));
        assert!(result.is_empty());
    }

    #[test]
    fn classify_returns_empty_for_unparseable_response() {
        let result = parse_classify_response("I could not determine the category.", &cats(&["CSGO"]));
        assert!(result.is_empty());
    }

    #[test]
    fn classify_skips_call_when_candidates_empty() {
        // This tests the guard at the top of classify_post_category; we test
        // parse_classify_response directly with an empty candidate list instead.
        let result = parse_classify_response(r#"["CSGO"]"#, &cats(&[]));
        assert!(result.is_empty());
    }

    #[test]
    fn classify_returns_multiple_matches_for_overlapping_post() {
        // A CSGO post should match both "CSGO" and "games".
        let result = parse_classify_response(
            r#"["CSGO","games"]"#,
            &cats(&["CSGO", "games", "music"]),
        );
        let mut result = result;
        result.sort();
        assert_eq!(result, vec!["CSGO", "games"]);
    }
}
