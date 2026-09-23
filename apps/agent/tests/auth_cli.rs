use artifact_sync::auth::credentials::{CachedIdentity, SavedAuth, SecretString};
use artifact_sync::auth::store::CredentialStore;
use serde_json::Value;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Stdio;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::process::{Child, Command};
use tokio::sync::mpsc::{UnboundedReceiver, unbounded_channel};
use tokio::task::JoinHandle;

const TOKEN: &str = "as_pub_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
const SAVED_TOKEN: &str = "as_pub_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
const IDENTITY: &str = r#"{"publisherId":"publisher-device-01","team":"w3dev","permissions":["artifacts:publish"],"expiresAt":"2030-01-01T00:00:00Z","tokenId":"pub_fixture_01"}"#;

struct MockResponse {
    status: u16,
    body: String,
    location: Option<String>,
}

async fn mock_server(listener: TcpListener, responses: Vec<MockResponse>) -> JoinHandle<()> {
    tokio::spawn(async move {
        for response in responses {
            let (mut stream, _) = listener.accept().await.unwrap();
            let request = read_request(&mut stream).await;
            assert!(request.starts_with("GET /__api/v1/auth/me "));
            assert!(request.lines().any(|line| {
                line.eq_ignore_ascii_case(&format!("authorization: Bearer {TOKEN}"))
            }));
            write_response(&mut stream, response).await;
        }
    })
}

async fn read_request(stream: &mut TcpStream) -> String {
    let mut request = Vec::new();
    let mut chunk = [0u8; 1024];
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
    String::from_utf8(request).unwrap()
}

