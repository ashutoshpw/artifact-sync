import { PREFERENCE_MAX_AGE, SIDEBAR_COOKIE, THEME_COOKIE } from "./dashboard-preferences.ts";

const sidebarWidthRules = [64, ...Array.from({ length: 181 }, (_, index) => index + 140)]
  .map((width) => `html[data-layout="sidebar"][data-sidebar-width="${width}"]{--sidebar:${width}px}`)
  .join("");

const dashboardThemeStyles = `
${sidebarWidthRules}
html[data-theme="system"]{color-scheme:light dark}
html[data-theme="light"]{color-scheme:light}
html[data-theme="light"]{--bg:#f5f8f3;--chrome:#edf2ec;--panel:#fff;--panel-raised:#f4f7f2;--panel-hover:#e8efe7;--line:#d5ddd4;--line-strong:#b5c2b4;--text:#172019;--muted:#536157;--subtle:#738177;--accent:#396b11;--accent-strong:#2b560b;--accent-ink:#fff;--danger:#b3261e;--danger-bg:#ffebe8;--warning:#8a5a00;--success:#187c41;--focus:#1267a3;--shadow:0 24px 70px rgba(32,52,36,.16)}
@media(prefers-color-scheme:light){html[data-theme="system"]{--bg:#f5f8f3;--chrome:#edf2ec;--panel:#fff;--panel-raised:#f4f7f2;--panel-hover:#e8efe7;--line:#d5ddd4;--line-strong:#b5c2b4;--text:#172019;--muted:#536157;--subtle:#738177;--accent:#396b11;--accent-strong:#2b560b;--accent-ink:#fff;--danger:#b3261e;--danger-bg:#ffebe8;--warning:#8a5a00;--success:#187c41;--focus:#1267a3;--shadow:0 24px 70px rgba(32,52,36,.16)}}
html[data-theme="light"] .context-bar,html[data-theme="system"] .context-bar{background:rgba(237,242,236,.94)}
html[data-theme="light"] .team-monogram,html[data-theme="system"] .team-monogram{background:#e4ece2}
html[data-theme="light"] .role-owner,html[data-theme="system"] .role-owner{border-color:#9fbe85;background:#edf7e7}
html[data-theme="light"] .role-admin,html[data-theme="system"] .role-admin{border-color:#9eb7d8;background:#edf3fc}
html[data-theme="light"] .switcher-menu,html[data-theme="light"] .account-popover,html[data-theme="system"] .switcher-menu,html[data-theme="system"] .account-popover{background:var(--panel)}
html[data-theme="light"] .sidebar,html[data-theme="system"] .sidebar{background:#eef3ed}
html[data-theme="light"] .sidebar a[aria-current="page"],html[data-theme="system"] .sidebar a[aria-current="page"]{background:#e1ebdf}
html[data-theme="light"] .table-row:hover:not(.table-head),html[data-theme="system"] .table-row:hover:not(.table-head){background:#f0f5ef}
html[data-theme="light"] .table-head,html[data-theme="system"] .table-head{background:#edf2ec}
html[data-theme="light"] .slug-value,html[data-theme="light"] .base-url-row,html[data-theme="system"] .slug-value,html[data-theme="system"] .base-url-row{background:#f1f5f0}
html[data-theme="light"] .field input,html[data-theme="light"] .field select,html[data-theme="system"] .field input,html[data-theme="system"] .field select{background:#fbfdfb;color:var(--text)}
html[data-theme="light"] .permission-note,html[data-theme="light"] .settings-aside,html[data-theme="system"] .permission-note,html[data-theme="system"] .settings-aside{background:#f1f5f0}
html[data-theme="light"] .secret-reveal,html[data-theme="system"] .secret-reveal{border-color:#9fbe85;background:#edf7e7}
html[data-theme="light"] .secret-row code,html[data-theme="system"] .secret-row code{background:#f1f5f0;color:var(--text)}
html[data-theme="light"] .scope-tabs,html[data-theme="system"] .scope-tabs{background:#f1f5f0}
html[data-theme="light"] .modal,html[data-theme="light"] .scope-preview,html[data-theme="system"] .modal,html[data-theme="system"] .scope-preview{background:var(--panel)}
html[data-theme="light"] .mobile-navigation,html[data-theme="system"] .mobile-navigation{background:rgba(255,255,255,.96)}
html[data-theme="light"] .approval-page,html[data-theme="system"] .approval-page{background:radial-gradient(circle at 15% 10%,rgba(57,107,17,.08),transparent 26rem),var(--bg)}
html[data-theme="light"] .approval-card,html[data-theme="system"] .approval-card{background:var(--panel)}
html[data-theme="light"] .success-mark,html[data-theme="system"] .success-mark{border-color:#9bc5aa;background:#edf8f0}
html[data-theme="light"] .table-row code,html[data-theme="system"] .table-row code{color:#3f5045}
html[data-theme="light"] .modal::backdrop,html[data-theme="system"] .modal::backdrop{background:rgba(26,42,29,.38)}

html[data-layout="sidebar"] .dashboard-body{transition:grid-template-columns .24s cubic-bezier(.2,.75,.25,1)}
html[data-layout="sidebar"] .sidebar{position:sticky;transition:width .24s cubic-bezier(.2,.75,.25,1)}
html[data-layout="sidebar"] .sidebar.is-dragging,html[data-layout="sidebar"] .sidebar.is-dragging~*,html[data-layout="sidebar"][data-sidebar-dragging="true"] .dashboard-body{transition:none}
.sidebar-head{display:flex;align-items:center;justify-content:space-between;gap:8px;min-height:32px;margin-bottom:13px}
.sidebar-title{padding:0 9px;color:var(--subtle);font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase}
.sidebar-toggle{width:30px;height:30px;flex:0 0 auto}
.sidebar-resize{position:absolute;top:0;right:-5px;bottom:0;width:10px;cursor:col-resize;touch-action:none;z-index:2}
.sidebar-resize:focus-visible{outline:2px solid var(--focus);outline-offset:-2px}
.sidebar-resize::after{position:absolute;top:0;right:4px;bottom:0;width:1px;background:transparent;content:"";transition:background .16s ease}
.sidebar-resize:hover::after,.sidebar-resize:focus-visible::after{background:var(--line-strong)}
html[data-sidebar-collapsed="true"] .sidebar{padding-right:8px;padding-left:8px}
html[data-sidebar-collapsed="true"] .sidebar-head{justify-content:center}
html[data-sidebar-collapsed="true"] .sidebar-title,html[data-sidebar-collapsed="true"] .sidebar .nav-label{display:none}
html[data-sidebar-collapsed="true"] .sidebar nav{gap:6px}
html[data-sidebar-collapsed="true"] .sidebar a{justify-content:center;padding-right:5px;padding-left:5px}
html[data-sidebar-collapsed="true"] .sidebar .nav-glyph{width:30px;height:30px}
html[data-sidebar-collapsed="true"] .sidebar-account>summary{justify-content:center;padding-right:4px;padding-left:4px}
html[data-sidebar-collapsed="true"] .sidebar-account .account-copy,html[data-sidebar-collapsed="true"] .sidebar-account .chevron{display:none}
html[data-sidebar-collapsed="true"] .sidebar-account .account-popover{left:calc(100% + 9px);bottom:0;width:250px}
html[data-sidebar-collapsed="true"] .sidebar-toggle{font-size:13px}
body{overflow-x:hidden}

.theme-picker{display:grid;gap:8px;padding:10px 8px;border-top:1px solid var(--line)}
.theme-picker-label{margin:0;color:var(--subtle);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.theme-picker-options{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:4px}
.theme-picker button{min-height:30px;padding:0 5px;border:1px solid var(--line);border-radius:6px;background:var(--panel-raised);color:var(--muted);font-size:10px}
.theme-picker button:hover{border-color:var(--line-strong);color:var(--text)}
.theme-picker button[aria-pressed="true"]{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}
.theme-picker-compact{padding:8px 0}
.theme-picker-compact .theme-picker-options{padding:0 8px}
.account-popover .theme-picker{margin-top:5px}
.account-settings-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:18px}
.profile-details{display:grid;gap:0;margin:0 0 16px;border-top:1px solid var(--line)}
.profile-details>div{display:flex;align-items:center;justify-content:space-between;gap:18px;padding:13px 0;border-bottom:1px solid var(--line)}
.profile-details dt{color:var(--subtle);font-size:11px}
.profile-details dd{margin:0;color:var(--text);font-size:12px;font-weight:650;overflow-wrap:anywhere;text-align:right}

.mobile-navigation-more{display:grid;place-items:center;gap:3px;padding:7px 3px;border:0;border-radius:7px;background:transparent;color:var(--subtle);font-size:8px}
.mobile-navigation-more:hover,.mobile-navigation-more:focus-visible{background:var(--panel-hover);color:var(--text)}
.mobile-nav-dialog{width:min(440px,calc(100% - 28px));max-height:min(720px,calc(100% - 28px));padding:0;border:1px solid var(--line-strong);border-radius:14px;background:var(--panel);color:var(--text);box-shadow:var(--shadow)}
.mobile-nav-dialog::backdrop{background:rgba(0,0,0,.58);backdrop-filter:blur(3px)}
.mobile-nav-dialog-panel{display:grid;max-height:min(720px,calc(100vh - 28px));overflow:auto}
.mobile-nav-dialog-head{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid var(--line)}
.mobile-nav-dialog-head h2{margin:0;font-size:17px;letter-spacing:-.03em}
.mobile-nav-dialog-links{display:grid;gap:4px;padding:12px}
.mobile-nav-dialog-links a,.mobile-account-actions>a,.mobile-account-actions>form button{display:flex;align-items:center;gap:10px;padding:11px 10px;border:0;border-radius:7px;background:transparent;color:var(--text);font-size:12px;text-align:left;text-decoration:none}
.mobile-nav-dialog-links a:hover,.mobile-nav-dialog-links a[aria-current="page"],.mobile-account-actions>a:hover,.mobile-account-actions>form button:hover{background:var(--panel-hover)}
.mobile-account-actions{display:grid;gap:4px;padding:12px;border-top:1px solid var(--line)}
.mobile-account-actions h3{margin:0 10px 4px;color:var(--subtle);font-size:10px;letter-spacing:.08em;text-transform:uppercase}
.mobile-account-actions>form{margin-top:4px;border-top:1px solid var(--line)}
.mobile-account-actions>form button{width:100%;cursor:pointer}
@media(max-width:820px){
  html[data-layout="sidebar"] .dashboard-body{transition:none}
  html[data-layout="sidebar"] .mobile-navigation{grid-template-columns:repeat(5,minmax(0,1fr))}
  .account-settings-grid{grid-template-columns:1fr}
  .mobile-navigation-more{cursor:pointer}
}
@media(min-width:821px){.mobile-navigation-more,.mobile-nav-dialog{display:none!important}}
@media(prefers-reduced-motion:reduce){html[data-layout="sidebar"] .dashboard-body,html[data-layout="sidebar"] .sidebar{transition:none!important}.sidebar-resize::after{transition:none!important}}
@media(prefers-color-scheme:dark){
  html[data-theme="system"] .context-bar{background:rgba(13,16,14,.94)}
  html[data-theme="system"] .team-monogram{background:#202720}
  html[data-theme="system"] .role-owner{border-color:#42572f;background:#182111}
  html[data-theme="system"] .role-admin{border-color:#33445c;background:#121a24}
  html[data-theme="system"] .sidebar{background:#0b0e0c}
  html[data-theme="system"] .sidebar a[aria-current="page"]{background:#1a201b}
  html[data-theme="system"] .table-row:hover:not(.table-head){background:#131814}
  html[data-theme="system"] .table-head{background:#0e120f}
  html[data-theme="system"] .slug-value,html[data-theme="system"] .base-url-row{background:#0c0f0d}
  html[data-theme="system"] .field input,html[data-theme="system"] .field select{background:#0b0e0c}
  html[data-theme="system"] .permission-note,html[data-theme="system"] .settings-aside{background:#0e120f}
  html[data-theme="system"] .secret-reveal{border-color:#455b34;background:#121a11}
  html[data-theme="system"] .secret-row code{background:#090b0a}
  html[data-theme="system"] .scope-tabs{background:var(--panel)}
  html[data-theme="system"] .mobile-navigation{background:rgba(17,21,18,.96)}
  html[data-theme="system"] .approval-page{background:radial-gradient(circle at 15% 10%,rgba(184,243,106,.07),transparent 26rem),var(--bg)}
  html[data-theme="system"] .success-mark{border-color:#3e6749;background:#132219}
  html[data-theme="system"] .table-row code{color:#c9d2cb}
  html[data-theme="system"] .modal::backdrop{background:rgba(0,0,0,.68)}
}
`;

