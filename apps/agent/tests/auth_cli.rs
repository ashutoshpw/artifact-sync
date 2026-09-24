use artifact_sync::auth::credentials::{CachedIdentity, SavedAuth, SecretString};
use artifact_sync::auth::store::CredentialStore;
use rusqlite::Connection;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use tokio::task::JoinHandle;

const ACCESS_TOKEN: &str = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcnRpZmFjdC1zeW5jIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const API_TOKEN: &str = "as_api_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SAVED_REFRESH: &str = "as_rf_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const ROTATED_REFRESH: &str = "as_rf_CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";

#[derive(Clone)]
struct MockResponse {
    status: u16,
    body: String,
    location: Option<String>,
}

impl MockResponse {
    fn json(status: u16, body: impl Into<String>) -> Self {
        Self {
            status,
            body: body.into(),
            location: None,
        }
    }

    fn redirect(location: &str) -> Self {
        Self {
            status: 302,
            body: "{}".into(),
            location: Some(location.into()),
        }
    }
}

fn identity(team: &str) -> String {
    format!(
        r#"{{"userId":"user-123","email":"publisher@example.test","name":"Publisher","teamId":"team-123","team":"{team}","permissions":["artifacts:publish","artifacts:read"],"expiresAt":"2030-01-01T00:00:00Z","tokenId":"api_12345678-1234-4234-9234-123456789abc"}}"#
    )
}

fn exchange(refresh_token: &str, team: &str) -> String {
    format!(
        r#"{{"accessToken":"{ACCESS_TOKEN}","refreshToken":"{refresh_token}","expiresAt":"2030-01-01T00:00:00Z","identity":{}}}"#,
        identity(team)
    )
}

async fn sequence_server(
    listener: TcpListener,
    responses: Vec<MockResponse>,
) -> (UnboundedReceiver<String>, JoinHandle<()>) {
    let (requests_tx, requests_rx) = unbounded_channel();
    let task = tokio::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            let _ = requests_tx.send(summarize_request(&request));
            write_response(&mut stream, response).await;
        }
    });
    (requests_rx, task)
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut chunk = [0u8; 2048];
    loop {
        let read = stream.read(&mut chunk).await.unwrap();
        if read == 0 {
            break;
        }
        request.extend_from_slice(&chunk[..read]);
        if request.windows(4).any(|window| window == b"\r\n\r\n") {
            break;
        }
    }
    String::from_utf8_lossy(&request).into_owned()
}

fn summarize_request(request: &str) -> String {
    let first = request.lines().next().unwrap_or_default();
    let authorization = request
        .lines()
        .find(|line| line.to_ascii_lowercase().starts_with("authorization:"))
        .unwrap_or_default();
    format!("{first}\n{authorization}")
}

async fn write_response(stream: &mut TcpStream, response: MockResponse) {
    let reason = match response.status {
        200 => "OK",
        201 => "Created",
        202 => "Accepted",
        302 => "Found",
        401 => "Unauthorized",
        403 => "Forbidden",
        410 => "Gone",
        _ => "Test Response",
    };
    let mut headers = format!(
        "HTTP/1.1 {} {}\r\nContent-Type: application/json\r\nCache-Control: no-store\r\nContent-Length: {}\r\nConnection: close\r\n",
        response.status,
        reason,
        response.body.len()
    );
    if let Some(location) = response.location {
        headers.push_str(&format!("Location: {location}\r\n"));
    }
    headers.push_str("\r\n");
    stream.write_all(headers.as_bytes()).await.unwrap();
    stream.write_all(response.body.as_bytes()).await.unwrap();
}

fn origin(listener: &TcpListener) -> String {
    format!("http://{}", listener.local_addr().unwrap())
}

fn private_auth(path: &Path, origin: &str) {
    let expires = chrono::DateTime::parse_from_rfc3339("2030-01-01T00:00:00Z")
        .unwrap()
        .with_timezone(&chrono::Utc);
    CredentialStore::new(path)
        .save_login(
            origin,
            &SavedAuth {
                auth_type: "team_token".into(),
                access_token: SecretString::new(ACCESS_TOKEN),
                refresh_token: SecretString::new(SAVED_REFRESH),
                token_id: "api_saved".into(),
                expires_at: expires,
                cached_identity: CachedIdentity {
                    user_id: "user-123".into(),
                    email: "cached-only@example.test".into(),
                    name: "Cached User".into(),
                    team_id: "team-123".into(),
                    team: "w3dev".into(),
                    permissions: vec!["artifacts:publish".into(), "artifacts:read".into()],
                },
            },
        )
        .unwrap();
}