async fn write_response(stream: &mut TcpStream, response: MockResponse) {
    let reason = match response.status {
        200 => "OK",
        302 => "Found",
        401 => "Unauthorized",
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

fn private_auth(path: &Path, token: &str, origin: &str) {
    CredentialStore::new(path)
        .save_login(
            origin,
            &SavedAuth {
                auth_type: "publisher_token".into(),
                token: SecretString::new(token),
                token_id: Some("pub_saved".into()),
                expires_at: None,
                cached_identity: Some(CachedIdentity {
                    publisher_id: "saved-device".into(),
                    team: "w3dev".into(),
                    permissions: vec!["artifacts:publish".into()],
                }),
            },
        )
        .unwrap();
}

fn command(auth_path: &Path, publishing_path: &Path, args: &[&str], input: Option<&str>) -> Child {
    let mut command = Command::new(env!("CARGO_BIN_EXE_artifact-sync"));
    command
        .env_clear()
        .env("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1")
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
    command.spawn().unwrap()
}

fn command_with_home(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    args: &[&str],
    input: Option<&str>,
    publisher_token: Option<&str>,
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
    if let Some(token) = publisher_token {
        command.env("ARTIFACTS_PUBLISH_TOKEN", token);
    }
    command.spawn().unwrap()
}

fn daemon_with_environment_credential(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    token: &str,
    server: &str,
) -> Child {
    Command::new(env!("CARGO_BIN_EXE_artifact-sync"))
        .env_clear()
        .env("HOME", home)
        .env("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1")
        .env("ARTIFACTS_PUBLISH_TOKEN", token)
        .env("ARTIFACT_SYNC_SERVER_URL", server)
        .arg("--auth-config")
        .arg(auth_path)
        .arg("--config")
        .arg(publishing_path)
        .arg("daemon")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap()
}

async fn run_command(
    auth_path: &Path,
    publishing_path: &Path,
    args: &[&str],
    input: Option<&str>,
) -> std::process::Output {
    let mut child = command(auth_path, publishing_path, args, input);
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

async fn run_command_with_home(
    home: &Path,
    auth_path: &Path,
    publishing_path: &Path,
    args: &[&str],
    input: Option<&str>,
    publisher_token: Option<&str>,
) -> std::process::Output {
    let mut child = command_with_home(
        home,
        auth_path,
        publishing_path,
        args,
        input,
        publisher_token,
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

fn daemon_mock_server(listener: TcpListener) -> (UnboundedReceiver<String>, JoinHandle<()>) {
    let (requests_tx, requests_rx) = unbounded_channel();
    let server = tokio::spawn(async move {
        loop {
            let Ok((mut stream, _)) = listener.accept().await else {
                return;
            };
            let request = read_request(&mut stream).await;
            let path = request.lines().next().unwrap_or_default().to_string();
            let response = MockResponse {
                status: 200,
                body: IDENTITY.into(),
                location: None,
            };
            write_response(&mut stream, response).await;
            if requests_tx.send(path).is_err() {
                return;
            }
        }
    });
    (requests_rx, server)
}

fn temporary_credentials_server(
    listener: TcpListener,
) -> (UnboundedReceiver<String>, JoinHandle<()>) {
    let (requests_tx, requests_rx) = unbounded_channel();
    let server = tokio::spawn(async move {
        let (mut stream, _) = listener.accept().await.unwrap();
        let request = read_request(&mut stream).await;
        let response = MockResponse {
            status: 200,
            body: "{\"accessKeyId\":\"temporary-id\",\"secretAccessKey\":\"temporary-secret\",\"sessionToken\":\"temporary-session\",\"endpoint\":\"https://attacker.example\",\"bucket\":\"artifacts\",\"prefix\":\"teams/w3dev/artifacts/\",\"expiresAt\":\"2030-01-01T00:00:00Z\"}".to_owned(),
            location: None,
        };
        write_response(&mut stream, response).await;
        let _ = requests_tx.send(request);
    });
    (requests_rx, server)
}

fn pending_state(database_path: &Path) -> Option<(i64, i64)> {
    let database = rusqlite::Connection::open(database_path).ok()?;
    database
        .query_row(
            "SELECT COUNT(*), COALESCE(MAX(attempts), 0) FROM pending",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok()
}

fn output_text(output: &std::process::Output) -> String {
    format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    )
}

#[tokio::test]
async fn stdin_login_saves_validated_credentials_for_a_fresh_whoami_process() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    let auth_path = temp.path().join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = origin(&listener);
    let mock = mock_server(
        listener,
        vec![
            MockResponse {
                status: 200,
                body: IDENTITY.into(),
                location: None,
            },
            MockResponse {
                status: 200,
                body: IDENTITY.into(),
                location: None,
            },
        ],
    )
    .await;

    let output = run_command(
        &auth_path,
        &publishing_path,
        &["login", "--server", &server, "--token-stdin"],
        Some(&format!("{TOKEN}\n")),
    )
    .await;
    assert!(output.status.success(), "{}", output_text(&output));
    let printed = output_text(&output);
    assert!(printed.contains("publisher-device-01"));
    assert!(printed.contains("w3dev"));
    assert!(printed.contains(auth_path.to_str().unwrap()));
    assert!(!printed.contains(TOKEN));
    assert_eq!(
        std::fs::metadata(&auth_path).unwrap().permissions().mode() & 0o777,
        0o600
    );
    let saved: Value = serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    assert_eq!(saved["serverUrl"], server);
    assert_eq!(saved["auth"]["token"], TOKEN);

    let output = run_command(&auth_path, &publishing_path, &["whoami"], None).await;
    assert!(output.status.success(), "{}", output_text(&output));
    let printed = output_text(&output);
    assert!(printed.contains("Server: "));
    assert!(printed.contains("Publisher ID: publisher-device-01"));
    assert!(printed.contains("Authorized team: w3dev"));
    assert!(printed.contains("Credential source: auth file"));
    assert!(!printed.contains(TOKEN));
    mock.await.unwrap();
}

#[tokio::test]
async fn invalid_login_does_not_replace_an_existing_credential() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    let auth_path = temp.path().join(".config/artifact-sync/config.json");
    private_auth(&auth_path, SAVED_TOKEN, "https://saved.example");
    let before = std::fs::read(&auth_path).unwrap();
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = origin(&listener);
    let mock = mock_server(
        listener,
        vec![MockResponse {
            status: 401,
            body: r#"{"error":"invalid_or_expired_credentials"}"#.into(),
            location: None,
        }],
    )
    .await;

    let output = run_command(
        &auth_path,
        &publishing_path,
        &["login", "--server", &server, "--token-stdin"],
        Some(&format!("{TOKEN}\n")),
    )
    .await;
    assert!(!output.status.success());
    let printed = output_text(&output);
    assert!(printed.contains("invalid, expired, or revoked"));
    assert!(!printed.contains(TOKEN));
    assert_eq!(std::fs::read(&auth_path).unwrap(), before);
    mock.await.unwrap();
}

#[tokio::test]
async fn headless_login_without_stdin_credentials_fails_without_prompting() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let output = run_command(
        &temp.path().join("auth/config.json"),
        &root.join("config.json"),
        &["login", "--server", "https://artifacts.example.com"],
        None,
    )
    .await;
    assert!(!output.status.success());
    assert!(output_text(&output).contains("--token-stdin"));
}

#[tokio::test]
async fn offline_whoami_does_not_claim_cached_identity_is_verified() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    let auth_path = temp.path().join("auth/config.json");
    let reserved = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = origin(&reserved);
    drop(reserved);
    private_auth(&auth_path, SAVED_TOKEN, &server);

    let output = run_command(&auth_path, &publishing_path, &["whoami"], None).await;
    assert!(!output.status.success());
    let printed = output_text(&output);
    assert!(printed.contains("authentication server is unreachable"));
    assert!(printed.contains("credential was not verified"));
    assert!(!printed.contains("Publisher ID: saved-device"));
    assert!(!printed.contains(SAVED_TOKEN));
}

#[tokio::test]
async fn login_does_not_follow_a_cross_origin_redirect_with_the_publisher_token() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    let auth_path = temp.path().join("auth/config.json");
    let target = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let target_origin = origin(&target);
    let source = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let source_origin = origin(&source);
    let mock = mock_server(
        source,
        vec![MockResponse {
            status: 302,
            body: String::new(),
            location: Some(format!("{target_origin}/__api/v1/auth/me")),
        }],
    )
    .await;

    let output = run_command(
        &auth_path,
        &publishing_path,
        &["login", "--server", &source_origin, "--token-stdin"],
        Some(&format!("{TOKEN}\n")),
    )
    .await;
    assert!(!output.status.success());
    assert!(output_text(&output).contains("redirected"));
    assert!(!output_text(&output).contains(TOKEN));
    mock.await.unwrap();
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(250), target.accept())
            .await
            .is_err()
    );
    assert!(!auth_path.exists());
}

