#![cfg(windows)]

use artifact_sync::auth::credentials::{CachedIdentity, SavedAuth, SecretString};
use artifact_sync::auth::store::CredentialStore;
use std::fs::OpenOptions;
use std::os::windows::fs::OpenOptionsExt;
use std::process::Command;
use std::sync::Arc;
use windows_sys::Win32::Foundation::{GENERIC_READ, GENERIC_WRITE};
use windows_sys::Win32::Storage::FileSystem::{DELETE, FILE_SHARE_READ, FILE_SHARE_WRITE};

fn auth() -> SavedAuth {
    SavedAuth {
        auth_type: "team_token".into(),
        access_token: SecretString::new(
            "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJhcnRpZmFjdC1zeW5jIn0.AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
        ),
        refresh_token: SecretString::new("as_rf_BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB"),
        token_id: "api_test".into(),
        expires_at: chrono::Utc::now() + chrono::Duration::days(1),
        cached_identity: CachedIdentity {
            user_id: "user".into(),
            email: "user@example.test".into(),
            name: "User".into(),
            team_id: "team".into(),
            team: "test".into(),
            permissions: vec!["artifacts:publish".into()],
        },
    }
}

#[test]
fn credentials_remain_atomic_under_concurrent_reads_login_and_logout() {
    let temp = tempfile::tempdir().unwrap();
    let store = Arc::new(CredentialStore::new(
        temp.path().join("private/config.json"),
    ));
    store.save_login("https://example.test", &auth()).unwrap();
    std::thread::scope(|scope| {
        for index in 0..6 {
            let store = Arc::clone(&store);
            scope.spawn(move || {
                for _ in 0..20 {
                    match index % 3 {
                        0 => store.save_login("https://example.test", &auth()).unwrap(),
                        1 => {
                            store.logout().unwrap();
                        }
                        _ => {
                            assert_eq!(store.load().unwrap().unwrap().version, 1);
                        }
                    }
                }
            });
        }
    });
    let mut value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(store.path()).unwrap()).unwrap();
    value["unrelated"] = serde_json::json!({"enabled": true});
    std::fs::write(store.path(), serde_json::to_vec(&value).unwrap()).unwrap();
    store.save_login("https://example.test", &auth()).unwrap();
    assert!(store.logout().unwrap());
    let value: serde_json::Value =
        serde_json::from_slice(&std::fs::read(store.path()).unwrap()).unwrap();
    assert_eq!(value["unrelated"]["enabled"], true);
    assert!(value.get("auth").is_none());
}

#[test]
fn login_rejects_newer_configuration_versions_without_modifying_them() {
    let temp = tempfile::tempdir().unwrap();
    let store = CredentialStore::new(temp.path().join("private/config.json"));
    store.save_login("https://example.test", &auth()).unwrap();
    let newer = br#"{"version":2,"serverUrl":"https://future.example"}"#;
    std::fs::write(store.path(), newer).unwrap();

    assert!(store.save_login("https://example.test", &auth()).is_err());
    assert_eq!(std::fs::read(store.path()).unwrap(), newer);
}

#[test]
fn failed_credential_replacements_remove_temporary_files() {
    let temp = tempfile::tempdir().unwrap();
    let store = CredentialStore::new(temp.path().join("private/config.json"));
    store.save_login("https://example.test", &auth()).unwrap();
    let original = std::fs::read(store.path()).unwrap();
    let blocker = OpenOptions::new()
        .read(true)
        .share_mode(FILE_SHARE_READ | FILE_SHARE_WRITE)
        .open(store.path())
        .unwrap();

    for _ in 0..3 {
        assert!(store.save_login("https://other.example", &auth()).is_err());
        assert!(store.logout().is_err());
        assert_eq!(std::fs::read(store.path()).unwrap(), original);
        assert_eq!(
            std::fs::read_dir(store.path().parent().unwrap())
                .unwrap()
                .count(),
            2
        );
    }

    drop(blocker);
    store.save_login("https://other.example", &auth()).unwrap();
    assert!(store.logout().unwrap());
    assert!(store.load().unwrap().unwrap().auth.is_none());
}