export const dashboardStyles = `
${dashboardThemeStyles}
:root{color-scheme:dark;--bg:#090b0a;--chrome:#0d100e;--panel:#111512;--panel-raised:#161b17;--panel-hover:#1b211c;--line:#262d27;--line-strong:#39423a;--text:#eef3ef;--muted:#98a39b;--subtle:#6e7971;--accent:#b8f36a;--accent-strong:#98da4e;--accent-ink:#11160e;--danger:#ff8b82;--danger-bg:#2b1716;--warning:#f3c56a;--success:#86d9a2;--focus:#8fd7ff;--sidebar:236px;--topbar:64px;--radius:9px;--shadow:0 24px 70px rgba(0,0,0,.36);font-family:"SF Pro Text","Segoe UI Variable","Segoe UI",system-ui,sans-serif;font-synthesis:none}*{box-sizing:border-box}html{min-height:100%;background:var(--bg)}body{min-height:100vh;margin:0;background:var(--bg);color:var(--text);font-size:14px}a{color:inherit}button,input,select{font:inherit}button{cursor:pointer}button:disabled{cursor:not-allowed;opacity:.45}.dashboard-frame{min-height:100vh}.context-bar{position:sticky;top:0;z-index:20;display:grid;grid-template-columns:220px minmax(0,1fr) auto;align-items:center;height:var(--topbar);padding:0 18px;border-bottom:1px solid var(--line);background:rgba(13,16,14,.94);backdrop-filter:blur(16px)}.brand{display:inline-flex;align-items:center;gap:10px;width:max-content;font-size:14px;font-weight:740;letter-spacing:-.02em;text-decoration:none}.brand-mark{display:grid;width:30px;height:30px;place-items:center;border-radius:8px;background:var(--accent);color:var(--accent-ink);font-size:13px;font-weight:850}.context-spacer{min-width:1px}.context-actions{display:flex;align-items:center;gap:8px}.quiet-link{padding:8px 10px;border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none}.quiet-link:hover{background:var(--panel-hover);color:var(--text)}.team-switcher,.account-menu{position:relative}.team-switcher{margin-left:14px}.team-switcher>summary,.account-menu>summary{display:flex;align-items:center;gap:9px;list-style:none;cursor:pointer}.team-switcher>summary::-webkit-details-marker,.account-menu>summary::-webkit-details-marker{display:none}.team-switcher>summary{padding:7px 9px;border:1px solid transparent;border-radius:8px}.team-switcher>summary:hover,.team-switcher[open]>summary,.account-menu>summary:hover,.account-menu[open]>summary{border-color:var(--line);background:var(--panel)}.team-monogram{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:1px solid var(--line-strong);border-radius:7px;background:#202720;color:var(--accent);font:700 11px ui-monospace,SFMono-Regular,Menlo,monospace}.team-monogram.small{width:30px;height:30px}.team-current,.account-copy{display:grid;gap:1px;min-width:0}.team-current strong,.account-copy strong{max-width:190px;overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.team-current small,.account-copy small{max-width:210px;overflow:hidden;color:var(--subtle);font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.chevron{margin-left:3px;color:var(--subtle);font-size:14px}.role-badge,.status{display:inline-flex;align-items:center;width:max-content;padding:3px 7px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font:600 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.04em;text-transform:uppercase}.role-owner{color:var(--accent);border-color:#42572f;background:#182111}.role-admin{color:#a9c8ff;border-color:#33445c;background:#121a24}.role-member{color:var(--muted)}.switcher-menu,.account-popover{position:absolute;top:calc(100% + 9px);left:0;z-index:50;width:330px;padding:8px;border:1px solid var(--line-strong);border-radius:10px;background:#121613;box-shadow:var(--shadow)}.switcher-menu>p,.account-popover>p{margin:4px 8px 8px;color:var(--subtle);font-size:10px;letter-spacing:.08em;text-transform:uppercase}.switcher-menu>a{display:grid;grid-template-columns:auto minmax(0,1fr) auto;align-items:center;gap:10px;padding:9px;border-radius:7px;text-decoration:none}.switcher-menu>a:hover{background:var(--panel-hover)}.switcher-menu>a>span:nth-child(2){display:grid;min-width:0}.switcher-menu strong{overflow:hidden;font-size:12px;text-overflow:ellipsis;white-space:nowrap}.switcher-menu small{color:var(--subtle);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.account-menu>summary{padding:5px 7px;border:1px solid transparent;border-radius:8px}.avatar{display:grid;width:28px;height:28px;place-items:center;border-radius:50%;background:#283029;color:var(--text);font-size:11px;font-weight:800}.account-popover{left:auto;right:0;width:250px}.account-popover>strong{display:block;padding:0 8px 10px;overflow:hidden;font-size:12px;text-overflow:ellipsis}.account-popover>a,.account-popover button{display:flex;width:100%;padding:9px 8px;border:0;border-radius:7px;background:transparent;color:var(--text);font-size:12px;text-align:left;text-decoration:none}.account-popover>a:hover,.account-popover button:hover{background:var(--panel-hover)}.account-popover form{margin-top:6px;padding-top:6px;border-top:1px solid var(--line)}.top-navigation{position:sticky;top:var(--topbar);z-index:19;display:flex;align-items:center;gap:4px;height:48px;padding:0 24px;border-bottom:1px solid var(--line);background:var(--chrome)}.top-navigation a{position:relative;padding:14px 13px 12px;color:var(--muted);font-size:12px;text-decoration:none}.top-navigation a:hover{color:var(--text)}.top-navigation a[aria-current="page"]{color:var(--text)}.top-navigation a[aria-current="page"]::after{position:absolute;right:12px;bottom:-1px;left:12px;height:2px;background:var(--text);content:""}.dashboard-body{display:grid;grid-template-columns:var(--sidebar) minmax(0,1fr);min-height:calc(100vh - var(--topbar))}.layout-topnav .dashboard-body{grid-template-columns:1fr}.sidebar{position:sticky;top:var(--topbar);display:flex;flex-direction:column;height:calc(100vh - var(--topbar));padding:16px 12px;border-right:1px solid var(--line);background:#0b0e0c}.sidebar nav{display:grid;flex:1 1 auto;align-content:start;gap:3px;min-height:0;overflow-y:auto;overscroll-behavior:contain}.sidebar a{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none}.sidebar a:hover{background:var(--panel-hover);color:var(--text)}.sidebar a[aria-current="page"]{background:#1a201b;color:var(--text)}.nav-glyph{display:grid;width:22px;height:22px;place-items:center;border:1px solid var(--line);border-radius:5px;color:var(--subtle);font:700 8px ui-monospace,SFMono-Regular,Menlo,monospace}.sidebar a[aria-current="page"] .nav-glyph,.mobile-navigation a[aria-current="page"] .nav-glyph{border-color:#45543f;color:var(--accent)}.sidebar-foot{flex:0 0 auto;margin-top:auto;padding:10px 0 0;border-top:1px solid var(--line)}.sidebar-account{width:100%}.sidebar-account>summary{width:100%;padding:8px;border:1px solid transparent;border-radius:8px;text-align:left}.sidebar-account .account-copy{flex:1}.sidebar-account .account-popover{top:auto;bottom:calc(100% + 9px);left:0;right:auto;width:100%}.dashboard-main{width:100%;max-width:1500px;min-width:0;margin:0 auto;padding:38px clamp(22px,4vw,58px) 80px}.page-header{display:flex;align-items:flex-end;justify-content:space-between;gap:24px;margin-bottom:30px}.page-eyebrow,.section-label{margin:0 0 9px;color:var(--accent);font:700 10px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.1em;text-transform:uppercase}.page-header h1,.empty-dashboard h1,.approval-copy h1{margin:0;font-size:27px;font-weight:560;letter-spacing:-.045em;line-height:1.1}.page-description{max-width:680px;margin:9px 0 0;color:var(--muted);font-size:13px;line-height:1.55}.page-actions{display:flex;gap:8px;flex:0 0 auto}.button{display:inline-flex;align-items:center;justify-content:center;min-height:36px;padding:0 13px;border:1px solid var(--line-strong);border-radius:7px;background:var(--panel-raised);color:var(--text);font-size:12px;font-weight:680;text-decoration:none;transition:background .16s ease,border-color .16s ease,transform .16s ease}.button:hover{background:var(--panel-hover);border-color:#526056}.button:active{transform:translateY(1px)}.button.primary{border-color:var(--accent);background:var(--accent);color:var(--accent-ink)}.button.primary:hover{border-color:var(--accent-strong);background:var(--accent-strong)}.button:focus-visible,.icon-button:focus-visible,.danger-link:focus-visible,input:focus-visible,select:focus-visible,summary:focus-visible,a:focus-visible{outline:2px solid var(--focus);outline-offset:2px}.metric-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-bottom:20px}.metric{min-height:96px;padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.metric p{margin:0;color:var(--muted);font-size:11px}.metric strong{display:block;margin:10px 0 5px;font-size:22px;font-weight:620;letter-spacing:-.04em}.metric span{color:var(--subtle);font-size:10px}.slug-value code,.secret-row code{color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.content-section,.settings-section{margin-top:24px}.section-heading{display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:13px}.section-heading h2,.table-toolbar h2,.settings-section h2{margin:0;font-size:14px;font-weight:670;letter-spacing:-.02em}.section-heading p{margin:4px 0 0;color:var(--subtle);font-size:11px}.section-heading>a{color:var(--muted);font-size:11px;text-decoration:none}.section-heading>a:hover{color:var(--text)}.table-panel{overflow:hidden;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.table-toolbar{display:flex;align-items:center;justify-content:space-between;padding:13px 15px;border-bottom:1px solid var(--line)}.table-toolbar span{color:var(--subtle);font-size:10px}.data-table{display:grid}.table-row{display:grid;align-items:center;min-height:52px;padding:0 14px;border-bottom:1px solid var(--line);color:var(--muted);font-size:11px;text-decoration:none}.table-row:last-child{border-bottom:0}.table-row:hover:not(.table-head){background:#131814}.table-head{min-height:36px;background:#0e120f;color:var(--subtle);font-size:9px;letter-spacing:.06em;text-transform:uppercase}.artifact-table .table-row{grid-template-columns:minmax(240px,1.7fr) .55fr 1fr .4fr}.token-table .table-row{grid-template-columns:minmax(150px,1.2fr) minmax(160px,1.2fr) 1fr 1fr .55fr .45fr}.device-table .table-row{grid-template-columns:minmax(160px,1.2fr) minmax(160px,1.1fr) 1fr 1fr .6fr .45fr}.file-cell,.table-row>span:first-child{display:flex;align-items:center;gap:9px;min-width:0}.table-row>span{display:grid;gap:3px;min-width:0}.table-row strong{overflow:hidden;color:var(--text);font-size:11px;text-overflow:ellipsis;white-space:nowrap}.table-row small{overflow:hidden;color:var(--subtle);font-size:9px;text-overflow:ellipsis;white-space:nowrap}.table-row code{overflow:hidden;color:#c9d2cb;font:10px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.file-kind{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border:1px solid var(--line);border-radius:6px;color:var(--muted);font:700 8px ui-monospace,SFMono-Regular,Menlo,monospace;text-transform:uppercase}.file-kind.folder{border-color:#3c4b35;color:var(--accent);font-size:13px}.row-action{color:var(--muted);font-size:10px;text-decoration:none}.row-action:hover{color:var(--text)}.directory-panel{margin-bottom:12px}.directory-panel .table-row{grid-template-columns:32px minmax(0,1fr) auto}.empty-state{display:grid;place-items:center;min-height:250px;padding:40px;border:1px dashed var(--line-strong);border-radius:var(--radius);text-align:center}.empty-icon,.empty-mark{display:grid;width:38px;height:38px;place-items:center;border:1px solid var(--line-strong);border-radius:9px;color:var(--accent);font:700 15px ui-monospace,SFMono-Regular,Menlo,monospace}.empty-state h3{margin:14px 0 7px;font-size:14px}.empty-state p{max-width:430px;margin:0 0 18px;color:var(--muted);font-size:12px;line-height:1.55}.path-filter{display:grid;grid-template-columns:minmax(0,1fr) auto auto;align-items:end;gap:8px;margin-bottom:16px;padding:12px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.path-filter .field{margin:0}.breadcrumbs{display:flex;align-items:center;gap:6px;margin:-10px 0 18px;overflow:auto;color:var(--subtle);font-size:11px}.breadcrumbs>span{display:flex;align-items:center;gap:6px}.breadcrumbs a{color:var(--muted);text-decoration:none}.breadcrumbs a:hover{color:var(--text)}.pagination-next{display:flex;width:max-content;margin:16px 0 0 auto}.feedback{margin:0 0 16px;padding:11px 13px;border:1px solid var(--line);border-radius:8px;font-size:11px}.feedback.error{border-color:#5b2b28;background:var(--danger-bg);color:var(--danger)}.feedback.success{border-color:#31523c;background:#102016;color:#b8ebc8}.settings-grid{display:grid;grid-template-columns:minmax(0,1fr) 270px;gap:18px}.settings-main{display:grid;gap:18px}.settings-section{padding:18px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.slug-value{display:flex;align-items:center;gap:2px;margin:18px 0;padding:13px;border:1px solid var(--line);border-radius:8px;background:#0c0f0d;color:var(--subtle);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.slug-value code{font-size:12px}.base-url-row{display:flex;align-items:center;justify-content:space-between;gap:14px;margin:0 0 18px;padding:12px 13px;border:1px solid var(--line);border-radius:8px;background:#0c0f0d}.base-url-row>span{min-width:0}.base-url-row .section-label{display:block;margin:0 0 5px}.base-url-row code{color:var(--text);overflow-wrap:anywhere;font:12px ui-monospace,SFMono-Regular,Menlo,monospace}.slug-form{display:grid;max-width:520px;gap:12px;padding-top:16px;border-top:1px solid var(--line)}.field{display:grid;gap:7px}.field label,.field-label-row{font-size:11px;font-weight:660}.field p,.permission-note,.cooldown{margin:0;color:var(--subtle);font-size:10px;line-height:1.5}.cooldown{color:var(--warning)}.permission-note{padding:12px;border:1px solid var(--line);border-radius:7px;background:#0e120f}.field input,.field select{width:100%;height:40px;padding:0 11px;border:1px solid var(--line-strong);border-radius:7px;background:#0b0e0c;color:var(--text);outline:none}.field input:hover,.field select:hover{border-color:#526056}.history-list{display:grid;border-top:1px solid var(--line)}.history-list>div{display:flex;align-items:center;justify-content:space-between;gap:16px;padding:11px 0;border-bottom:1px solid var(--line);color:var(--subtle);font-size:10px}.history-list>div>span{display:flex;align-items:center;gap:8px}.history-list code{color:var(--text);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.status.current{color:var(--accent)}.status.redirect{color:var(--muted)}.status.active,.status.connected{color:var(--success)}.status.revoked,.status.expired{color:var(--danger)}.status.pending{color:var(--warning)}.settings-aside{align-self:start;padding:18px;border:1px solid var(--line);border-radius:var(--radius);background:#0e120f}.settings-aside h3{margin:0 0 8px;font-size:14px}.settings-aside>p:last-child{margin:0;color:var(--muted);font-size:11px;line-height:1.6}.secret-reveal{display:grid;grid-template-columns:minmax(220px,.6fr) minmax(0,1.4fr);gap:20px;align-items:center;margin-bottom:16px;padding:18px;border:1px solid #455b34;border-radius:var(--radius);background:#121a11}.secret-reveal h2{margin:0;font-size:14px}.secret-reveal p{margin:5px 0 0;color:var(--muted);font-size:11px}.secret-reveal>span{display:none}.secret-row{display:flex;gap:8px}.secret-row code{display:block;min-width:0;flex:1;padding:10px;overflow:hidden;border:1px solid var(--line-strong);border-radius:7px;background:#090b0a;font-size:10px;text-overflow:ellipsis;white-space:nowrap}.scope-tabs{display:flex;gap:3px;margin-bottom:14px;padding:3px;border:1px solid var(--line);border-radius:8px;background:var(--panel);width:max-content}.scope-tabs a{padding:7px 10px;border-radius:5px;color:var(--muted);font-size:11px;text-decoration:none}.scope-tabs a[aria-current="page"]{background:var(--panel-hover);color:var(--text)}.danger-link{padding:0;border:0;background:transparent;color:var(--danger);font-size:10px}.danger-link:hover{text-decoration:underline}.muted{color:var(--subtle)}.modal{width:min(480px,calc(100% - 28px));padding:0;border:1px solid var(--line-strong);border-radius:11px;background:#111512;color:var(--text);box-shadow:var(--shadow)}.modal::backdrop{background:rgba(0,0,0,.68);backdrop-filter:blur(3px)}.modal-head{display:flex;align-items:flex-start;justify-content:space-between;gap:16px;padding:18px;border-bottom:1px solid var(--line)}.modal-head h2{margin:0;font-size:18px;letter-spacing:-.03em}.icon-button{display:grid;width:30px;height:30px;place-items:center;border:1px solid var(--line);border-radius:7px;background:var(--panel-raised);color:var(--muted);font-size:18px}.modal-form{display:grid;gap:16px;padding:18px}.scope-preview{display:grid;grid-template-columns:60px minmax(0,1fr);gap:5px 10px;padding:12px;border:1px solid var(--line);border-radius:8px;background:#0d100e}.scope-preview span,.scope-preview small{color:var(--subtle);font-size:10px}.scope-preview code{grid-row:span 2;color:var(--text);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.modal-actions{display:flex;justify-content:flex-end;gap:8px}.mobile-navigation{display:none}.centered-page .dashboard-main{display:grid;min-height:calc(100vh - var(--topbar));place-items:center}.empty-dashboard{display:grid;max-width:520px;place-items:center;text-align:center}.empty-dashboard .empty-mark{margin-bottom:22px}.empty-dashboard>p:not(.page-eyebrow){margin:12px 0 22px;color:var(--muted);line-height:1.6}.approval-page{min-height:100vh;background:radial-gradient(circle at 15% 10%,rgba(184,243,106,.07),transparent 26rem),var(--bg)}.approval-header{display:flex;align-items:center;justify-content:space-between;height:64px;padding:0 24px;border-bottom:1px solid var(--line);color:var(--subtle);font-size:11px}.approval-main{display:grid;grid-template-columns:minmax(0,1fr) minmax(360px,.65fr);width:min(1080px,calc(100% - 40px));min-height:calc(100vh - 64px);margin:0 auto;align-items:center;gap:clamp(50px,8vw,110px);padding:60px 0}.approval-copy h1{max-width:620px;font-size:clamp(44px,6vw,72px);line-height:.98}.approval-copy>p:not(.page-eyebrow){max-width:560px;margin:22px 0 0;color:var(--muted);font-size:15px;line-height:1.65}.approval-copy code{color:var(--text);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.approval-copy ol{display:grid;gap:10px;margin:28px 0 0;padding-left:20px;color:var(--muted);font-size:12px}.approval-card{padding:26px;border:1px solid var(--line-strong);border-radius:12px;background:var(--panel);box-shadow:var(--shadow)}.approval-card .modal-form{border-top:0}.code-input{height:54px!important;font:700 22px ui-monospace,SFMono-Regular,Menlo,monospace!important;letter-spacing:.16em;text-align:center;text-transform:uppercase}.approval-success{display:grid;place-items:center;padding:30px 10px;text-align:center}.success-mark{display:grid;width:44px;height:44px;place-items:center;border:1px solid #3e6749;border-radius:50%;background:#132219;color:var(--success);font-size:19px}.approval-success h2{margin:16px 0 7px}.approval-success p{margin:0 0 20px;color:var(--muted);font-size:12px;line-height:1.55}@media(max-width:1100px){.metric-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.token-table .table-row,.device-table .table-row{grid-template-columns:minmax(180px,1.3fr) minmax(160px,1fr) 1fr .5fr}.token-table .table-row>*:nth-child(4),.device-table .table-row>*:nth-child(4),.token-table .table-row>*:nth-child(5),.device-table .table-row>*:nth-child(5){display:none}.settings-grid{grid-template-columns:1fr}.settings-aside{display:none}}@media(max-width:820px){:root{--topbar:58px}.context-bar{grid-template-columns:auto minmax(0,1fr) auto;padding:0 12px}.brand-name,.account-copy,.quiet-link,.context-actions>.quiet-link{display:none}.team-switcher{margin-left:4px}.team-switcher>summary{grid-template-columns:auto minmax(0,1fr) auto}.team-current small,.role-badge{display:none}.switcher-menu{position:fixed;top:66px;right:12px;left:12px;width:auto}.account-popover{top:54px}.dashboard-body{grid-template-columns:1fr}.sidebar{display:none}.top-navigation{top:var(--topbar);overflow:auto;padding:0 12px}.dashboard-main{padding:28px 16px 92px}.mobile-navigation{position:fixed;right:10px;bottom:10px;left:10px;z-index:30;display:grid;grid-template-columns:repeat(4,1fr);padding:5px;border:1px solid var(--line-strong);border-radius:11px;background:rgba(17,21,18,.96);box-shadow:var(--shadow);backdrop-filter:blur(16px)}.mobile-navigation a{display:grid;place-items:center;gap:3px;padding:7px 3px;border-radius:7px;color:var(--subtle);font-size:8px;text-decoration:none}.mobile-navigation a[aria-current="page"]{background:var(--panel-hover);color:var(--text)}.page-header{align-items:flex-start;flex-direction:column}.page-actions{width:100%}.page-actions .button{flex:1}.artifact-table .table-row{grid-template-columns:minmax(0,1fr) auto}.artifact-table .table-row>*:nth-child(2),.artifact-table .table-row>*:nth-child(3){display:none}.token-table .table-row,.device-table .table-row{grid-template-columns:minmax(0,1fr) auto}.token-table .table-row>*:not(:first-child):not(:last-child),.device-table .table-row>*:not(:first-child):not(:last-child){display:none}.table-panel{overflow:visible;border:0;background:transparent}.table-toolbar{padding:0 0 10px;border:0}.data-table{border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.table-row{padding:0 12px}.secret-reveal{grid-template-columns:1fr}.approval-main{grid-template-columns:1fr;width:min(560px,calc(100% - 28px));padding:38px 0}.approval-copy h1{font-size:44px}.approval-header{padding:0 14px}.approval-header>span{display:none}}@media(max-width:520px){.page-header h1{font-size:27px}.path-filter{grid-template-columns:1fr}.path-filter .button{width:100%}.metric-grid{grid-template-columns:1fr 1fr}.metric{min-height:88px;padding:14px}.metric strong{font-size:20px}.base-url-row{align-items:stretch;flex-direction:column}.base-url-row .button{width:100%}.section-heading{align-items:flex-start}.history-list>div{align-items:flex-start;flex-direction:column}.slug-value{align-items:flex-start;flex-direction:column}.secret-row{align-items:stretch;flex-direction:column}.secret-row .button{width:100%}.scope-tabs{width:100%}.scope-tabs a{flex:1;text-align:center}.approval-card{padding:20px}}@media(min-width:821px){.layout-sidebar .context-actions .account-menu{display:none}}@media(prefers-reduced-motion:reduce){*,*::before,*::after{scroll-behavior:auto!important;transition-duration:.01ms!important}}
.layout-account .dashboard-body{grid-template-columns:220px minmax(0,1fr)}.layout-account .dashboard-main{max-width:1200px}.account-sidebar{position:sticky;top:var(--topbar);display:flex;flex-direction:column;height:calc(100vh - var(--topbar));padding:16px 12px;border-right:1px solid var(--line);background:#0b0e0c}.account-sidebar-head{display:flex;align-items:center;min-height:32px;margin-bottom:13px}.account-back-link{display:flex;align-items:center;gap:8px;padding:8px 9px;border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none}.account-back-link:hover{background:var(--panel-hover);color:var(--text)}.account-sidebar-body{display:flex;flex:1 1 auto;flex-direction:column;min-height:0}.account-sidebar-title{margin:0;padding:0 9px 9px;color:var(--subtle);font:700 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase}.account-sidebar-nav{display:grid;align-content:start;gap:3px;overflow-y:auto;overscroll-behavior:contain}.account-sidebar-nav a{display:flex;align-items:center;gap:10px;padding:8px 9px;border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none}.account-sidebar-nav a:hover,.account-sidebar-nav a[aria-current="page"]{background:var(--panel-hover);color:var(--text)}.account-sidebar-nav a[aria-current="page"]{color:var(--text)}.account-sidebar-foot{flex:0 0 auto;margin-top:auto;padding:10px 0 0;border-top:1px solid var(--line)}.account-sidebar .sidebar-account{width:100%}.account-sidebar .sidebar-account>summary{width:100%;padding:8px;border:1px solid transparent;border-radius:8px;text-align:left}.account-sidebar .sidebar-account .account-copy{flex:1}.account-sidebar .sidebar-account .account-popover{top:auto;bottom:calc(100% + 9px);left:0;right:auto;width:100%}.account-popover-head{display:flex;align-items:flex-start;justify-content:space-between;gap:10px;padding:4px 4px 10px}.account-popover-identity{display:flex;align-items:center;gap:9px;min-width:0}.account-popover-identity .account-copy{min-width:0}.account-settings-link{display:grid;width:28px;height:28px;flex:0 0 auto;place-items:center;border-radius:7px;color:var(--muted);text-decoration:none}.account-settings-link:hover,.account-settings-link:focus-visible{background:var(--panel-hover);color:var(--text)}.account-menu-separator{height:1px;background:var(--line)}.account-menu-list{display:grid;gap:2px;padding-top:5px}.account-menu-item{display:flex;align-items:center;justify-content:space-between;gap:9px;width:100%;min-height:34px;padding:8px;border:0;border-radius:6px;background:transparent;color:var(--text);font-size:11px;text-align:left;text-decoration:none}.account-menu-item:hover,.account-menu-item:focus-visible{background:var(--panel-hover);color:var(--text)}.account-menu-form{margin:0}.account-menu-form .account-menu-item{cursor:pointer}.account-menu-icon{display:block;width:15px;height:15px;flex:0 0 auto;color:var(--muted)}.account-menu-item>span{min-width:0}.account-menu-theme{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:4px 8px!important;border-top:0}.account-menu-theme .theme-picker-options{width:96px;flex:0 0 auto;gap:2px;padding:0}.account-menu-theme .theme-picker-options button{display:flex;align-items:center;justify-content:center;min-height:30px;padding:0;border-radius:6px}.account-menu-theme .theme-picker-options button[aria-pressed="true"]{border-color:var(--line-strong);background:var(--panel-hover);color:var(--text)}.theme-choice-label{display:inline-flex;align-items:center;gap:5px}.theme-picker-compact-label{color:var(--muted);font-size:11px}.account-mobile-back{display:none}.account-sidebar .account-menu-icon{width:15px;height:15px}.account-sidebar-nav .account-menu-icon{color:var(--subtle)}.account-sidebar-nav a[aria-current="page"] .account-menu-icon{color:var(--accent)}html[data-theme="light"] .account-sidebar,html[data-theme="system"] .account-sidebar{background:#eef3ed}html[data-theme="light"] .account-sidebar-nav a[aria-current="page"],html[data-theme="system"] .account-sidebar-nav a[aria-current="page"]{background:#e1ebdf}@media(prefers-color-scheme:dark){html[data-theme="system"] .account-sidebar{background:#0b0e0c}html[data-theme="system"] .account-sidebar-nav a[aria-current="page"]{background:#1a201b}}@media(max-width:820px){.layout-account .dashboard-body{grid-template-columns:1fr}.account-sidebar{display:none}.layout-account .dashboard-main{padding:28px 16px 92px}.account-mobile-back{display:flex;align-items:center;gap:8px;margin:0 0 18px;padding:8px 9px;border-radius:7px;color:var(--muted);font-size:12px;text-decoration:none}.account-mobile-back:hover{background:var(--panel-hover);color:var(--text)}}@media(min-width:821px){.layout-account .context-actions .account-menu{display:none}}

.overview-grid{display:grid;grid-template-columns:300px minmax(0,1fr);gap:18px;align-items:start;margin-bottom:20px}.overview-side{display:grid;gap:14px}.side-panel{padding:16px;border:1px solid var(--line);border-radius:var(--radius);background:var(--panel)}.side-panel h2{margin:0 0 4px;font-size:13px;font-weight:670;letter-spacing:-.02em}.summary-rows{display:grid;margin:4px 0 0}.summary-row{display:flex;align-items:center;justify-content:space-between;gap:10px;padding:11px 0;border-bottom:1px solid var(--line);color:var(--muted);font-size:12px;text-decoration:none}.summary-row:last-child{border-bottom:0}.summary-row:hover{color:var(--text)}.summary-row strong{color:var(--text);font-size:15px;font-weight:680;letter-spacing:-.02em}.quick-actions{display:grid;gap:8px;margin-top:8px}.table-section{grid-column:1/-1;min-height:0;padding:11px 14px 7px;color:var(--subtle);font:600 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.09em;text-transform:uppercase}.table-section:not(:first-child){border-top:1px solid var(--line)}.row-actions{display:flex;align-items:center;gap:12px}.row-actions form{display:contents}.row-actions button{padding:0;border:0;background:transparent}.chip-row{display:flex;flex-wrap:wrap;gap:4px;min-width:0}.chip{display:inline-flex;max-width:120px;padding:3px 8px;border:1px solid var(--line);border-radius:999px;color:var(--muted);font-size:9px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.pin-mark{color:var(--warning);font-size:10px}.project-checks{display:grid;gap:8px;padding:15px}.project-checks label{display:flex;align-items:center;gap:10px;padding:10px 12px;border:1px solid var(--line);border-radius:7px;font-size:12px;color:var(--text);cursor:pointer}.project-checks label:hover{background:var(--panel-hover)}.project-checks input[type=checkbox]{width:15px;height:15px;accent-color:var(--accent)}.project-form-actions{display:flex;justify-content:flex-end;margin-top:4px}.project-panel{overflow:visible}@media (max-width:900px){.overview-grid{grid-template-columns:1fr}.overview-main{order:1}.overview-side{order:2}}`;

