use artifact_sync::auth::credentials::{CachedIdentity, SavedAuth, SecretString};
use artifact_sync::auth::store::CredentialStore;
use std::path::Path;
use std::process::Stdio;
use std::time::Duration;
use tokio::process::{Child, Command};

fn command(home: &Path, arguments: &[&str]) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_artifact-sync"));
    command
        .env_remove("ARTIFACTS_PUBLISH_TOKEN")
        .env_remove("ARTIFACT_SYNC_SERVER_URL")
        .env_remove("ARTIFACT_SYNC_AUTH_CONFIG")
        .env("HOME", home)
        .env("USERPROFILE", home)
        .env("ARTIFACT_SYNC_ALLOW_INSECURE_HTTP", "1")
        .args(arguments)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    command
}

async fn status(home: &Path) -> Option<serde_json::Value> {
    let output = command(home, &["daemon", "--status"])
        .output()
        .await
        .unwrap();
    if !output.status.success() {
        return None;
    }
    serde_json::from_slice(&output.stdout).ok()
}

async fn wait_ready(home: &Path, child: &mut Child) -> serde_json::Value {
    tokio::time::timeout(Duration::from_secs(10), async {
        loop {
            assert!(
                child.try_wait().unwrap().is_none(),
                "daemon exited before becoming ready"
            );
            if let Some(status) = status(home).await {
                return status;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
    })
    .await
    .unwrap()
}

#[tokio::test]
async fn daemon_status_duplicate_start_graceful_stop_and_restart() {
    let temp = tempfile::tempdir().unwrap();
    let home = temp.path().join("profile with spaces");
    std::fs::create_dir(&home).unwrap();
    let reservation = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let origin = format!("http://{}", reservation.local_addr().unwrap());
    drop(reservation);
    CredentialStore::new(home.join(".config/artifact-sync/config.json"))
        .save_login(&origin, &SavedAuth {
            auth_type: "team_token".into(),
            access_token: SecretString::new("eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcnRpZmFjdC1zeW5jIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"),
            refresh_token: SecretString::new("as_rf_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
            token_id: "api_test".into(),
            expires_at: chrono::Utc::now() + chrono::Duration::days(1),
            cached_identity: CachedIdentity { user_id: "user".into(), email: "user@example.test".into(), name: "User".into(), team_id: "team".into(), team: "test".into(), permissions: vec!["artifacts:publish".into()] },
        }).unwrap();

    for _ in 0..2 {
        let mut daemon = command(&home, &["daemon"])
            .kill_on_drop(true)
            .spawn()
            .unwrap();
        let current = wait_ready(&home, &mut daemon).await;
        assert_eq!(current["publishingState"], "offline");
        assert_eq!(current["identityVerified"], false);
        assert_eq!(current["processId"].as_u64(), daemon.id().map(u64::from));
        let duplicate = tokio::time::timeout(
            Duration::from_secs(10),
            command(&home, &["daemon"]).output(),
        )
        .await
        .unwrap()
        .unwrap();
        assert!(!duplicate.status.success());
        assert_eq!(
            status(&home).await.unwrap()["processId"],
            current["processId"]
        );
        let stop = command(&home, &["daemon", "--stop"])
            .output()
            .await
            .unwrap();
        assert!(
            stop.status.success(),
            "{}",
            String::from_utf8_lossy(&stop.stderr)
        );
        assert!(
            tokio::time::timeout(Duration::from_secs(5), daemon.wait())
                .await
                .unwrap()
                .unwrap()
                .success()
        );
        assert!(status(&home).await.is_none());
    }
}
