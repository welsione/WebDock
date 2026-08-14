// Tauri PoC — 验证目标：
// 1. 同窗口多 WebView 布局（本地侧边栏 + 第三方内容）
// 2. WKWebView 站点兼容性
// 3. 通知桥（自定义协议上报，无 console-message 事件）
// 4. 会话持久化
// 安全红线：第三方内容 WebView 不暴露任何 Tauri/IPC 能力

use serde::Serialize;
use tauri::{
    menu::{Menu, MenuItem},
    Emitter, Manager, PhysicalPosition, PhysicalSize, Position, Size, WebviewBuilder,
    WebviewUrl, WindowBuilder,
};

const NOTIFY_SCHEME: &str = "mineai-notify";

// Tauri 2 的 Rect 为具名字段结构体，需手动构造（Position/Size 为枚举包装）
fn rect(x: i32, y: i32, w: u32, h: u32) -> tauri::Rect {
    tauri::Rect {
        position: Position::Physical(PhysicalPosition::new(x, y)),
        size: Size::Physical(PhysicalSize::new(w, h)),
    }
}

// ===== 通知桥注入脚本 =====
// 替换 window.Notification，通过自定义协议 fetch 上报。
// KEY 在注入时内嵌，页面无法伪造来源。
fn build_notify_bridge(key: &str) -> String {
    let safe_key = serde_json::to_string(key).unwrap_or_else(|_| "\"unknown\"".into());
    format!(
        r#"(function(){{
            var O = window.Notification;
            var KEY = {key};
            window.Notification = function(t, o) {{
                try {{
                    var body = (o && o.body) || '';
                    var payload = encodeURIComponent(JSON.stringify({{title: String(t).slice(0,100), body: String(body).slice(0,500)}}));
                    fetch('{scheme}://notify?p=' + payload, {{mode: 'no-cors'}}).catch(function(){{}});
                }} catch(e) {{}}
                try {{ return new O(t, o); }} catch(e) {{ return null; }}
            }};
            Object.keys(O).forEach(function(k) {{ try {{ window.Notification[k] = O[k]; }} catch(e) {{}} }});
            window.Notification.prototype = O.prototype;
            window.Notification.requestPermission = function(cb) {{ var p = Promise.resolve('granted'); if (cb) cb('granted'); return p; }};
        }})()"#,
        key = safe_key,
        scheme = NOTIFY_SCHEME
    )
}

#[derive(Serialize)]
struct CmdResult {
    ok: bool,
    msg: String,
}

// ===== 切换内容 WebView 到指定站点（同一 webview 导航，会话保留）=====
#[tauri::command]
fn navigate_to(app: tauri::AppHandle, url: String) -> CmdResult {
    match app.get_webview("content") {
        Some(wv) => match url.parse::<tauri::Url>() {
            Ok(parsed) => match wv.navigate(parsed) {
                Ok(()) => {
                    // 诊断：验证 Rust → ui 事件通道（与 notify 走同一 emit_to 机制）
                    let _ = app.emit_to(
                        "ui",
                        "poc-test",
                        serde_json::json!({ "type": "nav", "url": url }),
                    );
                    CmdResult { ok: true, msg: "已导航".into() }
                }
                Err(e) => CmdResult { ok: false, msg: format!("导航失败: {e}") },
            },
            Err(_) => CmdResult { ok: false, msg: "URL 解析失败".into() },
        },
        None => CmdResult { ok: false, msg: "content webview 不存在".into() },
    }
}

// ===== 动态调整侧边栏宽度（验证 bounds 实时控制）=====
#[tauri::command]
fn set_sidebar_width(app: tauri::AppHandle, width: f64) -> CmdResult {
    let Some(win) = app.get_window("main") else {
        return CmdResult { ok: false, msg: "窗口不存在".into() };
    };
    let Ok(scale) = win.scale_factor() else {
        return CmdResult { ok: false, msg: "无法获取缩放".into() };
    };
    let Ok(size) = win.inner_size() else {
        return CmdResult { ok: false, msg: "无法获取窗口尺寸".into() };
    };
    let sidebar_w = (width * scale) as u32;
    let content_w = size.width.saturating_sub(sidebar_w);
    let mut failed = false;
    if let Some(ui) = app.get_webview("ui") {
        if ui
            .set_bounds(rect(0, 0, sidebar_w, size.height))
            .is_err()
        {
            failed = true;
        }
    }
    if let Some(content) = app.get_webview("content") {
        if content
            .set_bounds(rect(sidebar_w as i32, 0, content_w, size.height))
            .is_err()
        {
            failed = true;
        }
    }
    CmdResult {
        ok: !failed,
        msg: format!("侧边栏 {sidebar_w}px / 内容 {content_w}px（物理像素）"),
    }
}

