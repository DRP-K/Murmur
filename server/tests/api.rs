use axum::body::Body;
use axum::http::{Request, StatusCode};
use ed25519_dalek::{Signer, SigningKey};
use futures_util::StreamExt;
use http_body_util::BodyExt;
use murmur_server::app::{AppState, router};
use murmur_server::auth::user_id_for_pubkey;
use murmur_server::wire::{AuthResponse, FriendListResponse, ServerEnvelope};
use serde_json::{Value, json};
use tempfile::NamedTempFile;
use tokio::net::TcpListener;
use tokio::time::{Duration, timeout};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::Message;
use tower::ServiceExt;

struct TestUser {
    user_id: String,
    pubkey_hex: String,
    key: SigningKey,
}

fn test_user(seed: u8) -> TestUser {
    let key = SigningKey::from_bytes(&[seed; 32]);
    let pubkey = key.verifying_key().to_bytes();

    TestUser {
        user_id: user_id_for_pubkey(&pubkey),
        pubkey_hex: hex::encode(pubkey),
        key,
    }
}

fn signed_auth(user: &TestUser, timestamp: i64) -> Value {
    let message = format!("{}:{}", user.user_id, timestamp);
    let signature = user.key.sign(message.as_bytes());

    json!({
        "user_id": user.user_id,
        "timestamp": timestamp,
        "signature_hex": hex::encode(signature.to_bytes()),
    })
}

fn app() -> axum::Router {
    let db = NamedTempFile::new().expect("temp db should be created");
    let path = db
        .into_temp_path()
        .keep()
        .expect("temp db path should persist");
    let state = AppState::from_database_url(path.to_str().expect("temp path should be utf8"))
        .expect("app state should initialize");

    router(state)
}

async fn request(
    app: axum::Router,
    method: &str,
    path: &str,
    token: Option<&str>,
    body: Value,
) -> axum::response::Response {
    let mut builder = Request::builder().method(method).uri(path);
    if let Some(token) = token {
        builder = builder.header("authorization", format!("Bearer {token}"));
    }

    app.oneshot(
        builder
            .header("content-type", "application/json")
            .body(Body::from(body.to_string()))
            .expect("request should build"),
    )
    .await
    .expect("request should complete")
}