fn publishing_config(root: &Path, team: &str) -> std::path::PathBuf {
    std::fs::create_dir_all(root).unwrap();
    let path = root.join("config.json");
    std::fs::write(
        &path,
        format!(r#"{{"team":"{team}","sync":{{"debounceMs":50,"maxConcurrentUploads":1,"auditIntervalSeconds":0}}}}"#),
    )
    .unwrap();
    path
}

fn spawn_command(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    args: &[&str],
    input: Option<&str>,
    environment_token: Option<&str>,
    server_origin: Option<&str>,
) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_artifact-sync"));
    command
        .env_clear()
        .env("HOME", home)
        .env("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1")
        .env("RUST_LOG", "debug")
        .arg("--auth-config")
        .arg(auth_path)
        .arg("--config")
        .arg(publishing_path)
        .args(args)
        .stdin(if input.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(token) = environment_token {
        command.env("ARTIFACTS_PUBLISH_TOKEN", token);
    }
    if let Some(origin) = server_origin {
        command.env("ARTIFACT_SYNC_SERVER_URL", origin);
    }
    command.spawn().unwrap()
}

async fn run_command(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    args: &[&str],
    input: Option<&str>,
    environment_token: Option<&str>,
    server_origin: Option<&str>,
) -> std::process::Output {
    let mut child = spawn_command(
        home,
        auth_path,
        publishing_path,
        args,
        input,
        environment_token,
        server_origin,
    );
    if let Some(input) = input {
        child
            .stdin
            .take()
            .unwrap()
            .write_all(input.as_bytes())
            .await
            .unwrap();
    }
    child.wait_with_output().await.unwrap()
}

fn spawn_daemon(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    environment_token: Option<&str>,
    server_origin: Option<&str>,
) -> Child {
    spawn_command(
        home,
        auth_path,
        publishing_path,
        &["daemon"],
        None,
        environment_token,
        server_origin,
    )
}

fn spawn_daemon_without_publishing_config(
    home: &Path,
    auth_path: &Path,
    server_origin: &str,
) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_artifact-sync"));
    command
        .env_clear()
        .env("HOME", home)
        .env("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1")
        .env("RUST_LOG", "debug")
        .env("ARTIFACT_SYNC_SERVER_URL", server_origin)
        .arg("--auth-config")
        .arg(auth_path)
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command.spawn().unwrap()
}

async fn wait_for_daemon_ready(home: &Path) {
    let socket_path = home.join(".config/artifact-sync/daemon.sock");
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while !socket_path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("daemon control socket did not appear");
}

#[tokio::test]
async fn daemon_starts_from_auth_config_without_publishing_config() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let artifact_root = home.join(".agents/artifacts");
    let publishing_path = artifact_root.join("config.json");
    let auth_path = home.join(".config/artifact-sync/config.json");

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    let (mut requests, server) =
        sequence_server(listener, vec![MockResponse::json(200, identity("w3dev"))]).await;
    private_auth(&auth_path, &server_origin);

    let mut daemon = spawn_daemon_without_publishing_config(&home, &auth_path, &server_origin);
    wait_for_daemon_ready(&home).await;
    let request = tokio::time::timeout(std::time::Duration::from_secs(5), requests.recv())
        .await
        .unwrap()
        .unwrap();

    assert!(request.starts_with("GET /__api/v1/auth/me "));
    assert!(artifact_root.is_dir());
    assert!(!publishing_path.exists());
    assert!(daemon.try_wait().unwrap().is_none());

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server.await.unwrap();
}

fn state_database(home: &Path) -> std::path::PathBuf {
    home.join(".local/state/artifact-sync/state.sqlite3")
}

fn pending_count(database_path: &Path) -> i64 {
    Connection::open(database_path)
        .unwrap()
        .query_row("SELECT COUNT(*) FROM pending", [], |row| row.get(0))
        .unwrap()
}

