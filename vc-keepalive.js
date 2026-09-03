const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel } = require('@discordjs/voice');
const http = require('http');
const url = require('url');

const WebSocketShard = require('discord.js-selfbot-v13/src/client/websocket/WebSocketShard');
const origIdentify = WebSocketShard.prototype.identifyNew;
WebSocketShard.prototype.identifyNew = function () {
    this.manager.client.options.ws.properties.browser = "Discord VR";
    return origIdentify.call(this);
};

const PORT = process.env.PORT || 3000;
const APP_ID = process.env.APP_ID || '1532235515468976219';
const bots = [];
const allLogs = [];

function addLog(msg, idx) {
    const t = new Date().toLocaleTimeString();
    const entry = `[${t}] ${msg}`;
    allLogs.unshift(entry);
    if (allLogs.length > 200) allLogs.pop();
    if (bots[idx]) {
        bots[idx].logs.unshift(entry);
        if (bots[idx].logs.length > 50) bots[idx].logs.pop();
    }
}

class BotInstance {
    constructor(token, guildId, channelId, index) {
        this.token = token;
        this.guildId = guildId;
        this.channelId = channelId;
        this.index = index;
        this.client = new Client();
        this.connected = false;
        this.inVoice = false;
        this.muted = false;
        this.deafened = false;
        this.streaming = false;
        this.camera = false;
        this.user = null;
        this.guildName = null;
        this.channelName = null;
        this.connection = null;
        this.logs = [];
        this.presence = null;
        this._setup();
    }
    _setup() {
        this.client.on('ready', () => {
            this.connected = true;
            this.user = this.client.user.tag;
            this.guildName = this.client.guilds.cache.get(this.guildId)?.name || 'N/A';
            addLog(`[${this.index+1}] Logged in as ${this.client.user.tag}`, this.index);
            this.joinVC();
            this.setPresence();
            setInterval(() => this.setPresence(), 120000);
        });
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            if (!oldState || !oldState.member || !this.client.user) return;
            if (oldState.member.id !== this.client.user.id) return;
            if (!oldState.channelId && newState.channelId) { this.inVoice = true; return; }
            if (oldState.channelId && newState.channelId) return;
            this.inVoice = false;
            addLog(`[${this.index+1}] Disconnected`, this.index);
        });
        this.client.login(this.token).catch(e => addLog(`[${this.index+1}] Login failed: ${e.message}`, this.index));
    }
    _sendVoiceState() {
        const gid = this.connection?.joinConfig?.guildId || this.guildId;
        const cid = this.connection?.joinConfig?.channelId || this.channelId;
        if (!gid || !cid) return;
        const payload = {
            op: 4,
            d: {
                guild_id: gid,
                channel_id: cid,
                self_mute: this.muted,
                self_deaf: this.deafened,
                self_stream: this.streaming,
                self_video: this.camera,
            },
        };
        try {
            const shards = this.client?.ws?.shards;
            if (shards) {
                shards.each(shard => {
                    try { shard.send(payload); } catch {}
                });
            }
        } catch {}
    }
    async joinVC() {
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) { addLog(`[${this.index+1}] Guild not found`, this.index); return; }
        const channel = guild.channels.cache.get(this.channelId);
        if (!channel) { addLog(`[${this.index+1}] Voice channel not found`, this.index); return; }
        try {
            if (this.connection) { try { this.connection.destroy(); } catch {} this.connection = null; }
            this.connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfMute: this.muted,
                selfDeaf: this.deafened,
                group: "bot-" + this.index,
            });
            this.inVoice = true;
            this.channelName = channel.name;
            addLog(`[${this.index+1}] Joined: ${channel.name}`, this.index);
            setTimeout(() => this._sendVoiceState(), 2000);
        } catch (err) { addLog(`[${this.index+1}] Failed to join: ${err.message}`, this.index); }
    }
    setMute(val) {
        this.muted = val;
        if (this.connection) { try { this.connection.rejoin({ selfMute: val }); } catch {} }
        addLog(`[${this.index+1}] ${val ? 'Muted' : 'Unmuted'}`, this.index);
    }
    setDeaf(val) {
        this.deafened = val;
        if (this.connection) { try { this.connection.rejoin({ selfDeaf: val }); } catch {} }
        addLog(`[${this.index+1}] ${val ? 'Deafened' : 'Undeafened'}`, this.index);
    }
    setStream(val) {
        this.streaming = val;
        if (val) this.camera = true;
        if (!val) this.camera = false;
        this._sendVoiceState();
        addLog(`[${this.index+1}] ${val ? 'Streaming ON' : 'Streaming OFF'}`, this.index);
    }
    setCam(val) {
        this.camera = val;
        if (val) this.streaming = true;
        if (!val) this.streaming = false;
        this._sendVoiceState();
        addLog(`[${this.index+1}] ${val ? 'Camera ON' : 'Camera OFF'}`, this.index);
    }
    setPresence() {
        if (!this.presence) { try { this.client.user?.setPresence({ activities: [] }).catch(() => {}); } catch {} return; }
        const list = Array.isArray(this.presence) ? this.presence : (Array.isArray(this.presence.activities) && this.presence.activities.length ? this.presence.activities : [this.presence]);
        const activities = [];
        for (const item of list) {
            const { applicationId, name, type, details, state, largeImage, largeText, smallImage, smallText, startTimestamp, hoursElapsed, elapsed, stream } = item;
            const activity = { name: name || 'VC Keep Alive', type: type || 'PLAYING' };
            if (applicationId || APP_ID) activity.applicationId = applicationId || APP_ID;
            if (details) activity.details = details;
            if (state) activity.state = state;
            if (stream) activity.url = stream;
            if (largeImage || largeText || smallImage || smallText) {
                activity.assets = {};
                if (largeImage) activity.assets.largeImage = largeImage;
                if (largeText) activity.assets.largeText = largeText;
                if (smallImage) activity.assets.smallImage = smallImage;
                if (smallText) activity.assets.smallText = smallText;
            }
            if (elapsed && typeof elapsed === 'string') {
                const parts = elapsed.split(':');
                if (parts.length >= 2) {
                    const h = parseInt(parts[0]) || 0;
                    const m = parseInt(parts[1]) || 0;
                    const s = parseInt(parts[2]) || 0;
                    activity.timestamps = { start: Date.now() - (h * 3600000 + m * 60000 + s * 1000) };
                }
            } else if (hoursElapsed !== undefined) {
                activity.timestamps = { start: Date.now() - hoursElapsed * 3600000 };
            } else if (startTimestamp !== undefined) {
                activity.timestamps = { start: startTimestamp };
            }
            activities.push(activity);
        }
        try { this.client.user?.setPresence({ activities }).catch(() => {}); } catch {}
        addLog(`[${this.index+1}] Presence set (${activities.map(a => a.name).join(', ')})`, this.index);
    }
    stop() {
        this.stopped = true;
        this.destroy();
        addLog(`[${this.index+1}] Stopped`, this.index);
    }
    destroy() {
        this.connected = false;
        this.inVoice = false;
        this.connection = null;
        try { this.client.destroy(); } catch {}
    }
    restart() {
        this.stopped = false;
        this.destroy();
        addLog(`[${this.index+1}] Restarting...`, this.index);
        setTimeout(() => {
            this.client = new Client();
            this._setup();
        }, 2000);
    }
}

