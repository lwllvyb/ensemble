#!/usr/bin/env python3
"""
Generate a self-contained HTML replay of an ensemble collab session.
Features two themes: mIRC (default) and Modern, with a toggle button.
Usage: python3 generate-replay.py <team-id> [--task "desc"] [--output replay.html]
"""

import json
import os
import sys
import html
import re
from datetime import datetime


def load_messages(team_id):
    path = f"/tmp/ensemble/{team_id}/messages.jsonl"
    if not os.path.isfile(path):
        print(f"Error: {path} not found", file=sys.stderr)
        sys.exit(1)
    msgs = []
    with open(path) as f:
        for line in f:
            if line.strip():
                try:
                    msgs.append(json.loads(line))
                except json.JSONDecodeError:
                    pass
    return msgs


NICK_COLORS_MODERN = {
    "codex": {"bg": "#1e3a5f", "text": "#60a5fa", "badge": "#2563eb", "icon": "◆"},
    "claude": {"bg": "#1a3328", "text": "#4ade80", "badge": "#16a34a", "icon": "●"},
    "gemini": {"bg": "#3b2e1a", "text": "#fbbf24", "badge": "#d97706", "icon": "★"},
    "glm": {"bg": "#2d1a3b", "text": "#c084fc", "badge": "#9333ea", "icon": "◈"},
    "grok": {"bg": "#2f2f2f", "text": "#e5e5e5", "badge": "#525252", "icon": "✕"},
    "opencode": {"bg": "#12363b", "text": "#22d3ee", "badge": "#0891b2", "icon": "▣"},
}

NICK_COLORS_IRC = {
    "codex": "#0000CC",
    "claude": "#009300",
    "gemini": "#CC8800",
    "glm": "#8800CC",
    "grok": "#666666",
    "opencode": "#00AACC",
}


def get_modern_style(name):
    for key, style in NICK_COLORS_MODERN.items():
        if key in name.lower():
            return style
    return {"bg": "#1a1a2e", "text": "#94a3b8", "badge": "#475569", "icon": "○"}


def get_irc_color(name):
    for key, color in NICK_COLORS_IRC.items():
        if key in name.lower():
            return color
    return "#CC0000"