// ===== JS 收到事件后的回传（闭环验证 Rust → UI 事件通道）=====
#[tauri::command]
fn report_event_received(event: String, payload: String) {
    println!("[PoC][event-ack] JS 已收到事件 {}: payload={}", event, payload);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .invoke_handler(tauri::generate_handler![
            navigate_to,
            set_sidebar_width,
            report_event_received
        ])
        .register_uri_scheme_protocol(NOTIFY_SCHEME, |ctx, req| {
            // 通知上报入口：解析 payload → 转发给本地 UI（事件）
            let uri = req.uri().to_string();
            let mut title = String::new();
            let mut body = String::new();
            if let Some(q) = uri.split('?').nth(1) {
                for pair in q.split('&') {
                    let mut it = pair.splitn(2, '=');
                    if let (Some(k), Some(v)) = (it.next(), it.next()) {
                        let val = urlencoding_decode(v);
                        if k == "p" {
                            if let Ok(parsed) = serde_json::from_str::<serde_json::Value>(&val) {
                                title = parsed
                                    .get("title")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                                body = parsed
                                    .get("body")
                                    .and_then(|x| x.as_str())
                                    .unwrap_or("")
                                    .to_string();
                            }
                        }
                    }
                }
            }
            println!("[PoC][notify] title={} body={}", title, body);
            // 转发到本地 UI（PoC：来源固定为 content webview 注入的 KEY）
            let _ = ctx.app_handle().emit_to(
                "ui",
                "notify-received",
                serde_json::json!({
                    "title": title,
                    "body": body,
                    "key": "content",
                    "at": chrono_now_ms(),
                }),
            );
            tauri::http::Response::builder()
                .header("Access-Control-Allow-Origin", "*")
                .status(200)
                .body(Vec::new())
                .unwrap()
        })
        .setup(|app| {
            // ===== 主窗口 =====
            let win = WindowBuilder::new(app, "main")
                .title("Tauri PoC — 多 WebView 布局验证")
                .inner_size(1000.0, 700.0)
                .min_inner_size(600.0, 400.0)
                .build()?;

            // ===== 本地侧边栏 WebView（受信任 UI）=====
            win.add_child(
                WebviewBuilder::new("ui", WebviewUrl::App("index.html".into())),
                PhysicalPosition::new(0, 0),
                PhysicalSize::new(240, 700),
            )?;

            // ===== 内容 WebView（第三方站点，不可信）=====
            win.add_child(
                WebviewBuilder::new(
                    "content",
                    WebviewUrl::External("https://chat.deepseek.com/".parse().unwrap()),
                )
                // 导航策略：白名单内留在应用内，其余记录并拦截（PoC 行为记录）
                .on_navigation(|url| {
                    let u = url.as_str();
                    // 注意：kimi.moonshot.cn 会 302 → www.kimi.com，必须通配 kimi.com
                    let allowed = u.starts_with("https://chat.deepseek.com")
                        || u.starts_with("https://www.doubao.com")
                        || u.starts_with("https://kimi.moonshot.cn")
                        || u.starts_with("https://www.kimi.com")
                        || u.starts_with("https://github.com")
                        // dev 模式本地通知测试页
                        || u.starts_with("http://localhost:1420/test-notify.html");
                    if !allowed {
                        println!("[PoC][nav] 拦截外部导航: {}", u);
                    }
                    allowed
                })
                // 通知桥注入
                .initialization_script(&build_notify_bridge("content"))
                // 页面加载日志（验证加载状态与注入时机）
                .on_page_load(|webview, payload| {
                    println!(
                        "[PoC][load] {} → {:?} ({:?})",
                        webview.label(),
                        payload.url(),
                        payload.event()
                    );
                }),
                PhysicalPosition::new(240, 0),
                PhysicalSize::new(760, 700),
            )?;

            // ===== 应用菜单（退出）=====
            let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
            let menu = Menu::with_items(app, &[&quit])?;
            app.set_menu(menu)?;

            println!("[PoC] 双 WebView 已创建: ui(240px) + content(chat.deepseek.com)");

            // ===== 自动事件探针：3 秒后 emit，JS 收到后经 invoke 回传（闭环验证）=====
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                std::thread::sleep(std::time::Duration::from_secs(3));
                let r = handle.emit_to("ui", "poc-test", serde_json::json!({"type": "auto"}));
                println!("[PoC][emit-probe] emit_to(ui) result: {:?}", r);
            });
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

fn chrono_now_ms() -> u64 {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as u64)
        .unwrap_or(0)
}

// ===== 极简 URL 解码（PoC 够用；完整方案用 percent-encoding crate）=====
fn urlencoding_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out: Vec<u8> = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let (Some(h), Some(l)) = (hex_val(bytes[i + 1]), hex_val(bytes[i + 2])) {
                out.push(h * 16 + l);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn hex_val(b: u8) -> Option<u8> {
    match b {
        b'0'..=b'9' => Some(b - b'0'),
        b'a'..=b'f' => Some(b - b'a' + 10),
        b'A'..=b'F' => Some(b - b'A' + 10),
        _ => None,
    }
}