function loadBots() {
    const fs = require('fs');
    const cfgPath = require('path').join(__dirname, 'config.json');
    if (fs.existsSync(cfgPath)) {
        addLog('Loading config.json', null);
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        (cfg.bots || []).forEach((b, i) => {
            if (b.token && b.guildId && b.channelId) {
                addLog(`Loading bot #${i+1} from config`, null);
                const bot = new BotInstance(b.token, b.guildId, b.channelId, bots.length, b.presence);
                if (b.muted) bot.muted = true;
                if (b.deafened) bot.deafened = true;
                if (b.streaming) bot.streaming = true;
                if (b.camera) bot.camera = true;
                bots.push(bot);
            }
        });
        return;
    }
    if (process.env.DISCORD_TOKEN && process.env.GUILD_ID && process.env.VOICE_CHANNEL_ID) {
        addLog('Legacy mode: DISCORD_TOKEN', null);
        bots.push(new BotInstance(process.env.DISCORD_TOKEN, process.env.GUILD_ID, process.env.VOICE_CHANNEL_ID, 0));
    }
    Object.keys(process.env).forEach(key => {
        const m = key.match(/^TOKEN_(\d+)$/);
        if (!m) return;
        const i = m[1];
        const token = process.env[key];
        const guildId = process.env[`GUILD_${i}`];
        const channelId = process.env[`CHANNEL_${i}`];
        if (token && guildId && channelId) {
            addLog(`Loading bot #${i} (TOKEN_${i})`, null);
            const bot = new BotInstance(token, guildId, channelId, bots.length);
            if (process.env[`MUTE_${i}`] === 'true') bot.muted = true;
            if (process.env[`DEAF_${i}`] === 'true') bot.deafened = true;
            if (process.env[`STREAM_${i}`] === 'true') bot.streaming = true;
            if (process.env[`CAM_${i}`] === 'true') bot.camera = true;
            bots.push(bot);
        } else {
            addLog(`Skipping TOKEN_${i}: missing GUILD_${i} or CHANNEL_${i}`, null);
        }
    });
    bots.forEach(b => {
        if (!b.presence && process.env.DEFAULT_PRESENCE) {
            try { b.presence = JSON.parse(process.env.DEFAULT_PRESENCE); b.setPresence(); } catch (e) { addLog(`Invalid DEFAULT_PRESENCE: ${e.message}`, null); }
        }
    });
}