def format_content_modern(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<strong>\1</strong>', text)
    text = re.sub(r'```(\w*)\n(.*?)```', r'<pre><code>\2</code></pre>', text, flags=re.DOTALL)
    text = re.sub(r'`([^`]+)`', r'<code class="inline">\1</code>', text)
    text = text.replace('\n', '<br>')
    text = re.sub(r'\[(CRITICAL)\]', r'<span class="sev-critical">[\1]</span>', text)
    text = re.sub(r'\[(HIGH)\]', r'<span class="sev-high">[\1]</span>', text)
    text = re.sub(r'\[(MEDIUM)\]', r'<span class="sev-medium">[\1]</span>', text)
    text = re.sub(r'\[(LOW)\]', r'<span class="sev-low">[\1]</span>', text)
    text = re.sub(r'\[(INFO)\]', r'<span class="sev-info">[\1]</span>', text)
    return text


def format_content_irc(text):
    text = html.escape(text)
    text = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', text)
    text = re.sub(r'\[(CRITICAL)\]', r'<span class="sev-critical">[\1]</span>', text)
    text = re.sub(r'\[(HIGH)\]', r'<span class="sev-high">[\1]</span>', text)
    text = re.sub(r'\[(MEDIUM)\]', r'<span class="sev-medium">[\1]</span>', text)
    text = re.sub(r'\[(LOW)\]', r'<span class="sev-low">[\1]</span>', text)
    text = re.sub(r'\[(INFO)\]', r'<span class="sev-info">[\1]</span>', text)
    text = text.replace('\n', '<br>')
    return text


def service_level(content):
    if "❌" in content or re.search(r"Watchdog marked .+ as stalled", content):
        return "red"
    if "Watchdog" in content:
        return "yellow"
    if re.search(r"\bagents received their task\b", content):
        return "green"
    return "gray"


def generate_html(msgs, team_id, task):
    agents = {}
    first_ts = ""
    last_ts = ""

    for m in msgs:
        sender = m.get("from", "")
        if sender and sender != "ensemble":
            if sender not in agents:
                agents[sender] = {"count": 0}
            agents[sender]["count"] += 1
        if not first_ts and m.get("timestamp"):
            first_ts = m["timestamp"]
        if m.get("timestamp"):
            last_ts = m["timestamp"]

    total_msgs = sum(a["count"] for a in agents.values())
    channel = "#ensemble-collab"

    duration = ""
    if first_ts and last_ts:
        try:
            t1 = datetime.fromisoformat(first_ts.replace("Z", "+00:00"))
            t2 = datetime.fromisoformat(last_ts.replace("Z", "+00:00"))
            secs = int((t2 - t1).total_seconds())
            mins = secs // 60
            duration = f"{mins}m {secs % 60}s" if mins else f"{secs}s"
        except Exception:
            pass

    # --- Build IRC messages ---
    irc_html = ""
    first_agent = list(agents.keys())[0] if agents else ""
    for name in agents:
        color = get_irc_color(name)
        irc_html += f'<div class="line join">* <span style="color:{color};font-weight:bold">{html.escape(name)}</span> has joined {channel}</div>\n'
    irc_html += f'<div class="line topic">* Topic for {channel}: {html.escape(task[:200])}</div>\n'
    irc_html += '<div class="line separator">—————————————————————————————————</div>\n'

    for m in msgs:
        sender = m.get("from", "unknown")
        content = m.get("content", "")
        ts = m.get("timestamp", "")
        time_str = ""
        if ts:
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                time_str = t.strftime("%H:%M")
            except Exception:
                pass
        if sender == "ensemble":
            level = service_level(content)
            irc_html += f'<div class="line service service-{level}"><span class="time">[{time_str}]</span> <span class="service-sender">ensemble:</span> {format_content_irc(content)}</div>\n'
        else:
            color = get_irc_color(sender)
            formatted = format_content_irc(content)
            irc_html += f'<div class="line msg"><span class="time">[{time_str}]</span> <span style="color:{color};font-weight:bold">&lt;{html.escape(sender)}&gt;</span> {formatted}</div>\n'

    for name in agents:
        color = get_irc_color(name)
        irc_html += f'<div class="line part">* <span style="color:{color};font-weight:bold">{html.escape(name)}</span> has left {channel} (audit complete)</div>\n'

    # IRC nicklist
    irc_nicklist = ""
    for i, name in enumerate(agents):
        color = get_irc_color(name)
        prefix = "@" if i == 0 else "+"
        irc_nicklist += f'<div class="nick" style="color:{color}">{prefix}{html.escape(name)}</div>\n'

    # --- Build Modern messages ---
    modern_html = ""
    agent_badges = ""
    for name, info in agents.items():
        s = get_modern_style(name)
        agent_badges += f'<span class="agent-badge" style="background:{s["badge"]}">{s["icon"]} {html.escape(name)} <span class="badge-count">{info["count"]}</span></span>\n'

    for m in msgs:
        sender = m.get("from", "unknown")
        content = m.get("content", "")
        ts = m.get("timestamp", "")
        time_str = ""
        if ts:
            try:
                t = datetime.fromisoformat(ts.replace("Z", "+00:00"))
                time_str = t.strftime("%H:%M:%S")
            except Exception:
                pass
        if sender == "ensemble":
            level = service_level(content)
            modern_html += f'''<div class="m-message m-service service-{level}">
            <div class="m-header"><span class="m-name">ensemble</span><span class="m-time">{time_str}</span></div>
            <div class="m-body">{format_content_modern(content)}</div>
        </div>\n'''
            continue
        style = get_modern_style(sender)
        formatted = format_content_modern(content)
        modern_html += f'''<div class="m-message" style="--agent-bg:{style['bg']};--agent-text:{style['text']}">
            <div class="m-header"><span class="m-name" style="color:{style['text']}">{style['icon']} {html.escape(sender)}</span><span class="m-time">{time_str}</span></div>
            <div class="m-body">{formatted}</div>
        </div>\n'''

    return f'''<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ensemble replay — {html.escape(task[:60])}</title>
<style>
@import url('https://fonts.googleapis.com/css2?family=Fira+Code:wght@400;500&display=swap');
* {{ margin:0; padding:0; box-sizing:border-box; }}

/* ===== THEME SWITCH ===== */
body {{ font-size:13px; transition: background 0.3s; }}
body.irc {{ background:#008080; font-family:'Segoe UI',Tahoma,sans-serif; display:flex; justify-content:center; align-items:center; min-height:100vh; padding:20px; }}
body.modern {{ background:#0a0a0f; font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',system-ui,sans-serif; }}

#irc-view {{ display:none; }}
#modern-view {{ display:none; }}
body.irc #irc-view {{ display:flex; }}
body.modern #modern-view {{ display:flex; }}

/* Theme toggle */
.theme-toggle {{
    position:fixed; top:12px; right:12px; z-index:999;
    padding:6px 14px; border-radius:20px; cursor:pointer;
    font-size:12px; font-weight:600; border:none;
    transition: all 0.3s;
}}
body.irc .theme-toggle {{
    background:#000080; color:white; border:2px outset #4040C0;
    font-family:'Segoe UI',Tahoma,sans-serif;
}}
body.modern .theme-toggle {{
    background:rgba(99,102,241,0.2); color:#a5b4fc; border:1px solid rgba(99,102,241,0.3);
    font-family:-apple-system,BlinkMacSystemFont,sans-serif;
}}
.theme-toggle:hover {{ opacity:0.85; }}

/* ===== IRC THEME ===== */
.window {{
    width:100%; max-width:1100px; height:90vh;
    border:2px outset #dfdfdf; background:#c0c0c0;
    flex-direction:column;
    box-shadow:4px 4px 0px rgba(0,0,0,0.3);
}}
.titlebar {{
    background:linear-gradient(90deg,#000080 0%,#1084d0 100%);
    padding:3px 4px; display:flex; align-items:center; gap:4px;
    cursor:default; -webkit-user-select:none; flex-shrink:0;
}}
.titlebar-icon {{
    width:16px; height:16px; background:#FFD700; border-radius:2px;
    display:flex; align-items:center; justify-content:center;
    font-size:10px; font-weight:bold; color:#000080;
}}
.titlebar-text {{ flex:1; color:white; font-size:12px; font-weight:bold; white-space:nowrap; overflow:hidden; }}
.titlebar-btn {{
    width:16px; height:14px; background:#c0c0c0; border:1px outset #dfdfdf;
    display:flex; align-items:center; justify-content:center;
    font-size:9px; font-weight:bold; cursor:default;
}}
.menubar {{
    background:#c0c0c0; border-bottom:1px solid #808080;
    padding:2px 4px; display:flex; gap:2px; flex-shrink:0;
}}
.menu-item {{ padding:1px 8px; font-size:12px; color:#000; cursor:default; }}
.menu-item:hover {{ background:#000080; color:white; }}
.toolbar98 {{
    background:#c0c0c0; border-bottom:1px solid #808080;
    padding:2px 4px; display:flex; gap:2px; align-items:center; flex-shrink:0;
}}
.tool-btn {{
    border:1px outset #dfdfdf; background:#c0c0c0;
    padding:1px 4px; font-size:14px; cursor:default; min-width:24px; text-align:center;
}}
.tool-sep {{ width:2px; height:20px; border-left:1px solid #808080; border-right:1px solid #ffffff; margin:0 2px; }}
.tabstrip {{
    background:#c0c0c0; padding:0 4px; display:flex; flex-shrink:0; border-bottom:1px solid #808080;
}}
.tab {{ border:1px outset #dfdfdf; border-bottom:none; padding:2px 12px; font-size:11px; cursor:default; margin-right:1px; }}
.tab.active {{ background:white; border-bottom:1px solid white; font-weight:bold; position:relative; top:1px; }}
.client {{
    display:flex; flex:1; overflow:hidden; background:white;
    border:2px inset #dfdfdf; margin:2px;
}}
.irc-chat {{
    flex:1; overflow-y:auto; padding:4px 6px;
    font-family:'Fixedsys','Lucida Console','Consolas',monospace;
    font-size:13px; background:white; color:#000;
}}
.line {{ line-height:1.5; word-break:break-word; }}
.line.msg:hover {{ background:#EEF; }}
.time {{ color:#808080; }}
.line.join {{ color:#009300; }}
.line.part {{ color:#930000; }}
.line.topic {{ color:#000093; }}
.line.separator {{ color:#c0c0c0; text-align:center; font-size:11px; margin:2px 0; }}
.service-green {{ color:#008000; font-weight:bold; }}
.service-yellow {{ color:#996600; font-weight:bold; }}
.service-red {{ color:#CC0000; font-weight:bold; }}
.service-gray {{ color:#808080; }}
.service-sender {{ font-weight:bold; }}
.irc-nicklist {{
    width:140px; background:white; border-left:2px inset #dfdfdf;
    padding:4px; overflow-y:auto;
    font-family:'Fixedsys','Lucida Console','Consolas',monospace; font-size:12px;
}}
.irc-nicklist .nick {{ padding:0; cursor:default; }}
.irc-inputbar {{
    background:#c0c0c0; padding:2px 4px; display:flex;
    align-items:center; gap:4px; flex-shrink:0;
}}
.irc-inputbar .input-nick {{ font-size:12px; font-weight:bold; color:#000; }}
.irc-inputbar .input-field {{
    flex:1; border:2px inset #dfdfdf; padding:2px 4px;
    font-family:'Fixedsys','Lucida Console','Consolas',monospace;
    font-size:12px; background:white; color:#808080;
}}
.irc-statusbar {{
    background:#c0c0c0; border-top:1px solid #808080;
    padding:1px 4px; display:flex; font-size:11px; color:#000; flex-shrink:0;
}}
.status-cell {{ border:1px inset #dfdfdf; padding:0 6px; margin-right:2px; }}
.irc-chat::-webkit-scrollbar {{ width:16px; }}
.irc-chat::-webkit-scrollbar-track {{ background:#c0c0c0; border:1px inset #dfdfdf; }}
.irc-chat::-webkit-scrollbar-thumb {{ background:#c0c0c0; border:2px outset #dfdfdf; }}
.irc-chat::-webkit-scrollbar-button {{ background:#c0c0c0; border:1px outset #dfdfdf; height:16px; }}

/* Severity (shared) */
.sev-critical {{ color:#CC0000; font-weight:bold; }}
.sev-high {{ color:#CC6600; font-weight:bold; }}
.sev-medium {{ color:#999900; }}
.sev-low {{ color:#009900; }}
.sev-info {{ color:#0066CC; }}

/* ===== MODERN THEME ===== */
#modern-view {{
    flex-direction:column; min-height:100vh;
}}
.m-header-bar {{
    background:linear-gradient(135deg,#12121a 0%,#1a1a28 100%);
    border-bottom:1px solid #2a2a3a; padding:2rem 1.5rem;
    max-width:800px; width:100%; margin:0 auto;
}}
.m-logo {{ display:flex; align-items:center; gap:0.5rem; margin-bottom:1rem; }}
.m-logo-icon {{ font-size:1.5rem; color:#6366f1; }}
.m-logo-text {{ font-size:0.875rem; font-weight:600; letter-spacing:0.05em; text-transform:uppercase; color:#64748b; }}
.m-title {{ font-size:1.25rem; font-weight:600; margin-bottom:1rem; color:#e2e8f0; }}
.m-meta {{ display:flex; gap:1.5rem; flex-wrap:wrap; font-size:0.875rem; color:#64748b; margin-bottom:0.75rem; }}
.m-badges {{ display:flex; gap:0.5rem; flex-wrap:wrap; }}
.agent-badge {{
    display:inline-flex; align-items:center; gap:0.375rem;
    padding:0.25rem 0.75rem; border-radius:9999px;
    font-size:0.8125rem; font-weight:500; color:white;
}}
.badge-count {{ opacity:0.7; font-size:0.75rem; }}
.m-messages {{
    max-width:800px; margin:0 auto; padding:1.5rem;
    display:flex; flex-direction:column; gap:0.75rem; width:100%;
}}
.m-message {{
    background:var(--agent-bg,#12121a); border:1px solid #2a2a3a;
    border-radius:12px; padding:1rem 1.25rem; transition:transform 0.1s;
}}
.m-message:hover {{ transform:translateX(2px); }}
.m-service {{ border-left:3px solid currentColor; }}
body.modern .m-service.service-green {{ color:#4ade80; }}
body.modern .m-service.service-yellow {{ color:#fbbf24; }}
body.modern .m-service.service-red {{ color:#f87171; }}
body.modern .m-service.service-gray {{ color:#94a3b8; }}
body.modern .m-service .m-body, body.modern .m-service .m-body strong {{ color:inherit; }}
.m-header {{ display:flex; justify-content:space-between; align-items:center; margin-bottom:0.5rem; }}
.m-name {{ font-weight:600; font-size:0.875rem; }}
.m-time {{ font-size:0.75rem; color:#64748b; font-family:'Fira Code',monospace; }}
.m-body {{
    font-size:0.9375rem; line-height:1.7; color:#e2e8f0; word-break:break-word;
}}
.m-body pre {{
    background:rgba(0,0,0,0.3); border-radius:8px; padding:0.75rem 1rem;
    overflow-x:auto; margin:0.5rem 0; font-size:0.8125rem;
    font-family:'Fira Code',monospace;
}}
.m-body code.inline {{
    background:rgba(0,0,0,0.3); padding:0.125rem 0.375rem;
    border-radius:4px; font-size:0.85em; font-family:'Fira Code',monospace;
}}
.m-body strong {{ color:#f1f5f9; }}
.m-footer {{
    text-align:center; padding:2rem; color:#64748b; font-size:0.8125rem;
    border-top:1px solid #2a2a3a; margin-top:2rem;
}}
.m-footer a {{ color:#6366f1; text-decoration:none; }}
.m-footer a:hover {{ text-decoration:underline; }}

/* Modern severity overrides */
body.modern .sev-critical {{ color:#fca5a5; background:#7f1d1d; padding:0.0625rem 0.5rem; border-radius:4px; font-size:0.75rem; font-family:'Fira Code',monospace; }}
body.modern .sev-high {{ color:#fdba74; background:#7c2d12; padding:0.0625rem 0.5rem; border-radius:4px; font-size:0.75rem; font-family:'Fira Code',monospace; }}
body.modern .sev-medium {{ color:#fde047; background:#713f12; padding:0.0625rem 0.5rem; border-radius:4px; font-size:0.75rem; font-family:'Fira Code',monospace; }}
body.modern .sev-low {{ color:#bef264; background:#1a2e05; padding:0.0625rem 0.5rem; border-radius:4px; font-size:0.75rem; font-family:'Fira Code',monospace; }}
body.modern .sev-info {{ color:#93c5fd; background:#0c1a3d; padding:0.0625rem 0.5rem; border-radius:4px; font-size:0.75rem; font-family:'Fira Code',monospace; }}

@media (max-width:640px) {{
    .irc-nicklist {{ display:none; }}
    body.irc {{ padding:0; }}
    .window {{ height:100vh; max-width:100%; border:none; box-shadow:none; }}
    .m-header-bar,.m-messages {{ padding:1rem; }}
}}
</style>
</head>
<body class="irc">

<button class="theme-toggle" onclick="toggle()">Switch to Modern ▸</button>

<!-- ===== IRC VIEW ===== -->
<div id="irc-view" class="window">
    <div class="titlebar">
        <div class="titlebar-icon">m</div>
        <span class="titlebar-text">mIRC — {channel} — {html.escape(task[:80])}</span>
        <div class="titlebar-btn">_</div>
        <div class="titlebar-btn">□</div>
        <div class="titlebar-btn">✕</div>
    </div>
    <div class="menubar">
        <span class="menu-item"><u>F</u>ile</span>
        <span class="menu-item"><u>V</u>iew</span>
        <span class="menu-item">F<u>a</u>vorites</span>
        <span class="menu-item"><u>T</u>ools</span>
        <span class="menu-item"><u>W</u>indow</span>
        <span class="menu-item"><u>H</u>elp</span>
    </div>
    <div class="toolbar98">
        <span class="tool-btn">📎</span><span class="tool-btn">📁</span>
        <span class="tool-sep"></span>
        <span class="tool-btn">🔗</span><span class="tool-btn">⚙️</span>
        <span class="tool-sep"></span>
        <span class="tool-btn">🎨</span><span class="tool-btn">👤</span>
        <span class="tool-sep"></span>
        <span style="font-size:11px;color:#000;margin-left:8px;">ensemble v1.0</span>
    </div>
    <div class="tabstrip">
        <div class="tab">Status</div>
        <div class="tab active">{channel}</div>
    </div>
    <div class="client">
        <div class="irc-chat">
            <div class="line topic">* Now talking in <b style="color:#000093">{channel}</b></div>
            <div class="line topic">* Topic is: {html.escape(task[:200])}</div>
            <div class="line topic">* Set by <b style="color:#000093">ensemble</b></div>
            <div class="line separator">—————————————————————————————————</div>
            {irc_html}
        </div>
        <div class="irc-nicklist">{irc_nicklist}</div>
    </div>
    <div class="irc-inputbar">
        <span class="input-nick">[spectator]</span>
        <input class="input-field" value="This is a replay — {total_msgs} messages, {duration}" readonly>
    </div>
    <div class="irc-statusbar">
        <span class="status-cell">{channel}</span>
        <span class="status-cell">{len(agents)} users</span>
        <span class="status-cell">{total_msgs} msgs</span>
        <span class="status-cell">{duration}</span>
        <span class="status-cell" style="flex:1;text-align:right"><a href="https://github.com/michelhelsdingen/ensemble" style="color:#000093;text-decoration:none">github.com/michelhelsdingen/ensemble</a></span>
    </div>
</div>

<!-- ===== MODERN VIEW ===== -->
<div id="modern-view">
    <div class="m-header-bar">
        <div class="m-logo"><span class="m-logo-icon">◈</span><span class="m-logo-text">Ensemble Replay</span></div>
        <h1 class="m-title">{html.escape(task[:200])}</h1>
        <div class="m-meta">
            <span>💬 {total_msgs} messages</span>
            <span>👥 {len(agents)} agents</span>
            {"<span>⏱ " + duration + "</span>" if duration else ""}
        </div>
        <div class="m-badges">{agent_badges}</div>
    </div>
    <div class="m-messages">{modern_html}</div>
    <div class="m-footer">Generated by <a href="https://github.com/michelhelsdingen/ensemble">ensemble</a> — multi-agent collaboration engine</div>
</div>

<script>
function toggle() {{
    const b = document.body;
    const btn = document.querySelector('.theme-toggle');
    if (b.classList.contains('irc')) {{
        b.className = 'modern';
        btn.textContent = '◂ Switch to mIRC';
    }} else {{
        b.className = 'irc';
        btn.textContent = 'Switch to Modern ▸';
    }}
}}
</script>
</body>
</html>'''


def main():
    if len(sys.argv) < 2:
        print("Usage: generate-replay.py <team-id> [--task 'desc'] [--output file.html]", file=sys.stderr)
        sys.exit(1)

    team_id = sys.argv[1]
    output = "replay.html"
    task = "Ensemble Collaboration Session"

    if "--output" in sys.argv:
        idx = sys.argv.index("--output")
        if idx + 1 < len(sys.argv):
            output = sys.argv[idx + 1]

    if "--task" in sys.argv:
        idx = sys.argv.index("--task")
        if idx + 1 < len(sys.argv):
            task = sys.argv[idx + 1]

    # Try API for task description
    try:
        import urllib.request
        with urllib.request.urlopen(f"http://localhost:23000/api/ensemble/teams/{team_id}", timeout=2) as resp:
            team_data = json.loads(resp.read())
            api_task = team_data.get("team", {}).get("description", "")
            if api_task:
                task = api_task
    except Exception:
        pass

    msgs = load_messages(team_id)
    if not msgs:
        print("No messages found", file=sys.stderr)
        sys.exit(1)

    html_content = generate_html(msgs, team_id, task)

    with open(output, "w") as f:
        f.write(html_content)

    agent_count = len(set(m.get("from") for m in msgs if m.get("from") != "ensemble"))
    msg_count = len([m for m in msgs if m.get("from") != "ensemble"])
    print(f"✓ Generated {output} ({msg_count} messages, {agent_count} agents)")


if __name__ == "__main__":
    main()