async fn register_user(app: axum::Router, user: &TestUser) {
    let response = request(
        app,
        "POST",
        "/api/register",
        None,
        json!({
            "user_id": user.user_id,
            "pubkey_hex": user.pubkey_hex,
        }),
    )
    .await;

    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn auth_user(app: axum::Router, user: &TestUser) -> String {
    let timestamp = chrono::Utc::now().timestamp();
    let response = request(app, "POST", "/api/auth", None, signed_auth(user, timestamp)).await;
    assert_eq!(response.status(), StatusCode::OK);

    let body = response
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    let auth: AuthResponse = serde_json::from_slice(&body).expect("auth response should parse");
    auth.token
}

async fn spawn_server() -> (String, tokio::task::JoinHandle<()>) {
    let app = app();
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("listener should bind");
    let addr = listener
        .local_addr()
        .expect("local addr should be available");
    let handle = tokio::spawn(async move {
        axum::serve(listener, app).await.expect("server should run");
    });

    (format!("http://{addr}"), handle)
}

async fn register_user_http(client: &reqwest::Client, base: &str, user: &TestUser) {
    let response = client
        .post(format!("{base}/api/register"))
        .json(&json!({
            "user_id": user.user_id,
            "pubkey_hex": user.pubkey_hex,
        }))
        .send()
        .await
        .expect("register request should send");
    assert_eq!(response.status(), StatusCode::CREATED);
}

async fn auth_user_http(client: &reqwest::Client, base: &str, user: &TestUser) -> String {
    let response = client
        .post(format!("{base}/api/auth"))
        .json(&signed_auth(user, chrono::Utc::now().timestamp()))
        .send()
        .await
        .expect("auth request should send");
    assert_eq!(response.status(), StatusCode::OK);
    response
        .json::<AuthResponse>()
        .await
        .expect("auth response should parse")
        .token
}

#[tokio::test]
async fn register_auth_and_protected_route_behaviour() {
    let app = app();
    let alice = test_user(1);

    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &alice).await;
    let token = auth_user(app.clone(), &alice).await;
    assert!(!token.is_empty());

    let missing_auth = request(app.clone(), "GET", "/api/messages", None, json!({})).await;
    assert_eq!(missing_auth.status(), StatusCode::UNAUTHORIZED);

    let invalid_auth = request(app, "GET", "/api/messages", Some("bad-token"), json!({})).await;
    assert_eq!(invalid_auth.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn offline_message_queue_pull_and_ack() {
    let app = app();
    let alice = test_user(2);
    let bob = test_user(3);
    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &bob).await;
    let alice_token = auth_user(app.clone(), &alice).await;
    let bob_token = auth_user(app.clone(), &bob).await;

    let send = request(
        app.clone(),
        "POST",
        "/api/messages",
        Some(&alice_token),
        json!({
            "id": "m1",
            "recipient_id": bob.user_id,
            "payload_hex": "6869",
            "nonce_hex": "000000000000000000000000",
            "msg_type": "dm",
            "sent_at": 123,
        }),
    )
    .await;
    assert_eq!(send.status(), StatusCode::ACCEPTED);

    let pull = request(
        app.clone(),
        "GET",
        "/api/messages",
        Some(&bob_token),
        json!({}),
    )
    .await;
    assert_eq!(pull.status(), StatusCode::OK);
    let body = pull.into_body().collect().await.expect("body").to_bytes();
    let pulled: Value = serde_json::from_slice(&body).expect("messages response should parse");
    assert_eq!(pulled["messages"][0]["id"], "m1");

    let ack = request(
        app.clone(),
        "DELETE",
        "/api/messages/m1",
        Some(&bob_token),
        json!({}),
    )
    .await;
    assert_eq!(ack.status(), StatusCode::NO_CONTENT);

    let pull_after = request(app, "GET", "/api/messages", Some(&bob_token), json!({})).await;
    let body = pull_after
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let pulled: Value = serde_json::from_slice(&body).expect("messages response should parse");
    assert!(
        pulled["messages"]
            .as_array()
            .expect("messages array")
            .is_empty()
    );
}

#[tokio::test]
async fn post_fanout_and_friend_add() {
    let app = app();
    let alice = test_user(4);
    let bob = test_user(5);
    let carol = test_user(6);
    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &bob).await;
    register_user(app.clone(), &carol).await;
    let alice_token = auth_user(app.clone(), &alice).await;
    let bob_token = auth_user(app.clone(), &bob).await;

    let create_post = request(
        app.clone(),
        "POST",
        "/api/posts",
        Some(&alice_token),
        json!({
            "id": "p1",
            "content": "hello feed",
            "timestamp": 1000,
            "expires_at": null,
            "recipient_ids": [bob.user_id, carol.user_id],
        }),
    )
    .await;
    assert_eq!(create_post.status(), StatusCode::ACCEPTED);

    let posts = request(
        app.clone(),
        "GET",
        "/api/posts",
        Some(&bob_token),
        json!({}),
    )
    .await;
    let body = posts.into_body().collect().await.expect("body").to_bytes();
    let pulled: Value = serde_json::from_slice(&body).expect("posts response should parse");
    assert_eq!(pulled["posts"][0]["id"], "p1");

    let ack = request(
        app.clone(),
        "POST",
        "/api/posts/ack",
        Some(&bob_token),
        json!({ "post_id": "p1" }),
    )
    .await;
    assert_eq!(ack.status(), StatusCode::NO_CONTENT);

    let add_friend = request(
        app.clone(),
        "POST",
        "/api/friends",
        Some(&alice_token),
        json!({ "friend_id": bob.user_id }),
    )
    .await;
    assert_eq!(add_friend.status(), StatusCode::ACCEPTED);

    let messages = request(app, "GET", "/api/messages", Some(&bob_token), json!({})).await;
    let body = messages
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let pulled: Value = serde_json::from_slice(&body).expect("messages response should parse");
    assert_eq!(pulled["messages"][0]["msg_type"], "friend_added");
}

