use reqwest::Client;
use serde_json::Value;
use tracing::warn;

#[derive(Clone)]
pub struct MediaPost {
    pub content: String,
    pub category: &'static str,
    pub media_ref_name: String,
    pub image_url: String,
    pub bot_index: usize,
}

const GAME_TEMPLATES: &[&str] = &[
    "Currently obsessed with {name} — can't put it down 🎮",
    "Just started {name} and I'm already hooked 🕹️",
    "Replaying {name} for the third time this year 🎮",
    "{name} hit different at 2am ngl",
    "Anyone else playing {name}? Need someone to chat with about it 🕹️",
];

const MUSIC_TEMPLATES: &[&str] = &[
    "Can't stop listening to \"{name}\" 🎵",
    "\"{name}\" has been on repeat all day",
    "Discovered \"{name}\" today and wow 🎶",
    "The right song at the right time: \"{name}\"",
    "\"{name}\" — some tracks just don't get old 🎵",
];

fn game_content(name: &str, idx: usize) -> String {
    GAME_TEMPLATES[idx % GAME_TEMPLATES.len()].replace("{name}", name)
}

fn music_content(name: &str, idx: usize) -> String {
    MUSIC_TEMPLATES[idx % MUSIC_TEMPLATES.len()].replace("{name}", name)
}

struct RawgQuery {
    search: Option<&'static str>,
    tag: Option<&'static str>,
    page_size: u8,
}

pub async fn fetch_rawg_games(client: &Client, api_key: &str) -> Vec<MediaPost> {
    let queries = [
        RawgQuery {
            search: Some("RAID Shadow Legends"),
            tag: None,
            page_size: 3,
        },
        RawgQuery {
            search: Some("Minecraft"),
            tag: None,
            page_size: 3,
        },
        RawgQuery {
            search: None,
            tag: Some("role-playing-games"),
            page_size: 4,
        },
        RawgQuery {
            search: None,
            tag: Some("sandbox"),
            page_size: 4,
        },
        RawgQuery {
            search: None,
            tag: Some("adventure"),
            page_size: 4,
        },
        RawgQuery {
            search: None,
            tag: Some("turn-based-combat"),
            page_size: 4,
        },
        RawgQuery {
            search: None,
            tag: Some("mobile"),
            page_size: 4,
        },
        RawgQuery {
            search: Some("Microsoft"),
            tag: None,
            page_size: 4,
        },
    ];

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut posts: Vec<MediaPost> = Vec::new();

    for q in &queries {
        let mut url = format!(
            "https://api.rawg.io/api/games?key={}&page_size={}",
            api_key, q.page_size
        );
        if let Some(s) = q.search {
            url.push_str(&format!("&search={}", s.replace(' ', "+")));
        }
        if let Some(t) = q.tag {
            url.push_str(&format!("&tags={}", t));
        }

        let json: Value = match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    warn!(error = %e, "rawg json parse failed");
                    continue;
                }
            },
            Ok(resp) => {
                warn!(status = %resp.status(), url = %url, "rawg non-2xx");
                continue;
            }
            Err(e) => {
                warn!(error = %e, url = %url, "rawg request failed");
                continue;
            }
        };

        let results = match json["results"].as_array() {
            Some(r) => r,
            None => continue,
        };

        for item in results {
            let name = match item["name"].as_str() {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };
            let image_url = match item["background_image"].as_str() {
                Some(u) if !u.is_empty() => u.to_string(),
                _ => continue,
            };
            if !seen.insert(name.to_lowercase()) {
                continue;
            }
            let idx = posts.len();
            posts.push(MediaPost {
                content: game_content(&name, idx),
                category: "games",
                media_ref_name: name,
                image_url,
                bot_index: idx % 3,
            });
        }

        if posts.len() >= 25 {
            break;
        }
    }

    posts.truncate(25);
    posts
}

struct ItunesQuery {
    term: &'static str,
    limit: u8,
}

pub async fn fetch_itunes_music(client: &Client) -> Vec<MediaPost> {
    let queries = [
        ItunesQuery {
            term: "indie pop",
            limit: 5,
        },
        ItunesQuery {
            term: "hip hop",
            limit: 5,
        },
        ItunesQuery {
            term: "classic rock",
            limit: 5,
        },
        ItunesQuery {
            term: "electronic",
            limit: 5,
        },
        ItunesQuery {
            term: "sports anthem",
            limit: 5,
        },
    ];

    let mut seen: std::collections::HashSet<String> = std::collections::HashSet::new();
    let mut posts: Vec<MediaPost> = Vec::new();

    for q in &queries {
        let url = format!(
            "https://itunes.apple.com/search?term={}&media=music&entity=song&limit={}",
            q.term.replace(' ', "+"),
            q.limit
        );

        let json: Value = match client.get(&url).send().await {
            Ok(resp) if resp.status().is_success() => match resp.json().await {
                Ok(v) => v,
                Err(e) => {
                    warn!(error = %e, "itunes json parse failed");
                    continue;
                }
            },
            Ok(resp) => {
                warn!(status = %resp.status(), "itunes non-2xx");
                continue;
            }
            Err(e) => {
                warn!(error = %e, "itunes request failed");
                continue;
            }
        };

        let results = match json["results"].as_array() {
            Some(r) => r,
            None => continue,
        };

        for item in results {
            let name = match item["trackName"].as_str() {
                Some(n) if !n.is_empty() => n.to_string(),
                _ => continue,
            };
            let image_url = match item["artworkUrl100"].as_str() {
                Some(u) if !u.is_empty() => u.to_string(),
                _ => continue,
            };
            if !seen.insert(name.to_lowercase()) {
                continue;
            }
            let idx = posts.len();
            posts.push(MediaPost {
                content: music_content(&name, idx),
                category: "music",
                media_ref_name: name,
                image_url,
                bot_index: idx % 3,
            });
        }
    }

    posts.truncate(25);
    posts
}