function serveStatus(res) {
    res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
        bots: bots.map(b => ({
            connected: b.connected, inVoice: b.inVoice,
            muted: b.muted, deafened: b.deafened,
            streaming: b.streaming, camera: b.camera,
            stopped: b.stopped || false,
            user: b.user, guildName: b.guildName, channelName: b.channelName,
        })),
        logs: allLogs
    }));
}

function handleCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

const server = http.createServer((req, res) => {
    const p = url.parse(req.url).pathname;
    handleCORS(res);
    if (req.method === 'OPTIONS') return res.end();
    if (p === '/status') return serveStatus(res);
    if (p === '/presence-config') {
        res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ bots: bots.map(b => ({ index: bots.indexOf(b), userId: b.client?.user?.id, presence: b.presence || null })) }));
    }
    const mReconn = p.match(/^\/reconnect\/(\d+)$/);
    const mRestart = p.match(/^\/restart\/(\d+)$/);
    const mStop = p.match(/^\/stop\/(\d+)$/);
    const mMute = p.match(/^\/mute\/(\d+)\/(\d+)$/);
    const mDeaf = p.match(/^\/deaf\/(\d+)\/(\d+)$/);
    const mStream = p.match(/^\/stream\/(\d+)\/(\d+)$/);
    const mCam = p.match(/^\/cam\/(\d+)\/(\d+)$/);
    if (p === '/shutdown') {
        addLog('Shutting down all bots...', null);
        bots.forEach(b => b.destroy());
        server.close(() => process.exit(0));
        return res.end('ok');
    }
    if (mReconn) { const idx=+mReconn[1]; if(bots[idx]){addLog(`Reconnect #${idx+1}`,idx);bots[idx].joinVC();} return res.end('ok'); }
    if (mRestart) { const idx=+mRestart[1]; if(bots[idx]) bots[idx].restart(); return res.end('ok'); }
    if (mStop) { const idx=+mStop[1]; if(bots[idx]) bots[idx].stop(); return res.end('ok'); }
    if (mMute) { const idx=+mMute[1],val=+mMute[2]; if(bots[idx]) bots[idx].setMute(!!val); return res.end('ok'); }
    if (mDeaf) { const idx=+mDeaf[1],val=+mDeaf[2]; if(bots[idx]) bots[idx].setDeaf(!!val); return res.end('ok'); }
    if (mStream) { const idx=+mStream[1],val=+mStream[2]; if(bots[idx]) bots[idx].setStream(!!val); return res.end('ok'); }
    if (mCam) { const idx=+mCam[1],val=+mCam[2]; if(bots[idx]) bots[idx].setCam(!!val); return res.end('ok'); }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>VC Keep Alive</title>
