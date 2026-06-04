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
    let state =
        AppState::from_database_url_without_ai(path.to_str().expect("temp path should be utf8"))
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
    assert!(
        pulled["messages"]
            .as_array()
            .expect("messages array")
            .iter()
            .any(|m| m["msg_type"] == "friend_added"),
        "expected a friend_added message in the queue"
    );
}

#[tokio::test]
async fn rally_post_creates_group_and_group_messages_flow() {
    let app = app();
    let alice = test_user(60);
    let bob = test_user(61);
    let carol = test_user(62);
    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &bob).await;
    register_user(app.clone(), &carol).await;
    let alice_token = auth_user(app.clone(), &alice).await;
    let bob_token = auth_user(app.clone(), &bob).await;
    let carol_token = auth_user(app.clone(), &carol).await;

    let create = request(
        app.clone(),
        "POST",
        "/api/posts",
        Some(&alice_token),
        json!({
            "id": "rally-post",
            "content": "Portal 2 tonight?",
            "timestamp": 1000,
            "recipient_ids": [bob.user_id, carol.user_id],
            "rally": { "group_id": "group-1", "max_members": 2 },
        }),
    )
    .await;
    assert_eq!(create.status(), StatusCode::ACCEPTED);

    let groups = request(
        app.clone(),
        "GET",
        "/api/groups",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(groups.status(), StatusCode::OK);
    let body = groups.into_body().collect().await.expect("body").to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("groups response");
    assert_eq!(body["groups"][0]["id"], "group-1");
    assert_eq!(body["groups"][0]["members"].as_array().unwrap().len(), 1);

    let posts = request(
        app.clone(),
        "GET",
        "/api/posts",
        Some(&bob_token),
        json!({}),
    )
    .await;
    let body = posts.into_body().collect().await.expect("body").to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("posts response");
    assert_eq!(body["posts"][0]["rally_group_id"], "group-1");
    assert_eq!(body["posts"][0]["rally_max_members"], 2);

    let join = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/join",
        Some(&bob_token),
        json!({}),
    )
    .await;
    assert_eq!(join.status(), StatusCode::OK);
    let body = join.into_body().collect().await.expect("body").to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("join response");
    assert_eq!(body["members"].as_array().unwrap().len(), 2);

    let duplicate_join = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/join",
        Some(&bob_token),
        json!({}),
    )
    .await;
    assert_eq!(duplicate_join.status(), StatusCode::OK);

    let full_join = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/join",
        Some(&carol_token),
        json!({}),
    )
    .await;
    assert_eq!(full_join.status(), StatusCode::CONFLICT);

    let non_member_send = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/messages",
        Some(&carol_token),
        json!({ "id": "gm-bad", "payload_hex": "6869", "sent_at": 1001 }),
    )
    .await;
    assert_eq!(non_member_send.status(), StatusCode::FORBIDDEN);

    let send = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/messages",
        Some(&bob_token),
        json!({ "id": "gm-1", "payload_hex": "6869", "sent_at": 1002 }),
    )
    .await;
    assert_eq!(send.status(), StatusCode::ACCEPTED);

    let pending = request(
        app.clone(),
        "GET",
        "/api/groups/group-1/messages",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(pending.status(), StatusCode::OK);
    let body = pending
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("group messages response");
    assert_eq!(body["messages"][0]["id"], "gm-1");
    assert_eq!(body["messages"][0]["type"], "group_message");

    let ack = request(
        app.clone(),
        "POST",
        "/api/groups/group-1/messages/ack",
        Some(&alice_token),
        json!({ "message_id": "gm-1" }),
    )
    .await;
    assert_eq!(ack.status(), StatusCode::NO_CONTENT);

    let pending_after = request(
        app,
        "GET",
        "/api/groups/group-1/messages",
        Some(&alice_token),
        json!({}),
    )
    .await;
    let body = pending_after
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("group messages response");
    assert!(body["messages"].as_array().unwrap().is_empty());
}