fn output_text(output: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

#[tokio::test]
async fn stdin_api_token_login_rotates_saves_and_reuses_credentials_after_restart() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    let (mut requests, server) = sequence_server(
        listener,
        vec![
            MockResponse::json(200, exchange(ROTATED_REFRESH, "w3dev")),
            MockResponse::json(200, identity("w3dev")),
            MockResponse::json(200, identity("w3dev")),
        ],
    )
    .await;

    let login = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["login", "--server", &server_origin, "--token-stdin"],
        Some(&format!("{API_TOKEN}\n")),
        None,
        None,
    )
    .await;
    assert!(login.status.success(), "{}", output_text(&login));
    let output = output_text(&login);
    assert!(output.contains("publisher@example.test"));
    assert!(output.contains("team w3dev"));
    assert!(!output.contains(API_TOKEN));
    assert!(!output.contains(ROTATED_REFRESH));

    let saved = CredentialStore::new(&auth_path)
        .load()
        .unwrap()
        .unwrap()
        .auth
        .unwrap();
    assert_eq!(saved.access_token.expose(), ACCESS_TOKEN);
    assert_eq!(saved.refresh_token.expose(), ROTATED_REFRESH);
    assert_eq!(saved.cached_identity.team, "w3dev");

    let whoami = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["whoami"],
        None,
        None,
        None,
    )
    .await;
    assert!(whoami.status.success(), "{}", output_text(&whoami));
    let output = output_text(&whoami);
    assert!(output.contains("Server: "));
    assert!(output.contains("Authorized team: w3dev"));
    assert!(output.contains("Credential source: auth file"));
    assert!(!output.contains(API_TOKEN));
    assert!(!output.contains(ROTATED_REFRESH));

    let first = requests.recv().await.unwrap();
    let second = requests.recv().await.unwrap();
    let third = requests.recv().await.unwrap();
    assert!(first.starts_with("POST /__api/v1/auth/refresh "));
    assert!(second.starts_with("GET /__api/v1/auth/me "));
    assert!(second.contains(ACCESS_TOKEN));
    assert!(third.starts_with("GET /__api/v1/auth/me "));
    assert!(third.contains(ACCESS_TOKEN));
    server.await.unwrap();
}

#[tokio::test]
async fn invalid_or_mismatched_login_preserves_existing_credentials() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    private_auth(&auth_path, &server_origin);
    let (mut requests, server) = sequence_server(
        listener,
        vec![MockResponse::json(
            401,
            r#"{"error":"invalid_or_expired_credentials"}"#,
        )],
    )
    .await;

    let invalid = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["login", "--server", &server_origin, "--token-stdin"],
        Some(&format!("{API_TOKEN}\n")),
        None,
        None,
    )
    .await;
    assert!(!invalid.status.success());
    assert!(output_text(&invalid).contains("no credential was saved"));
    assert!(!output_text(&invalid).contains(API_TOKEN));
    let saved = CredentialStore::new(&auth_path)
        .load()
        .unwrap()
        .unwrap()
        .auth
        .unwrap();
    assert_eq!(saved.refresh_token.expose(), SAVED_REFRESH);
    assert_eq!(
        requests.recv().await.unwrap().split('\n').next().unwrap(),
        "POST /__api/v1/auth/refresh HTTP/1.1"
    );
    server.await.unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let mismatch_origin = origin(&listener);
    let (mut requests, server) = sequence_server(
        listener,
        vec![
            MockResponse::json(200, exchange(ROTATED_REFRESH, "other-team")),
            MockResponse::json(200, identity("other-team")),
        ],
    )
    .await;
    let mismatch = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["login", "--server", &mismatch_origin, "--token-stdin"],
        Some(&format!("{API_TOKEN}\n")),
        None,
        None,
    )
    .await;
    assert!(!mismatch.status.success());
    assert!(output_text(&mismatch).contains("publishing configuration selects 'w3dev'"));
    assert_eq!(
        CredentialStore::new(&auth_path)
            .load()
            .unwrap()
            .unwrap()
            .auth
            .unwrap()
            .refresh_token
            .expose(),
        SAVED_REFRESH
    );
    assert!(
        requests
            .recv()
            .await
            .unwrap()
            .starts_with("POST /__api/v1/auth/refresh ")
    );
    assert!(
        requests
            .recv()
            .await
            .unwrap()
            .starts_with("GET /__api/v1/auth/me ")
    );
    server.await.unwrap();
}