<style>
* { margin:0; padding:0; box-sizing:border-box; }
body {
    font-family:'Segoe UI',sans-serif;
    background:linear-gradient(135deg,#0f0c29,#302b63,#24243e);
    min-height:100vh; color:#fff; padding:30px 20px;
}
h1 { text-align:center; font-size:26px; margin-bottom:4px;
    background:linear-gradient(90deg,#667eea,#764ba2);
    -webkit-background-clip:text; -webkit-text-fill-color:transparent; }
.subtitle { text-align:center; color:rgba(255,255,255,0.4); font-size:13px; margin-bottom:30px; }
.bots-grid { display:grid; grid-template-columns:repeat(auto-fit,minmax(380px,1fr)); gap:16px; max-width:1200px; margin:0 auto; }
.card {
    background:rgba(255,255,255,0.05); backdrop-filter:blur(12px);
    border-radius:20px; padding:22px; border:1px solid rgba(255,255,255,0.08);
    transition:all 0.3s ease;
}
.card:hover { transform:translateY(-3px); border-color:rgba(255,255,255,0.15); }
.card-header { display:flex; align-items:center; justify-content:space-between; margin-bottom:16px; }
.card-title { font-weight:600; font-size:15px; }
.badge { font-size:10px; padding:4px 10px; border-radius:20px; text-transform:uppercase; letter-spacing:0.5px; }
.badge.on { background:rgba(74,222,128,0.2); color:#4ade80; }
.badge.off { background:rgba(248,113,113,0.2); color:#f87171; }
.card-grid { display:grid; grid-template-columns:1fr 1fr; gap:8px; margin-bottom:10px; }
.stat { background:rgba(0,0,0,0.2); border-radius:10px; padding:10px; text-align:center; }
.stat-label { font-size:9px; text-transform:uppercase; letter-spacing:0.8px; color:rgba(255,255,255,0.3); margin-bottom:4px; }
.stat-value { font-size:13px; font-weight:600; }
.dot { display:inline-block; width:8px; height:8px; border-radius:50%; margin-right:5px; animation:pulse 2s infinite; }
.dot.on { background:#4ade80; box-shadow:0 0 8px rgba(74,222,128,0.5); }
.dot.off { background:#f87171; box-shadow:0 0 8px rgba(248,113,113,0.5); }
@keyframes pulse { 0%,100% { opacity:1; } 50% { opacity:0.5; } }
.toggle-group { display:flex; gap:6px; margin-bottom:10px; flex-wrap:wrap; }
.toggle {
    flex:1; min-width:60px; padding:7px 4px; border:none; border-radius:8px; font-size:10px; font-weight:600;
    cursor:pointer; transition:all 0.3s; text-transform:uppercase; letter-spacing:0.3px;
}
.toggle:hover { transform:translateY(-1px); opacity:0.9; }
.toggle-mute { background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; }
.toggle-mute.active { background:linear-gradient(135deg,#ef4444,#dc2626); }
.toggle-deaf { background:linear-gradient(135deg,#8b5cf6,#7c3aed); color:#fff; }
.toggle-deaf.active { background:linear-gradient(135deg,#ef4444,#dc2626); }
.toggle-stream { background:linear-gradient(135deg,#3b82f6,#1d4ed8); color:#fff; }
.toggle-stream.active { background:linear-gradient(135deg,#10b981,#059669); color:#fff; }
.toggle-cam { background:linear-gradient(135deg,#ec4899,#db2777); color:#fff; }
.toggle-cam.active { background:linear-gradient(135deg,#10b981,#059669); color:#fff; }
.card-actions { display:flex; gap:6px; }
.btn {
    flex:1; padding:8px; border:none; border-radius:8px; font-size:11px; font-weight:600;
    cursor:pointer; transition:all 0.3s ease; text-transform:uppercase; letter-spacing:0.3px;
}
.btn:hover { transform:translateY(-1px); opacity:0.9; }
.btn-reconnect { background:linear-gradient(135deg,#667eea,#764ba2); color:#fff; }
.btn-restart { background:linear-gradient(135deg,#f59e0b,#d97706); color:#fff; }
.btn-stop { background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; }
.global-logs {
    max-width:1200px; margin:24px auto 0;
    background:rgba(0,0,0,0.3); border-radius:16px; padding:16px;
    max-height:180px; overflow-y:auto; font-family:'Courier New',monospace; font-size:11px; line-height:1.7;
}
.global-logs::-webkit-scrollbar { width:4px; }
.global-logs::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.15); border-radius:2px; }
.log-entry { color:rgba(255,255,255,0.5); border-bottom:1px solid rgba(255,255,255,0.02); }
.log-entry:first-child { color:#fff; }
.footer { text-align:center; margin-top:20px; }
.footer-inner { font-size:11px; color:rgba(255,255,255,0.15); }
.btn-stop { margin-top:6px; padding:6px 18px; border:none; border-radius:8px; font-size:10px; font-weight:600; cursor:pointer; background:linear-gradient(135deg,#ef4444,#dc2626); color:#fff; text-transform:uppercase; letter-spacing:0.5px; transition:all 0.3s; }
.btn-stop:hover { transform:translateY(-1px); opacity:0.9; }
@media (max-width:600px) { .bots-grid { grid-template-columns:1fr; } }
</style>
</head>
<body>
<h1>ðŸŽ§ VC Keep Alive</h1>
<p class="subtitle">Multi-Account Voice Controller</p>
<div class="bots-grid" id="grid"></div>
<div class="global-logs" id="logsBox"><div class="log-entry">Waiting for logs...</div></div>
<div class="footer"><div class="footer-inner">Hosted on Railway</div><button class="btn-stop" onclick="if(confirm('Stop all bots and shut down?'))fetch('/shutdown')">â» Stop Host</button></div>
<script>
function esc(s){return s.replace(/[&<>"]/g,function(m){return{'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m];});}
function doAction(path){fetch(path).then(()=>setTimeout(update,500));}
function update(){
fetch('/status').then(r=>r.json()).then(d=>{
document.getElementById('grid').innerHTML=d.bots&&d.bots.length?d.bots.map((b,i)=>
'<div class="card'+(b.stopped?'" style="opacity:0.4"':'')+'">' +
'<div class="card-header"><span class="card-title">'+(b.user||'Account #'+(i+1))+'</span><span class="badge '+(b.stopped?'off':(b.connected?'on':'off'))+'">'+(b.stopped?'Stopped':(b.connected?'Online':'Offline'))+'</span></div>' +
'<div class="card-grid">' +
'<div class="stat"><div class="stat-label">Voice</div><div class="stat-value"><span class="dot '+(b.inVoice?'on':'off')+'"></span>'+(b.stopped?'-':(b.inVoice?'Connected':'Silent'))+'</div></div>' +
'<div class="stat"><div class="stat-label">Channel</div><div class="stat-value" style="font-size:11px">'+(b.stopped?'-':esc(b.channelName))+'</div></div>' +
'</div>' +
(!b.stopped?'<div class="toggle-group">' +
'<button class="toggle toggle-mute'+(b.muted?' active':'')+'" onclick="doAction(\'/mute/'+i+'/'+(b.muted?0:1)+'\')">'+(b.muted?'Muted':'Mute')+'</button>' +
'<button class="toggle toggle-deaf'+(b.deafened?' active':'')+'" onclick="doAction(\'/deaf/'+i+'/'+(b.deafened?0:1)+'\')">'+(b.deafened?'Deafened':'Deafen')+'</button>' +
'<button class="toggle toggle-stream'+(b.streaming?' active':'')+'" onclick="doAction(\'/stream/'+i+'/'+(b.streaming?0:1)+'\')">'+(b.streaming?'ON':'Stream')+'</button>' +
'<button class="toggle toggle-cam'+(b.camera?' active':'')+'" onclick="doAction(\'/cam/'+i+'/'+(b.camera?0:1)+'\')">'+(b.camera?'ON':'Cam')+'</button>' +
'</div>':'') +
'<div class="card-actions">' +
(!b.stopped?'<button class="btn btn-reconnect" onclick="doAction(\'/reconnect/'+i+'\')">Reconnect</button>':'') +
'<button class="btn btn-restart" onclick="doAction(\'/restart/'+i+'\')">Restart</button>' +
'<button class="btn btn-stop" onclick="if(confirm(\'Stop bot #'+(i+1)+'?\'))doAction(\'/stop/'+i+'\')">Stop</button>' +
'</div></div>'
).join(''):'<div style="text-align:center;color:rgba(255,255,255,0.3);grid-column:1/-1;padding:40px;">No bots configured</div>';
document.getElementById('logsBox').innerHTML=(d.logs||[]).map(l=>'<div class="log-entry">'+esc(l)+'</div>').join('')||'<div class="log-entry">No logs</div>';
}).catch(()=>{});
}
setInterval(update,3000);update();
</script>
</body>
</html>`);
});

process.on('uncaughtException', e => {
    try { addLog(`Server error: ${e.message}`, null); } catch {}
});
process.on('unhandledRejection', e => {
    try { addLog(`Server reject: ${e.message}`, null); } catch {}
});
server.listen(PORT, () => console.log('Web panel on port ' + PORT));
loadBots();