#[tokio::test]
async fn websocket_live_message_and_sender_ack() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let alice = test_user(7);
    let bob = test_user(8);
    register_user_http(&client, &base, &alice).await;
    register_user_http(&client, &base, &bob).await;
    let alice_token = auth_user_http(&client, &base, &alice).await;
    let bob_token = auth_user_http(&client, &base, &bob).await;

    let ws_base = base.replace("http://", "ws://");
    let (mut bob_ws, _) = connect_async(format!("{ws_base}/api/ws?token={bob_token}"))
        .await
        .expect("bob websocket should connect");
    let (mut alice_ws, _) = connect_async(format!("{ws_base}/api/ws?token={alice_token}"))
        .await
        .expect("alice websocket should connect");

    let response = client
        .post(format!("{base}/api/messages"))
        .bearer_auth(&alice_token)
        .json(&json!({
            "id": "live1",
            "recipient_id": bob.user_id,
            "payload_hex": "6869",
            "nonce_hex": "000000000000000000000000",
            "msg_type": "dm",
            "sent_at": 123,
        }))
        .send()
        .await
        .expect("message request should send");
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    let bob_msg = timeout(Duration::from_secs(2), bob_ws.next())
        .await
        .expect("bob should receive websocket message")
        .expect("bob stream should be open")
        .expect("bob message should be ok");
    let Message::Text(text) = bob_msg else {
        panic!("expected text message");
    };
    let envelope: ServerEnvelope = serde_json::from_str(&text).expect("message should parse");
    assert_eq!(
        envelope,
        ServerEnvelope::Message {
            id: "live1".to_string(),
            sender_id: alice.user_id.clone(),
            payload_hex: "6869".to_string(),
            nonce_hex: "000000000000000000000000".to_string(),
            msg_type: "dm".to_string(),
            sent_at: 123,
        }
    );

    let ack = timeout(Duration::from_secs(2), alice_ws.next())
        .await
        .expect("alice should receive ack")
        .expect("alice stream should be open")
        .expect("alice message should be ok");
    let Message::Text(text) = ack else {
        panic!("expected text ack");
    };
    let envelope: ServerEnvelope = serde_json::from_str(&text).expect("ack should parse");
    assert_eq!(
        envelope,
        ServerEnvelope::DeliveredAck {
            id: "live1".to_string()
        }
    );

    alice_ws.close(None).await.expect("alice close should send");
    bob_ws.close(None).await.expect("bob close should send");
    handle.abort();
}

#[tokio::test]
async fn add_and_list_friends() {
    let app = app();
    let alice = test_user(11);
    let bob = test_user(12);

    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &bob).await;
    let alice_token = auth_user(app.clone(), &alice).await;

    // Adding Bob as friend.
    let response = request(
        app.clone(),
        "POST",
        "/api/friends",
        Some(&alice_token),
        json!({ "friend_id": bob.user_id }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    // Listing friends returns Bob with his pubkey.
    let list_resp = request(
        app.clone(),
        "GET",
        "/api/friends",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp
        .into_body()
        .collect()
        .await
        .expect("body should collect")
        .to_bytes();
    let list: FriendListResponse =
        serde_json::from_slice(&body).expect("friend list response should parse");
    assert_eq!(list.friends.len(), 1);
    assert_eq!(list.friends[0].user_id, bob.user_id);
    assert_eq!(list.friends[0].pubkey_hex, bob.pubkey_hex);

    // Unauthenticated request.
    let unauth = request(app, "GET", "/api/friends", None, json!({})).await;
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn websocket_initial_drain_sends_pending_messages() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let alice = test_user(9);
    let bob = test_user(10);
    register_user_http(&client, &base, &alice).await;
    register_user_http(&client, &base, &bob).await;
    let alice_token = auth_user_http(&client, &base, &alice).await;
    let bob_token = auth_user_http(&client, &base, &bob).await;

    let response = client
        .post(format!("{base}/api/messages"))
        .bearer_auth(&alice_token)
        .json(&json!({
            "id": "pending1",
            "recipient_id": bob.user_id,
            "payload_hex": "6869",
            "nonce_hex": "000000000000000000000000",
            "msg_type": "dm",
            "sent_at": 124,
        }))
        .send()
        .await
        .expect("message request should send");
    assert_eq!(response.status(), StatusCode::ACCEPTED);

    let ws_base = base.replace("http://", "ws://");
    let (mut bob_ws, _) = connect_async(format!("{ws_base}/api/ws?token={bob_token}"))
        .await
        .expect("bob websocket should connect");

    let drained = timeout(Duration::from_secs(2), bob_ws.next())
        .await
        .expect("bob should receive pending message")
        .expect("bob stream should be open")
        .expect("bob message should be ok");
    let Message::Text(text) = drained else {
        panic!("expected text pending message");
    };
    let envelope: ServerEnvelope = serde_json::from_str(&text).expect("message should parse");
    assert!(matches!(envelope, ServerEnvelope::Message { id, .. } if id == "pending1"));

    bob_ws.close(None).await.expect("bob close should send");
    handle.abort();
}