#[tokio::test]
async fn team_mismatch_and_changed_auth_path_inside_artifacts_fail_before_saving() {
    let temp = tempfile::tempdir().unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    std::fs::write(&publishing_path, r#"{"team":"other-team"}"#).unwrap();
    let auth_path = temp.path().join("auth/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = origin(&listener);
    let mock = mock_server(
        listener,
        vec![MockResponse {
            status: 200,
            body: IDENTITY.into(),
            location: None,
        }],
    )
    .await;
    let output = run_command(
        &auth_path,
        &publishing_path,
        &["login", "--server", &server, "--token-stdin"],
        Some(&format!("{TOKEN}\n")),
    )
    .await;
    assert!(!output.status.success());
    assert!(output_text(&output).contains("publishing configuration selects 'other-team'"));
    assert!(!auth_path.exists());
    mock.await.unwrap();

    let inside_path = root.join(".config/auth.json");
    let output = run_command(&inside_path, &publishing_path, &["whoami"], None).await;
    assert!(!output.status.success());
    assert!(output_text(&output).contains("outside the watched artifact root"));
}

#[tokio::test]
async fn logout_notifies_running_daemon_pauses_uploads_and_preserves_pending_work() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir(&home).unwrap();
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    std::fs::write(
        &publishing_path,
        r#"{"team":"w3dev","sync":{"debounceMs":50,"maxConcurrentUploads":1,"auditIntervalSeconds":0}}"#,
    )
    .unwrap();
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server = origin(&listener);
    private_auth(&auth_path, TOKEN, &server);
    let (mut requests, server_task) = daemon_mock_server(listener);

    let mut daemon =
        command_with_home(&home, &auth_path, &publishing_path, &["daemon"], None, None);
    let initial_request = tokio::time::timeout(std::time::Duration::from_secs(3), requests.recv())
        .await
        .expect("daemon did not validate its credential")
        .expect("mock server stopped");
    assert!(initial_request.starts_with("GET /__api/v1/auth/me "));
    let socket_path = home.join(".config/artifact-sync/daemon.sock");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !socket_path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("daemon control socket did not appear");

    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(1200), requests.recv())
            .await
            .is_err(),
        "the idle daemon must not periodically call the auth server"
    );

    let output =
        run_command_with_home(&home, &auth_path, &publishing_path, &["logout"], None, None).await;
    assert!(output.status.success(), "{}", output_text(&output));
    assert!(output_text(&output).contains("running daemon was notified"));
    assert!(output_text(&output).contains("does not revoke the token on the server"));
    let saved: Value = serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    assert!(saved.get("auth").is_none());

    std::fs::write(root.join("queued-after-logout.txt"), "must remain pending").unwrap();
    let database_path = home.join(".local/state/artifact-sync/state.sqlite3");
    let queued = tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if database_path.exists() {
                let database = rusqlite::Connection::open(&database_path).unwrap();
                let pending: i64 = database
                    .query_row("SELECT COUNT(*) FROM pending", [], |row| row.get(0))
                    .unwrap();
                if pending == 1 {
                    break;
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .is_ok();
    if !queued {
        let status = daemon.try_wait().unwrap();
        let database_exists = database_path.exists();
        let pending_count = if database_exists {
            rusqlite::Connection::open(&database_path)
                .and_then(|database| {
                    database.query_row("SELECT COUNT(*) FROM pending", [], |row| {
                        row.get::<_, i64>(0)
                    })
                })
                .ok()
        } else {
            None
        };
        let files = std::fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .map(|entry| entry.file_name().to_string_lossy().to_string())
            .collect::<Vec<_>>();
        daemon.start_kill().unwrap();
        let output = daemon.wait_with_output().await.unwrap();
        server_task.abort();
        panic!(
            "artifact change was not kept in the durable pending queue; daemon status: {status:?}; database: {database_exists}; pending: {pending_count:?}; files: {files:?}; stdout: {}; stderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr),
        );
    }
    assert!(
        tokio::time::timeout(std::time::Duration::from_millis(500), requests.recv())
            .await
            .is_err(),
        "logout must stop further credential exchanges and uploads"
    );

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server_task.abort();
}

#[tokio::test]
async fn logout_reports_an_environment_token_it_cannot_remove() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir(&home).unwrap();
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    let auth_path = home.join(".config/artifact-sync/config.json");
    private_auth(&auth_path, SAVED_TOKEN, "https://saved.example");

    let output = run_command_with_home(
        &home,
        &auth_path,
        &publishing_path,
        &["logout"],
        None,
        Some("as_pub_environment_secret"),
    )
    .await;
    assert!(output.status.success(), "{}", output_text(&output));
    assert!(
        output_text(&output)
            .contains("logout cannot remove it from the parent shell or service configuration")
    );
    assert!(!output_text(&output).contains("as_pub_environment_secret"));
    let saved: Value = serde_json::from_slice(&std::fs::read(&auth_path).unwrap()).unwrap();
    assert!(saved.get("auth").is_none());
}