#[tokio::test]
async fn headless_login_requires_stdin_and_cross_origin_redirect_never_receives_credentials() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let no_input = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["login", "--server", "https://artifact.w3dev.app"],
        None,
        None,
        None,
    )
    .await;
    assert!(!no_input.status.success());
    assert!(output_text(&no_input).contains("requires a terminal"));

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    let (mut requests, server) = sequence_server(
        listener,
        vec![MockResponse::redirect("https://attacker.example/collect")],
    )
    .await;
    let redirected = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["login", "--server", &server_origin, "--token-stdin"],
        Some(&format!("{API_TOKEN}\n")),
        None,
        None,
    )
    .await;
    assert!(!redirected.status.success());
    assert!(output_text(&redirected).contains("redirected the request"));
    assert!(!auth_path.exists());
    let request = requests.recv().await.unwrap();
    assert!(request.starts_with("POST /__api/v1/auth/refresh "));
    assert!(!request.to_ascii_lowercase().contains("authorization:"));
    assert!(!request.contains(API_TOKEN));
    server.await.unwrap();
}

#[tokio::test]
async fn auth_file_path_inside_artifact_root_is_rejected_before_network_access() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = root.join("private-auth.json");
    let result = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &[
            "login",
            "--server",
            "https://artifact.w3dev.app",
            "--token-stdin",
        ],
        Some(&format!("{API_TOKEN}\n")),
        None,
        None,
    )
    .await;
    assert!(!result.status.success());
    assert!(output_text(&result).contains("outside the watched artifact root"));
    assert!(!auth_path.exists());
}

#[tokio::test]
async fn offline_whoami_does_not_claim_cached_identity_is_verified() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    drop(listener);
    private_auth(&auth_path, &server_origin);

    let whoami = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["whoami"],
        None,
        None,
        None,
    )
    .await;
    assert!(!whoami.status.success());
    let output = output_text(&whoami);
    assert!(output.contains("authentication server is unreachable"));
    assert!(!output.contains("cached-only@example.test"));
    assert!(!output.contains("Cached User"));
}

#[tokio::test]
async fn logout_preserves_other_settings_and_reports_environment_credential() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    private_auth(&auth_path, "https://artifact.w3dev.app");
    let mut raw: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    raw["customSetting"] = serde_json::Value::String("keep-me".into());
    std::fs::write(&auth_path, serde_json::to_vec(&raw).unwrap()).unwrap();
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&auth_path, std::fs::Permissions::from_mode(0o600)).unwrap();

    let logout = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["logout"],
        None,
        Some(API_TOKEN),
        Some("https://artifact.w3dev.app"),
    )
    .await;
    assert!(logout.status.success(), "{}", output_text(&logout));
    let output = output_text(&logout);
    assert!(output.contains("not server-side revocation"));
    assert!(output.contains("remains active"));
    assert!(!output.contains(API_TOKEN));
    let after: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    assert!(after.get("auth").is_none());
    assert_eq!(after["customSetting"], "keep-me");
}

#[tokio::test]
async fn environment_api_token_is_not_persisted_and_idle_daemon_does_not_poll_auth() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    let (requests_tx, mut requests_rx) = unbounded_channel();
    let server = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let summary = summarize_request(&request);
            let response = if summary.starts_with("POST /__api/v1/auth/refresh ") {
                MockResponse::json(200, exchange(API_TOKEN, "w3dev"))
            } else if summary.starts_with("GET /__api/v1/auth/me ") {
                MockResponse::json(200, identity("w3dev"))
            } else {
                MockResponse::json(404, "{}")
            };
            if requests_tx.send(summary).is_err() {
                return;
            }
            write_response(&mut stream, response).await;
        }
    });

    let mut daemon = spawn_daemon(
        &home,
        &auth_path,
        &publishing_path,
        Some(API_TOKEN),
        Some(&server_origin),
    );
    let first = tokio::time::timeout(std::time::Duration::from_secs(5), requests_rx.recv())
        .await
        .unwrap()
        .unwrap();
    let second = tokio::time::timeout(std::time::Duration::from_secs(5), requests_rx.recv())
        .await
        .unwrap()
        .unwrap();
    assert!(first.starts_with("POST /__api/v1/auth/refresh "));
    assert!(!first.to_ascii_lowercase().contains("authorization:"));
    assert!(second.starts_with("GET /__api/v1/auth/me "));
    assert!(second.contains(ACCESS_TOKEN));
    assert!(!auth_path.exists());
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(250), requests_rx.recv())
            .await
            .is_err()
    );

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server.abort();
}