export const artifactShareStyles = `
.share-control{position:relative;display:inline-block;min-width:0}.share-control>summary{display:flex;align-items:center;gap:6px;list-style:none;cursor:pointer;color:var(--muted);font-size:10px}.share-control>summary::-webkit-details-marker{display:none}.share-control>summary:hover,.share-control[open]>summary{color:var(--text)}.share-control-compact .status{max-width:106px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.share-popover{position:absolute;right:0;z-index:40;width:min(390px,calc(100vw - 34px));margin-top:9px;padding:14px;border:1px solid var(--line-strong);border-radius:10px;background:var(--panel);box-shadow:var(--shadow)}.share-popover .share-explanation{margin:0 0 12px;color:var(--muted);font-size:10px;line-height:1.55}.share-explanation code{color:var(--text);font:10px ui-monospace,SFMono-Regular,Menlo,monospace}.share-choices{display:grid;gap:7px}.share-choice{display:grid;gap:4px;width:100%;padding:10px;border:1px solid var(--line);border-radius:7px;background:var(--panel);color:var(--text);text-align:left}.share-choice:hover:not(:disabled),.share-choice.selected{border-color:var(--accent);background:var(--panel-hover)}.share-choice strong{font-size:11px}.share-choice small{color:var(--subtle);font-size:9px;line-height:1.4}.share-link{display:flex;align-items:center;gap:7px;margin-top:11px;padding-top:11px;border-top:1px solid var(--line)}.share-link code{min-width:0;flex:1;overflow:hidden;color:var(--text);font:9px ui-monospace,SFMono-Regular,Menlo,monospace;text-overflow:ellipsis;white-space:nowrap}.share-link .button{min-height:30px;padding:0 9px;font-size:10px}.share-popover>form:last-child{margin-top:10px;padding-top:10px;border-top:1px solid var(--line)}.share-popover>.permission-note{margin-top:11px}.status.private{color:var(--muted)}.share-panel{overflow:visible;padding:14px}.share-panel .share-control{display:block}.share-panel .share-control>summary{justify-content:space-between;padding:5px 0}.share-panel .share-popover{position:static;width:auto;margin-top:12px;padding:0;border:0;box-shadow:none;background:transparent}.share-panel .share-control>summary{pointer-events:none}.share-panel .share-control[open]>summary{color:var(--text)}
.artifact-directory-panel{overflow:visible}.row-actions{position:relative;display:flex;align-items:center;justify-content:flex-end;min-width:0}.row-action-menu{position:relative;display:block}.row-action-trigger{width:30px;height:30px;padding:0;font-size:18px;line-height:1}.row-action-trigger::-webkit-details-marker{display:none}.row-action-menu>summary{list-style:none}.row-action-menu>summary:hover,.row-action-menu[open]>summary{border-color:var(--line-strong);background:var(--panel-hover);color:var(--text)}.row-menu{position:absolute;top:calc(100% + 7px);right:0;z-index:60;display:grid;width:min(230px,calc(100vw - 24px));max-height:min(420px,calc(100vh - 24px));overflow:auto;padding:5px;border:1px solid var(--line-strong);border-radius:9px;background:var(--panel);box-shadow:var(--shadow)}.row-menu-item{display:flex;align-items:center;gap:9px;width:100%;min-height:34px;padding:8px;border:0;border-radius:6px;background:transparent;color:var(--text);font-size:11px;text-align:left;text-decoration:none}.row-menu-item:hover,.row-menu-item:focus-visible{background:var(--panel-hover);color:var(--text)}.row-menu-item .status{margin-left:auto;max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.row-menu-form{margin:0}.row-menu-icon{display:block;width:16px;height:16px;flex:0 0 auto;color:var(--muted)}.row-menu-trigger-icon{display:block;width:16px;height:16px}.share-dialog{width:min(520px,calc(100% - 28px));max-height:calc(100dvh - 28px);overflow:auto}.share-dialog .share-popover{position:static;width:auto;margin:0;padding:18px;border:0;box-shadow:none;background:transparent}
.row-actions .row-menu-item{padding:8px;border:0;background:transparent}.row-actions .row-menu-form{display:block;margin:0}.project-table .table-row{display:grid;grid-template-columns:minmax(220px,1.6fr) minmax(90px,.65fr) minmax(150px,1fr) auto}.project-table .table-row>span:last-child{display:flex;align-items:center;justify-content:flex-end}.project-cell-label{display:none}.project-delete{display:inline-flex;align-items:center;justify-content:flex-end;gap:6px}.project-action-icon{display:block;width:14px;height:14px;flex:0 0 auto}@media(max-width:820px){.project-table .table-row{grid-template-columns:minmax(0,1fr) auto;grid-template-areas:"project action" "artifacts created";row-gap:4px;padding:10px 12px}.project-table .table-row>*:first-child{grid-area:project}.project-table .table-row>*:nth-child(2){display:flex;grid-area:artifacts;align-items:baseline;gap:5px}.project-table .table-row>*:nth-child(3){display:flex;grid-area:created;align-items:baseline;justify-content:flex-end;gap:5px}.project-table .table-row>*:last-child{grid-area:action}.project-cell-label{display:inline;color:var(--subtle);font:600 9px ui-monospace,SFMono-Regular,Menlo,monospace;letter-spacing:.05em;text-transform:uppercase}}
.share-panel .share-control>summary{pointer-events:auto}
`;