#[tokio::test]
async fn group_join_pushes_member_count_update_to_online_members() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let alice = test_user(73);
    let bob = test_user(74);
    register_user_http(&client, &base, &alice).await;
    register_user_http(&client, &base, &bob).await;
    let alice_token = auth_user_http(&client, &base, &alice).await;
    let bob_token = auth_user_http(&client, &base, &bob).await;

    let create = client
        .post(format!("{base}/api/posts"))
        .bearer_auth(&alice_token)
        .json(&json!({
            "id": "rally-update-post",
            "content": "Join this lobby",
            "timestamp": 1000,
            "recipient_ids": [bob.user_id],
            "rally": { "group_id": "group-update", "max_members": 4 },
        }))
        .send()
        .await
        .expect("post request");
    assert_eq!(create.status(), StatusCode::ACCEPTED);

    let ws_base = base.replace("http://", "ws://");
    let (mut alice_ws, _) = connect_async(format!("{ws_base}/api/ws?token={alice_token}"))
        .await
        .expect("alice ws should connect");

    let join = client
        .post(format!("{base}/api/groups/group-update/join"))
        .bearer_auth(&bob_token)
        .send()
        .await
        .expect("join request");
    assert_eq!(join.status(), StatusCode::OK);

    let update = loop {
        let msg = timeout(Duration::from_secs(2), alice_ws.next())
            .await
            .expect("alice should receive group update")
            .expect("alice stream should be open")
            .expect("message ok");
        let Message::Text(text) = msg else { continue };
        let env: ServerEnvelope = serde_json::from_str(&text).expect("envelope parses");
        if matches!(&env, ServerEnvelope::GroupUpdate { group } if group.id == "group-update") {
            break env;
        }
    };

    let ServerEnvelope::GroupUpdate { group } = update else {
        panic!("expected group update");
    };
    assert_eq!(group.members.len(), 2);

    alice_ws.close(None).await.expect("close");
    handle.abort();
}

#[tokio::test]
async fn post_assist_requires_auth_and_configuration() {
    let app = app();
    let alice = test_user(31);
    register_user(app.clone(), &alice).await;
    let alice_token = auth_user(app.clone(), &alice).await;

    let unauth = request(
        app.clone(),
        "POST",
        "/api/posts/assist",
        None,
        json!({ "prefix": "Recently playing" }),
    )
    .await;
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);

    let unavailable = request(
        app,
        "POST",
        "/api/posts/assist",
        Some(&alice_token),
        json!({ "prefix": "Recently playing" }),
    )
    .await;
    assert_eq!(unavailable.status(), StatusCode::SERVICE_UNAVAILABLE);
}

#[tokio::test]
async fn post_assist_rejects_too_short_prefix() {
    let app = app();
    let alice = test_user(32);
    register_user(app.clone(), &alice).await;
    let alice_token = auth_user(app.clone(), &alice).await;

    let response = request(
        app,
        "POST",
        "/api/posts/assist",
        Some(&alice_token),
        json!({ "prefix": "Portal" }),
    )
    .await;
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
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

    // Drain messages until we reach live1 — seed welcome messages may arrive first.
    let envelope = loop {
        let bob_msg = timeout(Duration::from_secs(2), bob_ws.next())
            .await
            .expect("bob should receive websocket message")
            .expect("bob stream should be open")
            .expect("bob message should be ok");
        let Message::Text(text) = bob_msg else {
            panic!("expected text message");
        };
        let env: ServerEnvelope = serde_json::from_str(&text).expect("message should parse");
        if matches!(&env, ServerEnvelope::Message { id, .. } if id == "live1") {
            break env;
        }
    };
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

    // Drain until we reach the DeliveredAck — seed messages for Alice may arrive first.
    let ack_envelope = loop {
        let ack = timeout(Duration::from_secs(2), alice_ws.next())
            .await
            .expect("alice should receive ack")
            .expect("alice stream should be open")
            .expect("alice message should be ok");
        let Message::Text(text) = ack else {
            panic!("expected text ack");
        };
        let env: ServerEnvelope = serde_json::from_str(&text).expect("ack should parse");
        if matches!(&env, ServerEnvelope::DeliveredAck { id } if id == "live1") {
            break env;
        }
    };
    assert_eq!(
        ack_envelope,
        ServerEnvelope::DeliveredAck {
            id: "live1".to_string()
        }
    );

    // After live delivery the message must still be in pending_messages —
    // the server does not delete it until the client explicitly acks.
    let still_pending = client
        .get(format!("{base}/api/messages"))
        .bearer_auth(&bob_token)
        .send()
        .await
        .expect("get messages should send");
    assert_eq!(still_pending.status(), StatusCode::OK);
    let body: Value = still_pending.json().await.expect("messages json");
    assert_eq!(
        body["messages"]
            .as_array()
            .expect("messages array")
            .iter()
            .filter(|m| m["id"] == "live1")
            .count(),
        1,
        "live-delivered message must remain in queue until client acks"
    );

    alice_ws.close(None).await.expect("alice close should send");
    bob_ws.close(None).await.expect("bob close should send");
    handle.abort();
}