#[test]
fn read_write_only_lock_files_allow_credential_updates() {
    let temp = tempfile::tempdir().unwrap();
    let store = CredentialStore::new(temp.path().join("private/config.json"));
    store.save_login("https://example.test", &auth()).unwrap();
    let lock = store.path().with_extension("json.lock");
    let output = Command::new("whoami")
        .args(["/user", "/fo", "csv", "/nh"])
        .output()
        .unwrap();
    assert!(output.status.success());
    let identity = String::from_utf8(output.stdout).unwrap();
    let sid = identity
        .rsplit(',')
        .next()
        .unwrap()
        .trim()
        .trim_matches('"');
    assert!(sid.starts_with("S-1-"));
    for (path, permissions) in [
        (store.path().parent().unwrap(), "(OI)(CI)(RX,W)"),
        (lock.as_path(), "(R,W)"),
    ] {
        let output = Command::new("icacls")
            .arg(path)
            .arg("/inheritance:r")
            .arg("/grant:r")
            .arg(format!("*{sid}:{permissions}"))
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
    }
    let error = OpenOptions::new()
        .access_mode(GENERIC_READ | GENERIC_WRITE | DELETE)
        .open(&lock)
        .unwrap_err();
    assert_eq!(error.kind(), std::io::ErrorKind::PermissionDenied);

    store.save_login("https://other.example", &auth()).unwrap();
    assert!(store.logout().unwrap());
    let output = Command::new("icacls")
        .arg(store.path().parent().unwrap())
        .arg("/grant:r")
        .arg(format!("*{sid}:(OI)(CI)(F)"))
        .output()
        .unwrap();
    assert!(output.status.success());
}

#[test]
fn rejects_sqlite_sidecars_granted_to_everyone() {
    let temp = tempfile::tempdir().unwrap();
    let profile = temp.path().join("state profile");
    std::fs::create_dir(&profile).unwrap();
    let previous_profile = std::env::var_os("USERPROFILE");
    unsafe { std::env::set_var("USERPROFILE", &profile) };
    let state = artifact_sync::state::SyncState::open_default().unwrap();
    let sidecar = profile.join(".local/state/artifact-sync/state.sqlite3-wal");
    assert!(sidecar.exists());
    let output = Command::new("icacls")
        .arg(&sidecar)
        .args(["/grant", "*S-1-1-0:(R)"])
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    let reopened = artifact_sync::state::SyncState::open_default();
    drop(state);
    match previous_profile {
        Some(value) => unsafe { std::env::set_var("USERPROFILE", value) },
        None => unsafe { std::env::remove_var("USERPROFILE") },
    }
    assert!(reopened.is_err());
}

#[test]
fn rejects_credentials_or_directory_with_access_granted_to_everyone() {
    for directory in [false, true] {
        let temp = tempfile::tempdir().unwrap();
        let store = CredentialStore::new(temp.path().join("private/config.json"));
        store.save_login("https://example.test", &auth()).unwrap();
        let path = if directory {
            store.path().parent().unwrap()
        } else {
            store.path()
        };
        let output = Command::new("icacls")
            .arg(path)
            .args(["/grant", "*S-1-1-0:(R)"])
            .output()
            .unwrap();
        assert!(
            output.status.success(),
            "{}",
            String::from_utf8_lossy(&output.stderr)
        );
        assert!(store.load().is_err());
        assert!(store.save_login("https://example.test", &auth()).is_err());
    }
}

#[test]
fn rejects_junctions_in_credential_paths() {
    let temp = tempfile::tempdir().unwrap();
    let store = CredentialStore::new(temp.path().join("private/config.json"));
    store.save_login("https://example.test", &auth()).unwrap();
    let junction = temp.path().join("junction");
    let output = Command::new("cmd")
        .args(["/C", "mklink", "/J"])
        .arg(&junction)
        .arg(store.path().parent().unwrap())
        .output()
        .unwrap();
    assert!(
        output.status.success(),
        "{}",
        String::from_utf8_lossy(&output.stderr)
    );
    assert!(
        CredentialStore::new(junction.join("config.json"))
            .load()
            .is_err()
    );
    std::fs::remove_dir(&junction).unwrap();
}