export const dashboardScript = `
(() => {
  try {
    if (document.cookie.indexOf("tz=") === -1) {
      const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
      if (zone) {
        document.cookie = "tz=" + encodeURIComponent(zone) + "; path=/; max-age=31536000; SameSite=Lax";
        const reloadKey = "artifact-sync-tz-reloaded";
        if (document.cookie.indexOf("tz=") !== -1 && !sessionStorage.getItem(reloadKey)) {
          sessionStorage.setItem(reloadKey, "1");
          location.reload();
        }
      }
    }
  } catch (error) {}

  const all = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  const root = document.documentElement;
  const themeValues = new Set(["system", "light", "dark"]);
  const themeMedia = window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null;
  const readCookie = (name) => {
    const prefix = name + "=";
    const value = document.cookie.split(";").map((part) => part.trim()).find((part) => part.startsWith(prefix));
    if (!value) return null;
    try { return decodeURIComponent(value.slice(prefix.length)); } catch { return value.slice(prefix.length); }
  };
  const writePreferenceCookie = (name, value) => {
    document.cookie = name + "=" + encodeURIComponent(value) + "; path=/; max-age=${PREFERENCE_MAX_AGE}; SameSite=Lax";
  };
  const resolveTheme = (preference) => preference === "system" ? (themeMedia?.matches ? "dark" : "light") : preference;
  const themeColors = { light: "#f5f8f3", dark: "#090b0a" };
  const syncThemeMetadata = (preference, resolved) => {
    const colorScheme = document.querySelector('meta[name="color-scheme"]');
    const activeColor = document.querySelector('[data-theme-color="active"]');
    const lightColor = document.querySelector('[data-theme-color="system-light"]');
    const darkColor = document.querySelector('[data-theme-color="system-dark"]');
    if (colorScheme) colorScheme.setAttribute("content", preference === "system" ? "light dark" : preference);
    if (activeColor) {
      activeColor.setAttribute("content", themeColors[resolved]);
      if (preference === "system") activeColor.setAttribute("media", "not all");
      else activeColor.removeAttribute("media");
    }
    if (lightColor) lightColor.setAttribute("media", preference === "system" ? "(prefers-color-scheme: light)" : "not all");
    if (darkColor) darkColor.setAttribute("media", preference === "system" ? "(prefers-color-scheme: dark)" : "not all");
  };
  const applyTheme = (preference, persist = false) => {
    const selected = themeValues.has(preference) ? preference : "system";
    const resolved = resolveTheme(selected);
    root.dataset.theme = selected;
    root.dataset.themeState = resolved;
    syncThemeMetadata(selected, resolved);
    all("[data-theme-choice]").forEach((button) => {
      button.setAttribute("aria-pressed", button.getAttribute("data-theme-choice") === selected ? "true" : "false");
    });
    if (persist) writePreferenceCookie("${THEME_COOKIE}", selected);
  };
  const storedTheme = readCookie("${THEME_COOKIE}");
  applyTheme(themeValues.has(storedTheme) ? storedTheme : (root.dataset.theme || "system"));
  all("[data-theme-choice]").forEach((button) => {
    button.addEventListener("click", () => applyTheme(button.getAttribute("data-theme-choice"), true));
  });
  if (themeMedia) {
    const syncSystemTheme = () => {
      if (root.dataset.theme === "system") applyTheme("system");
    };
    if (typeof themeMedia.addEventListener === "function") themeMedia.addEventListener("change", syncSystemTheme);
    else if (typeof themeMedia.addListener === "function") themeMedia.addListener(syncSystemTheme);
  }

  const sidebar = document.querySelector(".sidebar");
  const sidebarToggle = document.querySelector("[data-sidebar-toggle]");
  const resizeHandle = document.querySelector("[data-sidebar-resize]");
  const sidebarBounds = { rail: 64, min: 140, max: 320 };
  let sidebarWidth = Number(root.getAttribute("data-sidebar-width")) || 236;
  let sidebarLastExpanded = Number(root.getAttribute("data-sidebar-last-expanded")) || 236;
  let sidebarCollapsed = root.getAttribute("data-sidebar-collapsed") === "true";
  let sidebarDragging = false;
  const clampSidebar = (value) => Math.min(sidebarBounds.max, Math.max(sidebarBounds.min, Math.round(value)));
  const syncSidebarCookie = () => {
    const width = sidebarCollapsed ? sidebarBounds.rail : clampSidebar(sidebarWidth);
    writePreferenceCookie("${SIDEBAR_COOKIE}", "v1.c" + (sidebarCollapsed ? "1" : "0") + ".w" + width + ".e" + sidebarLastExpanded);
  };
  const syncSidebarMarkup = () => {
    root.setAttribute("data-sidebar-width", String(sidebarCollapsed ? sidebarBounds.rail : sidebarWidth));
    root.setAttribute("data-sidebar-last-expanded", String(sidebarLastExpanded));
    root.setAttribute("data-sidebar-collapsed", sidebarCollapsed ? "true" : "false");
    root.setAttribute("data-sidebar-dragging", sidebarDragging ? "true" : "false");
    sidebar?.classList.toggle("is-collapsed", sidebarCollapsed);
    sidebar?.setAttribute("data-sidebar-collapsed", sidebarCollapsed ? "true" : "false");
    if (sidebarToggle) {
      sidebarToggle.setAttribute("aria-expanded", sidebarCollapsed ? "false" : "true");
      sidebarToggle.setAttribute("aria-label", sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
      sidebarToggle.setAttribute("title", sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar");
      sidebarToggle.textContent = sidebarCollapsed ? "→" : "←";
    }
    if (resizeHandle) {
      resizeHandle.setAttribute("aria-expanded", sidebarCollapsed ? "false" : "true");
      resizeHandle.setAttribute("aria-valuenow", String(sidebarCollapsed ? sidebarLastExpanded : sidebarWidth));
      resizeHandle.setAttribute("aria-valuetext", sidebarCollapsed ? "Collapsed" : sidebarWidth + " pixels");
    }
  };
  const setSidebar = ({ collapsed = sidebarCollapsed, width = sidebarWidth, lastExpanded = sidebarLastExpanded, persist = true, dragging = false } = {}) => {
    sidebarCollapsed = Boolean(collapsed);
    sidebarLastExpanded = clampSidebar(lastExpanded);
    sidebarWidth = sidebarCollapsed ? sidebarBounds.rail : clampSidebar(width);
    if (!sidebarCollapsed) sidebarLastExpanded = sidebarWidth;
    sidebarDragging = dragging;
    sidebar?.classList.toggle("is-dragging", dragging);
    syncSidebarMarkup();
    if (persist) syncSidebarCookie();
  };
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener("click", () => {
      if (sidebarCollapsed) setSidebar({ collapsed: false, width: sidebarLastExpanded });
      else setSidebar({ collapsed: true, width: sidebarWidth, lastExpanded: sidebarWidth });
    });
  }
  if (resizeHandle && sidebar) {
    const finishDrag = () => {
      if (!sidebarDragging) return;
      const pointerId = resizeHandle.getAttribute("data-pointer-id");
      sidebarDragging = false;
      sidebar.classList.remove("is-dragging");
      if (pointerId !== null && resizeHandle.hasPointerCapture?.(Number(pointerId))) resizeHandle.releasePointerCapture(Number(pointerId));
      setSidebar({ collapsed: false, width: sidebarWidth, lastExpanded: sidebarWidth, persist: true, dragging: false });
      resizeHandle.removeAttribute("data-pointer-id");
    };
    resizeHandle.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      event.preventDefault();
      sidebarDragging = true;
      sidebar.classList.add("is-dragging");
      root.setAttribute("data-sidebar-dragging", "true");
      resizeHandle.setAttribute("data-pointer-id", String(event.pointerId));
      resizeHandle.setPointerCapture?.(event.pointerId);
      if (sidebarCollapsed) setSidebar({ collapsed: false, width: sidebarLastExpanded, persist: false, dragging: true });
    });
    resizeHandle.addEventListener("pointermove", (event) => {
      if (!sidebarDragging) return;
      setSidebar({ collapsed: false, width: event.clientX, persist: false, dragging: true });
    });
    resizeHandle.addEventListener("pointerup", finishDrag);
    resizeHandle.addEventListener("pointercancel", finishDrag);
    resizeHandle.addEventListener("lostpointercapture", finishDrag);
    resizeHandle.addEventListener("keydown", (event) => {
      const step = event.shiftKey ? 32 : 16;
      if (event.key === "Home") {
        event.preventDefault();
        setSidebar({ collapsed: true, width: sidebarWidth, lastExpanded: sidebarCollapsed ? sidebarLastExpanded : sidebarWidth });
      } else if (event.key === "End") {
        event.preventDefault();
        setSidebar({ collapsed: false, width: sidebarBounds.max });
      } else if (["ArrowLeft", "ArrowDown"].includes(event.key)) {
        event.preventDefault();
        setSidebar({ collapsed: false, width: (sidebarCollapsed ? sidebarLastExpanded : sidebarWidth) - step });
      } else if (["ArrowRight", "ArrowUp"].includes(event.key)) {
        event.preventDefault();
        setSidebar({ collapsed: false, width: (sidebarCollapsed ? sidebarLastExpanded : sidebarWidth) + step });
      } else if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        if (sidebarCollapsed) setSidebar({ collapsed: false, width: sidebarLastExpanded });
        else setSidebar({ collapsed: true, width: sidebarWidth, lastExpanded: sidebarWidth });
      }
    });
    syncSidebarMarkup();
  }

  const dialogTriggers = new WeakMap();
  const dialogs = {
    createToken: document.querySelector("#create-token"),
  };

  const mobileDialog = document.querySelector("[data-mobile-nav-dialog]");
  const mobileOpeners = all("[data-mobile-nav-open]");
  let mobileTrigger = null;
  const mobileFocusable = () => mobileDialog ? all('a[href],button:not([disabled]),[tabindex]:not([tabindex="-1"])', mobileDialog) : [];
  const restoreMobileTrigger = () => {
    if (mobileTrigger) mobileTrigger.setAttribute("aria-expanded", "false");
    if (mobileTrigger && typeof mobileTrigger.focus === "function") mobileTrigger.focus();
    mobileTrigger = null;
  };
  const closeMobileDialog = (restore = true) => {
    if (!(mobileDialog instanceof HTMLDialogElement)) return;
    if (mobileDialog.open) mobileDialog.close();
    if (restore) restoreMobileTrigger();
  };
  if (mobileDialog instanceof HTMLDialogElement) {
    mobileOpeners.forEach((button) => {
      button.addEventListener("click", () => {
        mobileTrigger = button;
        button.setAttribute("aria-expanded", "true");
        if (mobileDialog.open) return;
        mobileDialog.showModal();
        const first = mobileFocusable()[0];
        if (first) window.requestAnimationFrame(() => first.focus());
      });
    });
    mobileDialog.addEventListener("cancel", (event) => {
      event.preventDefault();
      closeMobileDialog();
    });
    mobileDialog.addEventListener("close", restoreMobileTrigger);
    mobileDialog.addEventListener("click", (event) => {
      if (event.target === mobileDialog) closeMobileDialog();
      if (event.target instanceof Element && event.target.closest("a[href]")) closeMobileDialog(false);
    });
    mobileDialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab") return;
      const focusable = mobileFocusable();
      if (!focusable.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    });
  }
  all("[data-mobile-nav-close]").forEach((button) => button.addEventListener("click", () => closeMobileDialog()));

  all("[data-dialog-open]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.getAttribute("data-dialog-open");
      const dialog = id ? document.querySelector("#" + id) : null;
      if (!(dialog instanceof HTMLDialogElement)) return;
      const rowMenu = button.closest("[data-row-menu]");
      if (rowMenu instanceof HTMLDetailsElement) rowMenu.removeAttribute("open");
      dialogTriggers.set(dialog, rowMenu?.querySelector("summary") ?? button);
      if (!dialog.open) dialog.showModal();
    });
  });
  all("[data-dialog-close]").forEach((button) => {
    button.addEventListener("click", () => button.closest("dialog")?.close());
  });
  all("dialog").forEach((dialog) => {
    dialog.addEventListener("click", (event) => {
      if (event.target === dialog) dialog.close();
    });
    dialog.addEventListener("close", () => {
      const trigger = dialogTriggers.get(dialog);
      if (trigger instanceof HTMLElement && document.contains(trigger)) trigger.focus();
    });
  });

  const copyText = async (value) => {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(value);
      return;
    }
    const textarea = document.createElement("textarea");
    textarea.value = value;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.append(textarea);
    textarea.select();
    document.execCommand("copy");
    textarea.remove();
  };

  all("[data-copy-target]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.getAttribute("data-copy-target");
      const target = id ? document.getElementById(id) : null;
      if (!target?.textContent) return;
      const original = button.textContent;
      try {
        await copyText(target.textContent.trim());
        button.textContent = "Copied";
      } catch {
        button.textContent = "Copy failed";
      }
      window.setTimeout(() => { button.textContent = original; }, 1600);
    });
  });

  all("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const message = form.getAttribute("data-confirm");
      if (message && !window.confirm(message)) event.preventDefault();
    });
  });

  all("[data-refresh]").forEach((button) => {
    button.addEventListener("click", () => location.reload());
  });

  const rowMenus = all("details[data-row-menu]");
  const closeDetails = (details, restoreFocus) => {
    if (!details.open) return;
    details.removeAttribute("open");
    if (restoreFocus) details.querySelector("summary")?.focus();
  };
  all("details").forEach((details) => {
    const summary = details.querySelector("summary");
    const syncExpanded = () => {
      if (summary) summary.setAttribute("aria-expanded", details.open ? "true" : "false");
    };
    details.addEventListener("toggle", () => {
      syncExpanded();
      if (details.open && details.matches("[data-row-menu]")) {
        rowMenus.forEach((other) => {
          if (other !== details) closeDetails(other, false);
        });
      }
    });
    details.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !details.open) return;
      closeDetails(details, true);
    });
    syncExpanded();
    document.addEventListener("click", (event) => {
      if (!details.open || details.contains(event.target)) return;
      const clickedRowMenu = event.target instanceof Element && event.target.closest("[data-row-menu]");
      closeDetails(details, details.matches("[data-row-menu]") && !clickedRowMenu);
    });
  });

  if (dialogs.createToken instanceof HTMLDialogElement && new URLSearchParams(location.search).has("created")) {
    dialogs.createToken.close();
  }
})();
`;
