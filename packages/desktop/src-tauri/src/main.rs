// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::io::{Read, Write};
use std::net::TcpStream;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_shell::ShellExt;
use tauri_plugin_shell::process::CommandChild;

/// Holds the backend child process so it stays alive for the app's lifetime.
/// Dropping CommandChild kills the backend process.
/// Holds the backend child process so it stays alive for the app's lifetime.
/// The `child` field is intentionally never read — it's stored in managed
/// Tauri state solely so its Drop implementation runs on app close,
/// which kills the backend sidecar process.
#[allow(dead_code)]
struct BackendChild {
    child: Option<CommandChild>,
}

/// The fixed port the backend listens on.
/// Both the Rust sidecar and the frontend API client agree on this value.
const BACKEND_PORT: u16 = 3001;

/// Quick TCP health check — tries to connect to the backend port and sends a
/// minimal HTTP GET to /api/health to confirm the server is responding.
fn is_backend_running(port: u16) -> bool {
    if let Ok(mut stream) = TcpStream::connect_timeout(
        &format!("127.0.0.1:{}", port).parse().unwrap(),
        Duration::from_millis(500),
    ) {
        let _ = write!(
            stream,
            "GET /api/health HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n\r\n",
            port
        );
        let mut response = String::new();
        if stream.read_to_string(&mut response).is_ok() {
            return response.contains("200 OK") || response.contains("\"status\":\"ok\"");
        }
    }
    false
}

/// Poll the backend health endpoint in a background thread.
/// Logs progress so users can diagnose startup issues.
fn poll_backend_health(port: u16) {
    std::thread::spawn(move || {
        let url = format!("http://127.0.0.1:{}/api/health", port);
        let mut last_log = 0u64;

        for attempt in 1..=60u64 {
            match ureq::get(&url).call() {
                Ok(resp) if resp.status() == 200 => {
                    println!("[panelshelf] Backend ready on port {}", port);
                    return;
                }
                _ => {
                    std::thread::sleep(std::time::Duration::from_millis(500));
                    if attempt - last_log >= 10 {
                        println!(
                            "[panelshelf] Waiting for backend... (attempt {}/{})",
                            attempt, 60
                        );
                        last_log = attempt;
                    }
                }
            }
        }
        eprintln!(
            "[panelshelf] Backend did not become available on port {} within 30 seconds",
            port
        );
    });
}

fn main() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(move |app| {
            // Check if the backend is already running (e.g., in dev mode via tsx)
            if is_backend_running(BACKEND_PORT) {
                println!(
                    "[panelshelf] Backend already running on port {} (dev mode)",
                    BACKEND_PORT
                );
            } else {
                // In production mode, spawn the backend as a sidecar process
                let shell = app.shell();
                let sidecar_command = shell.sidecar("panelshelf-backend");

                if let Ok(cmd) = sidecar_command {
                    let data_dir = app
                        .path()
                        .app_data_dir()
                        .unwrap_or_else(|_| std::path::PathBuf::from("."));

                    std::fs::create_dir_all(&data_dir).ok();
                    std::fs::create_dir_all(data_dir.join("downloads")).ok();

                    match cmd
                        .env("PORT", BACKEND_PORT.to_string())
                        .env("HOST", "127.0.0.1")
                        .env("DATA_DIR", data_dir.to_string_lossy().to_string())
                        .env("NODE_ENV", "production")
                        .spawn()
                    {
                        Ok((_rx, child)) => {
                            println!(
                                "[panelshelf] Backend sidecar started on port {}",
                                BACKEND_PORT
                            );
                            app.manage(BackendChild {
                                child: Some(child),
                            });
                        }
                        Err(e) => {
                            eprintln!(
                                "[panelshelf] Failed to spawn backend sidecar: {}. \
                                 Make sure the backend is built: pnpm run build:backend",
                                e
                            );
                        }
                    }
                } else {
                    eprintln!(
                        "[panelshelf] Sidecar binary not found. \
                         In dev mode, start the backend separately via `pnpm dev`. \
                         In production, build it first: pnpm run build:backend"
                    );
                }
            }

            // Start polling backend health in a background thread.
            // The window opens immediately regardless of backend readiness.
            poll_backend_health(BACKEND_PORT);

            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                // Use app_handle().exit() instead of process::exit() so that
                // Rust Drop implementations run (e.g. killing the sidecar child).
                window.app_handle().exit(0);
            }
        })
        .run(tauri::generate_context!())
        .expect("Error running PanelShelf desktop app");
}