#[tokio::test]
async fn offline_startup_keeps_new_files_pending_and_recovers_with_rotated_auth() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let reservation = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let address = reservation.local_addr().unwrap();
    drop(reservation);
    let server_origin = format!("http://{address}");
    private_auth(&auth_path, &server_origin);
    let mut daemon = spawn_daemon(&home, &auth_path, &publishing_path, None, None);
    wait_for_daemon_ready(&home).await;

    let artifact = root.join("first.json");
    std::fs::write(&artifact, "{\"ok\":true}").unwrap();
    let database = state_database(&home);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if database.exists() && pending_count(&database) == 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();

    let listener = TcpListener::bind(address).await.unwrap();
    let (requests_tx, mut requests_rx) = unbounded_channel();
    let server = tokio::spawn(async move {
        let mut me_requests = 0;
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let summary = summarize_request(&request);
            let response = if summary.starts_with("POST /__api/v1/auth/refresh ") {
                MockResponse::json(200, exchange(ROTATED_REFRESH, "w3dev"))
            } else if summary.starts_with("GET /__api/v1/auth/me ") {
                me_requests += 1;
                if me_requests == 1 {
                    MockResponse::json(401, "{}")
                } else {
                    MockResponse::json(200, identity("w3dev"))
                }
            } else if summary.starts_with("PUT /__api/v1/uploads?") {
                MockResponse::json(201, "{}")
            } else {
                MockResponse::json(404, "{}")
            };
            if requests_tx.send(summary).is_err() {
                return;
            }
            write_response(&mut stream, response).await;
        }
    });

    let saw_upload = tokio::time::timeout(std::time::Duration::from_secs(12), async {
        loop {
            match requests_rx.recv().await {
                Some(request) if request.starts_with("PUT /__api/v1/uploads?") => break true,
                Some(_) => {}
                None => break false,
            }
        }
    })
    .await
    .unwrap();
    assert!(saw_upload);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        while pending_count(&database) != 0 {
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("successful gateway upload did not clear pending work");
    assert_eq!(pending_count(&database), 0);
    assert_eq!(
        CredentialStore::new(&auth_path)
            .load()
            .unwrap()
            .unwrap()
            .auth
            .unwrap()
            .refresh_token
            .expose(),
        ROTATED_REFRESH
    );

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server.abort();
}

#[tokio::test]
async fn logout_during_upload_cancels_best_effort_and_preserves_pending_work() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir_all(&home).unwrap();
    let root = temp.path().join("artifacts");
    let publishing_path = publishing_config(&root, "w3dev");
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    private_auth(&auth_path, &server_origin);
    let (requests_tx, mut requests_rx) = unbounded_channel();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        let _ = requests_tx.send(summarize_request(&request));
        write_response(&mut stream, MockResponse::json(200, identity("w3dev"))).await;

        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        let _ = requests_tx.send(summarize_request(&request));
        let mut byte = [0u8; 1];
        let upload_closed =
            tokio::time::timeout(std::time::Duration::from_secs(5), stream.read(&mut byte))
                .await
                .is_ok_and(|result| result.is_ok_and(|read| read == 0));
        let _ = requests_tx.send(if upload_closed {
            "UPLOAD_CANCELLED".into()
        } else {
            "UPLOAD_NOT_CANCELLED".into()
        });
    });

    let mut daemon = spawn_daemon(&home, &auth_path, &publishing_path, None, None);
    assert!(
        tokio::time::timeout(std::time::Duration::from_secs(5), requests_rx.recv())
            .await
            .unwrap()
            .unwrap()
            .starts_with("GET /__api/v1/auth/me ")
    );
    wait_for_daemon_ready(&home).await;
    let artifact = root.join("in-flight.json");
    std::fs::write(&artifact, "{\"pending\":true}").unwrap();
    let upload_request =
        tokio::time::timeout(std::time::Duration::from_secs(5), requests_rx.recv())
            .await
            .unwrap()
            .unwrap();
    assert!(upload_request.starts_with("PUT /__api/v1/uploads?"));

    let logout = run_command(
        &home,
        &auth_path,
        &publishing_path,
        &["logout"],
        None,
        None,
        None,
    )
    .await;
    assert!(logout.status.success(), "{}", output_text(&logout));
    assert!(output_text(&logout).contains("running daemon was notified"));
    let database = state_database(&home);
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if pending_count(&database) == 1 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();

    let later = root.join("after-logout.json");
    std::fs::write(&later, "{\"still\":\"queued\"}").unwrap();
    tokio::time::timeout(std::time::Duration::from_secs(5), async {
        loop {
            if pending_count(&database) == 2 {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .unwrap();
    let upload_state = tokio::time::timeout(std::time::Duration::from_secs(5), requests_rx.recv())
        .await
        .expect("server did not observe logout cancellation");
    assert_eq!(upload_state.as_deref(), Some("UPLOAD_CANCELLED"));

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server.abort();
}