#[tokio::test]
async fn live_message_requires_explicit_ack_to_clear() {
    let (base, handle) = spawn_server().await;
    let client = reqwest::Client::new();
    let alice = test_user(13);
    let bob = test_user(14);
    register_user_http(&client, &base, &alice).await;
    register_user_http(&client, &base, &bob).await;
    let alice_token = auth_user_http(&client, &base, &alice).await;
    let bob_token = auth_user_http(&client, &base, &bob).await;

    let ws_base = base.replace("http://", "ws://");
    let (mut bob_ws, _) = connect_async(format!("{ws_base}/api/ws?token={bob_token}"))
        .await
        .expect("bob websocket should connect");

    // Send while Bob is online — live delivery path.
    client
        .post(format!("{base}/api/messages"))
        .bearer_auth(&alice_token)
        .json(&json!({
            "id": "ack-test-1",
            "recipient_id": bob.user_id,
            "payload_hex": "aabb",
            "nonce_hex": "000000000000000000000000",
            "msg_type": "dm",
            "sent_at": 200,
        }))
        .send()
        .await
        .expect("send should succeed");

    // Bob receives via WS.
    let _ = timeout(Duration::from_secs(2), bob_ws.next())
        .await
        .expect("bob should receive message");

    // Message is still in pending — no ack yet.
    let pending: Value = client
        .get(format!("{base}/api/messages"))
        .bearer_auth(&bob_token)
        .send()
        .await
        .expect("get messages should send")
        .json()
        .await
        .expect("messages json");
    assert!(
        pending["messages"]
            .as_array()
            .unwrap()
            .iter()
            .any(|m| m["id"] == "ack-test-1"),
        "message must be pending before ack"
    );

    // Bob acks.
    let ack = client
        .delete(format!("{base}/api/messages/ack-test-1"))
        .bearer_auth(&bob_token)
        .send()
        .await
        .expect("ack should send");
    assert_eq!(ack.status(), StatusCode::NO_CONTENT);

    // Message is gone.
    let after: Value = client
        .get(format!("{base}/api/messages"))
        .bearer_auth(&bob_token)
        .send()
        .await
        .expect("get messages should send")
        .json()
        .await
        .expect("messages json");
    assert!(
        after["messages"]
            .as_array()
            .unwrap()
            .iter()
            .all(|m| m["id"] != "ack-test-1"),
        "message must be gone after ack"
    );

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
    let bob_entry = list
        .friends
        .iter()
        .find(|f| f.user_id == bob.user_id)
        .expect("bob should be in alice's friend list");
    assert_eq!(bob_entry.pubkey_hex, bob.pubkey_hex);

    // Unauthenticated request.
    let unauth = request(app, "GET", "/api/friends", None, json!({})).await;
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn invite_token_can_add_multiple_friends_until_expiry() {
    let app = app();
    let alice = test_user(70);
    let bob = test_user(71);
    let carol = test_user(72);
    register_user(app.clone(), &alice).await;
    register_user(app.clone(), &bob).await;
    register_user(app.clone(), &carol).await;
    let alice_token = auth_user(app.clone(), &alice).await;
    let bob_token = auth_user(app.clone(), &bob).await;
    let carol_token = auth_user(app.clone(), &carol).await;

    let token_resp = request(
        app.clone(),
        "POST",
        "/api/invite-token",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(token_resp.status(), StatusCode::OK);
    let body = token_resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let body: Value = serde_json::from_slice(&body).expect("invite response");
    let code = body["code"].as_str().expect("code").to_string();

    let bob_redeem = request(
        app.clone(),
        "POST",
        "/api/friends/by-token",
        Some(&bob_token),
        json!({ "code": code }),
    )
    .await;
    assert_eq!(bob_redeem.status(), StatusCode::ACCEPTED);

    let carol_redeem = request(
        app.clone(),
        "POST",
        "/api/friends/by-token",
        Some(&carol_token),
        json!({ "code": code }),
    )
    .await;
    assert_eq!(carol_redeem.status(), StatusCode::ACCEPTED);

    let list_resp = request(app, "GET", "/api/friends", Some(&alice_token), json!({})).await;
    assert_eq!(list_resp.status(), StatusCode::OK);
    let body = list_resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let list: FriendListResponse = serde_json::from_slice(&body).expect("friend list");
    assert!(list.friends.iter().any(|f| f.user_id == bob.user_id));
    assert!(list.friends.iter().any(|f| f.user_id == carol.user_id));
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

#[tokio::test]
async fn new_user_gets_seeded_friends_posts_and_welcome_messages() {
    let app = app();
    let alice = test_user(20);

    register_user(app.clone(), &alice).await;
    let alice_token = auth_user(app.clone(), &alice).await;

    // Should have bot friends straight after registration.
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
        .expect("body")
        .to_bytes();
    let list: FriendListResponse = serde_json::from_slice(&body).expect("friend list should parse");
    assert!(
        list.friends.len() >= 3,
        "at least 3 bot friends expected, got {}",
        list.friends.len()
    );

    // Should have seed posts waiting in the feed.
    let posts_resp = request(
        app.clone(),
        "GET",
        "/api/posts",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(posts_resp.status(), StatusCode::OK);
    let body = posts_resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let posts: Value = serde_json::from_slice(&body).expect("posts response should parse");
    assert!(
        posts["posts"].as_array().expect("posts array").len() >= 3,
        "at least one post per bot expected"
    );
    for (category, media_ref_name) in [
        ("music", "Boston"),
        ("games", "Portal 2"),
        ("movies", "Fuze"),
    ] {
        let post = posts["posts"]
            .as_array()
            .expect("posts array")
            .iter()
            .find(|post| post["media_ref_name"] == media_ref_name)
            .unwrap_or_else(|| panic!("expected {media_ref_name} seed post"));
        assert_eq!(post["category"], category);
        assert!(
            post["image_url"]
                .as_str()
                .is_some_and(|url| !url.is_empty()),
            "expected seed post image url"
        );
    }

    // Should have one friend_added + one dm welcome per bot.
    let msg_resp = request(
        app.clone(),
        "GET",
        "/api/messages",
        Some(&alice_token),
        json!({}),
    )
    .await;
    assert_eq!(msg_resp.status(), StatusCode::OK);
    let body = msg_resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let msgs: Value = serde_json::from_slice(&body).expect("messages response should parse");
    let messages = msgs["messages"].as_array().expect("messages array");
    assert_eq!(
        messages
            .iter()
            .filter(|m| m["msg_type"] == "friend_added")
            .count(),
        3,
        "one friend_added per bot"
    );
    assert_eq!(
        messages.iter().filter(|m| m["msg_type"] == "dm").count(),
        3,
        "one dm welcome per bot"
    );
}

#[tokio::test]
async fn re_registration_does_not_duplicate_seed_data() {
    let app = app();
    let alice = test_user(21);

    register_user(app.clone(), &alice).await;
    // Second registration is a no-op for the user row, seed must not run again.
    register_user(app.clone(), &alice).await;
    let alice_token = auth_user(app.clone(), &alice).await;

    let msg_resp = request(
        app.clone(),
        "GET",
        "/api/messages",
        Some(&alice_token),
        json!({}),
    )
    .await;
    let body = msg_resp
        .into_body()
        .collect()
        .await
        .expect("body")
        .to_bytes();
    let msgs: Value = serde_json::from_slice(&body).expect("messages response should parse");
    let messages = msgs["messages"].as_array().expect("messages array");
    assert_eq!(
        messages
            .iter()
            .filter(|m| m["msg_type"] == "friend_added")
            .count(),
        3,
        "exactly 3 friend_added messages — no duplicates on re-registration"
    );
    assert_eq!(
        messages.iter().filter(|m| m["msg_type"] == "dm").count(),
        3,
        "exactly 3 dm welcome messages — no duplicates on re-registration"
    );
}