#[tokio::test]
async fn offline_startup_keeps_work_and_recovers_when_the_gateway_returns() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir(&home).unwrap();
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    std::fs::write(
        root.join("offline-work.txt"),
        "pending until the server returns",
    )
    .unwrap();
    let publishing_path = root.join("config.json");
    std::fs::write(&publishing_path, r#"{"team":"w3dev"}"#).unwrap();
    let auth_path = home.join(".config/artifact-sync/config.json");
    let reserved = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&reserved);
    let server_address = reserved.local_addr().unwrap();
    drop(reserved);
    private_auth(&auth_path, TOKEN, &server_origin);

    let mut daemon =
        command_with_home(&home, &auth_path, &publishing_path, &["daemon"], None, None);
    let database_path = home.join(".local/state/artifact-sync/state.sqlite3");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        loop {
            if pending_state(&database_path)
                .is_some_and(|(count, attempts)| count == 1 && attempts >= 1)
            {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(25)).await;
        }
    })
    .await
    .expect("offline upload failure was not retained with backoff");

    let listener = TcpListener::bind(server_address).await.unwrap();
    let (mut requests, server_task) = temporary_credentials_server(listener);
    let request = tokio::time::timeout(std::time::Duration::from_secs(4), requests.recv())
        .await
        .expect("daemon did not retry after connectivity returned")
        .expect("temporary credential server stopped");
    assert!(request.starts_with("POST /__api/v1/uploads/credentials "));
    assert!(
        request
            .lines()
            .any(|line| { line.eq_ignore_ascii_case(&format!("authorization: Bearer {TOKEN}")) })
    );
    assert_eq!(pending_state(&database_path).unwrap().0, 1);

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server_task.await.unwrap();
}

#[tokio::test]
async fn daemon_starts_with_environment_credentials_without_persisting_them() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("home");
    std::fs::create_dir(&home).unwrap();
    std::fs::set_permissions(&home, std::fs::Permissions::from_mode(0o700)).unwrap();
    let root = temp.path().join("artifacts");
    std::fs::create_dir(&root).unwrap();
    let publishing_path = root.join("config.json");
    std::fs::write(&publishing_path, r#"{"team":"w3dev"}"#).unwrap();
    let auth_path = home.join(".config/artifact-sync/config.json");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let server_origin = origin(&listener);
    let (mut requests, server_task) = daemon_mock_server(listener);

    let mut daemon = daemon_with_environment_credential(
        &home,
        &auth_path,
        &publishing_path,
        TOKEN,
        &server_origin,
    );
    let request = tokio::time::timeout(std::time::Duration::from_secs(3), requests.recv())
        .await
        .expect("daemon did not validate its environment credential")
        .expect("mock server stopped");
    assert!(request.starts_with("GET /__api/v1/auth/me "));
    let socket_path = home.join(".config/artifact-sync/daemon.sock");
    tokio::time::timeout(std::time::Duration::from_secs(3), async {
        while !socket_path.exists() {
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
    })
    .await
    .expect("daemon control socket did not appear");
    assert!(auth_path.parent().unwrap().is_dir());
    assert!(
        !auth_path.exists(),
        "environment credentials must stay in memory"
    );

    daemon.start_kill().unwrap();
    let _ = daemon.wait().await;
    server_task.abort();
}
