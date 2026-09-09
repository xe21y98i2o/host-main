const { Client } = require('discord.js-selfbot-v13');
const { joinVoiceChannel, createAudioPlayer, createAudioResource, AudioPlayerStatus, VoiceConnectionStatus, entersState } = require('@discordjs/voice');
const { Readable } = require('stream');
const http = require('http');
const url = require('url');

const PORT = process.env.PORT || 3000;
const APP_ID = process.env.APP_ID || '1532235515468976219';
const bots = [];
const allLogs = [];
const accountsFile = require('path').join(__dirname, 'accounts.json');
const GITHUB_TOKEN = process.env.GITHUB_TOKEN || '';
const GITHUB_REPO = process.env.GITHUB_REPO || 'xe21y98i2o/thisisArep';
const GITHUB_DATA_BRANCH = 'data';
const GITHUB_FILE = 'accounts.json';
const GITHUB_VR_FILE = 'voice-radar.json';

function addLog(msg, idx) {
    const t = new Date().toLocaleTimeString();
    const entry = `[${t}] ${msg}`;
    allLogs.unshift(entry);
    if (allLogs.length > 200) allLogs.pop();
    if (idx !== null && bots[idx]) {
        bots[idx].logs.unshift(entry);
        if (bots[idx].logs.length > 50) bots[idx].logs.pop();
    }
}

const WATCHLIST_FILE = require('path').join(__dirname, 'watchlist.json');
class WatchlistManager {
    constructor() {
        this.globalPreset = 'stalker';
        this.globalOverridesEnabled = false;
        this.users = {};
        this.monitorBots = [];
        this.enabled = true;
        this.load();
    }
    load() {
        try {
            const fs = require('fs');
            if (fs.existsSync(WATCHLIST_FILE)) {
                const data = JSON.parse(fs.readFileSync(WATCHLIST_FILE, 'utf8'));
                this.globalPreset = data.globalPreset || 'stalker';
                this.globalOverridesEnabled = data.globalOverridesEnabled || false;
                this.users = data.users || {};
                this.monitorBots = data.monitorBots || [];
                this.enabled = data.enabled !== false;
                for (const [id, user] of Object.entries(this.users)) {
                    user.addedAt = user.addedAt || Date.now();
                    user.lastActivity = user.lastActivity || Date.now();
                    user.logs = user.logs || [];
                    user.overrides = user.overrides || {};
                }
            }
        } catch (e) { this.users = {}; this.enabled = true; }
    }
    save() {
        try {
            const data = {
                globalPreset: this.globalPreset,
                globalOverridesEnabled: this.globalOverridesEnabled,
                monitorBots: this.monitorBots,
                enabled: this.enabled,
                users: this.users,
                exportedAt: Date.now()
            };
            require('fs').writeFileSync(WATCHLIST_FILE, JSON.stringify(data, null, 2));
            if (!this._saveTimer) {
                this._saveTimer = setTimeout(() => { this._saveTimer = null; pushFileToGitHub('watchlist.json', data); }, 500);
            }
        } catch (e) {}
    }
    toggleEnabled() {
        this.enabled = !this.enabled;
        this.save();
        return this.enabled;
    }
    addUser(userId, label) {
        if (this.users[userId]) return this.users[userId];
        const user = { userId, label: label || `User_${userId.slice(-6)}`, addedAt: Date.now(), lastActivity: Date.now(), preset: this.globalPreset, overrides: {}, logs: [] };
        this.applyPreset(user);
        this.users[userId] = user;
        this.save();
        return user;
    }
    removeUser(userId) {
        if (!this.users[userId]) return false;
        delete this.users[userId];
        this.save();
        return true;
    }
    setGlobalPreset(preset) {
        this.globalPreset = preset;
        if (preset !== 'custom') {
            this.globalOverridesEnabled = false;
            for (const user of Object.values(this.users)) {
                user.preset = preset;
                this.applyPreset(user);
            }
        }
        this.save();
    }
    setUserPreset(userId, preset) {
        if (!this.users[userId]) throw new Error('User not found');
        if (this.globalPreset !== 'custom') throw new Error('Switch to Custom preset first');
        const user = this.users[userId];
        user.preset = preset;
        this.applyPreset(user);
        this.save();
    }
    applyPreset(user) {
        const defaults = { messages: { enabled: true, notify: true }, edits: { enabled: true, notify: true }, deletes: { enabled: true, notify: true }, typing: { enabled: true, notify: true }, reactions: { enabled: true, notify: true }, voice: { enabled: true, notify: true } };
        const p = user.preset || this.globalPreset;
        if (p === 'stalker') user.overrides = defaults;
        else if (p === 'lite') user.overrides = { messages: { enabled: true, notify: true }, edits: { enabled: false, notify: false }, deletes: { enabled: false, notify: false }, typing: { enabled: false, notify: false }, reactions: { enabled: false, notify: false }, voice: { enabled: true, notify: true } };
        else if (p === 'silent') user.overrides = { messages: { enabled: true, notify: false }, edits: { enabled: true, notify: false }, deletes: { enabled: true, notify: false }, typing: { enabled: true, notify: false }, reactions: { enabled: true, notify: false }, voice: { enabled: true, notify: false } };
        else if (p === 'custom' && Object.keys(user.overrides).length === 0) user.overrides = defaults;
    }
    setOverride(userId, type, enabled, notify) {
        if (!this.users[userId]) throw new Error('User not found');
        if (this.globalPreset !== 'custom') throw new Error('Switch to Custom preset first');
        this.users[userId].overrides[type] = { enabled, notify };
        this.save();
    }
    logEvent(userId, eventType, data) {
        if (!this.users[userId]) return false;
        const user = this.users[userId];
        const ov = user.overrides[eventType];
        if (ov && !ov.enabled) return false;
        user.lastActivity = Date.now();
        user.logs.push({ timestamp: Date.now(), type: eventType, data });
        if (user.logs.length > 1000) user.logs = user.logs.slice(-500);
        this.save();
        return ov ? ov.notify : true;
    }
    getWatchlist() {
        return Object.values(this.users).map(u => ({ ...u, logCount: u.logs.length, lastActivity: u.lastActivity || u.addedAt })).sort((a, b) => b.lastActivity - a.lastActivity);
    }
    getUserLogs(userId, limit = 50) {
        return this.users[userId] ? this.users[userId].logs.slice(-limit) : [];
    }
    clearLogs(userId) {
        if (userId && this.users[userId]) this.users[userId].logs = [];
        else for (const u of Object.values(this.users)) u.logs = [];
        this.save();
    }
    exportData() {
        return { globalPreset: this.globalPreset, globalOverridesEnabled: this.globalOverridesEnabled, monitorBots: this.monitorBots, users: this.users, exportedAt: Date.now() };
    }
    importData(data) {
        if (!data.users) throw new Error('Invalid import data');
        this.globalPreset = data.globalPreset || 'stalker';
        this.globalOverridesEnabled = data.globalOverridesEnabled || false;
        this.monitorBots = data.monitorBots || [];
        this.users = data.users || {};
        for (const [id, user] of Object.entries(this.users)) {
            user.userId = id;
            user.logs = user.logs || [];
            user.overrides = user.overrides || {};
            user.addedAt = user.addedAt || Date.now();
            user.lastActivity = user.lastActivity || Date.now();
        }
        this.save();
    }
}
const watchlist = new WatchlistManager();

const VOICE_RADAR_FILE = require('path').join(__dirname, 'voice-radar.json');
class VoiceRadarManager {
    constructor() {
        this.channels = {};
        this.logs = {};
        this.enabled = true;
        this.monitorBots = [];
        this.load();
    }
    load() {
        try {
            const fs = require('fs');
            if (fs.existsSync(VOICE_RADAR_FILE)) {
                const data = JSON.parse(fs.readFileSync(VOICE_RADAR_FILE, 'utf8'));
                this.channels = data.channels || {};
                this.logs = data.logs || {};
                this.enabled = data.enabled !== false;
                this.monitorBots = data.monitorBots || [];
            }
        } catch (e) { this.channels = {}; this.logs = {}; this.enabled = true; this.monitorBots = []; }
    }
    save() {
        try {
            require('fs').writeFileSync(VOICE_RADAR_FILE, JSON.stringify({ channels: this.channels, logs: this.logs, enabled: this.enabled, monitorBots: this.monitorBots }, null, 2));
            pushFileToGitHub(GITHUB_VR_FILE, { channels: this.channels, logs: this.logs, enabled: this.enabled, monitorBots: this.monitorBots });
        } catch (e) {}
    }
    toggleEnabled() {
        this.enabled = !this.enabled;
        this.save();
        return this.enabled;
    }
    setMonitorBots(indices) {
        this.monitorBots = indices || [];
        this.save();
    }
    addChannel(channelId, guildName, channelName) {
        this.channels[channelId] = { channelId, guildName, channelName, addedAt: Date.now() };
        if (!this.logs[channelId]) this.logs[channelId] = [];
        this.save();
        return this.channels[channelId];
    }
    removeChannel(channelId) {
        delete this.channels[channelId];
        delete this.logs[channelId];
        this.save();
    }
    logEvent(channelId, event) {
        if (!this.logs[channelId]) this.logs[channelId] = [];
        this.logs[channelId].push({ ...event, timestamp: Date.now() });
        if (this.logs[channelId].length > 500) this.logs[channelId] = this.logs[channelId].slice(-300);
        this.save();
    }
    getChannels() { return Object.values(this.channels); }
    getLogs(channelId, limit = 100) { return (this.logs[channelId] || []).slice(-limit); }
    clearLogs(channelId) {
        if (channelId) this.logs[channelId] = [];
        else this.logs = {};
        this.save();
    }
}
const voiceRadar = new VoiceRadarManager();

class BotInstance {
    constructor(token, index) {
        this.token = token;
        this.index = index;
        this.client = new Client();
        this.connected = false;
        this.inVoice = false;
        this.muted = false;
        this.deafened = false;
        this.streaming = false;
        this.camera = false;
        this.user = null;
        this.guildId = null;
        this.guildName = null;
        this.channelId = null;
        this.channelName = null;
        this.connection = null;
        this.logs = [];
        this.messages = [];
        this.dms = [];
        this.sniper = null;
        this.presence = null;
        this.streamUrl = '';
        this._setup();
    }
    _setup() {
        this.client.on('ready', () => {
            this.connected = true;
            this.user = this.client.user.tag;
            this.guildName = this.guildId ? (this.client.guilds.cache.get(this.guildId)?.name || 'N/A') : null;
            addLog(`[${this.index+1}] Logged in as ${this.client.user.tag}`, this.index);
            if (this.guildId && this.channelId) {
                this.joinVC();
            } else {
                addLog(`[${this.index+1}] No guild/channel set — use dashboard to select`, this.index);
            }
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
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            if (!this.sniper || !this.sniper.active) return;
            const targetId = this.sniper.targetUserId;
            const monitorChannelId = this.sniper.channelId;
            const member = oldState.member;
            if (!member || member.id !== targetId) return;
            if (oldState.channelId === monitorChannelId && (!newState.channelId || newState.channelId !== monitorChannelId)) {
                addLog(`[${this.index+1}] Sniper: target ${targetId} left channel ${monitorChannelId} — joining`, this.index);
                this.joinChannel(monitorChannelId);
            }
        });
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            if (!voiceRadar.enabled) return;
            const vrMonitorAllowed = voiceRadar.monitorBots.length === 0 || voiceRadar.monitorBots.includes(this.index);
            if (!vrMonitorAllowed) return;
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;
            const chId = newState.channelId || oldState.channelId;
            if (!chId || !voiceRadar.channels[chId]) return;
            const ch = voiceRadar.channels[chId];
            const events = [];
            if (!oldState.channelId && newState.channelId) {
                events.push({ type: 'join', user: member.user.tag || member.user.username, userId: member.id });
                if (newState.selfVideo) events.push({ type: 'video_on', user: member.user.tag || member.user.username, userId: member.id });
                if (newState.selfStream) events.push({ type: 'stream_on', user: member.user.tag || member.user.username, userId: member.id });
            } else if (oldState.channelId && !newState.channelId) {
                events.push({ type: 'leave', user: member.user.tag || member.user.username, userId: member.id });
            } else if (oldState.channelId && newState.channelId && oldState.channelId !== newState.channelId) {
                events.push({ type: 'move', user: member.user.tag || member.user.username, userId: member.id, from: oldState.channel?.name || oldState.channelId, to: newState.channel?.name || newState.channelId });
            }
            if (oldState.mute !== newState.mute) events.push({ type: newState.mute ? 'mute' : 'unmute', user: member.user.tag || member.user.username, userId: member.id });
            if (oldState.deaf !== newState.deaf) events.push({ type: newState.deaf ? 'deaf' : 'undeaf', user: member.user.tag || member.user.username, userId: member.id });
            if (!oldState.selfVideo && newState.selfVideo) events.push({ type: 'video_on', user: member.user.tag || member.user.username, userId: member.id });
            if (oldState.selfVideo && !newState.selfVideo) events.push({ type: 'video_off', user: member.user.tag || member.user.username, userId: member.id });
            if (!oldState.selfStream && newState.selfStream) events.push({ type: 'stream_on', user: member.user.tag || member.user.username, userId: member.id });
            if (oldState.selfStream && !newState.selfStream) events.push({ type: 'stream_off', user: member.user.tag || member.user.username, userId: member.id });
            for (const evt of events) {
                voiceRadar.logEvent(chId, evt);
                addLog(`[VoiceRadar] ${evt.user} ${evt.type} in ${ch.channelName}`, this.index);
            }
        });
        this.client.on('messageCreate', (msg) => {
            if (!msg.author || msg.author.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[msg.author.id]) {
                const shouldNotify = watchlist.logEvent(msg.author.id, 'messages', { content: msg.content?.slice(0, 200), channel: msg.channel?.name || msg.channelId, guild: msg.guild?.name || 'DM' });
                if (shouldNotify) addLog(`[Radar] ${msg.author.tag}: ${msg.content?.slice(0, 80)}`, this.index);
            }
            const entry = {
                id: msg.id,
                from: msg.author.tag || msg.author.username,
                fromId: msg.author.id,
                content: msg.content || '',
                channel: msg.channel?.name || msg.channel?.id || 'DM',
                channelId: msg.channel?.id,
                guild: msg.guild?.name || 'DM',
                guildId: msg.guild?.id,
                timestamp: msg.createdTimestamp,
                time: new Date(msg.createdTimestamp).toLocaleTimeString(),
                attachments: (msg.attachments || []).size || 0,
                dm: !msg.guild,
            };
            this.messages.unshift(entry);
            if (this.messages.length > 100) this.messages.pop();
        });
        this.client.on('messageUpdate', (oldMsg, newMsg) => {
            if (!newMsg.author || newMsg.author.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[newMsg.author.id]) {
                const shouldNotify = watchlist.logEvent(newMsg.author.id, 'edits', { before: oldMsg.content?.slice(0, 100), after: newMsg.content?.slice(0, 100), channel: newMsg.channel?.name || newMsg.channelId });
                if (shouldNotify) addLog(`[Radar] ${newMsg.author.tag} edited in #${newMsg.channel?.name}`, this.index);
            }
        });
        this.client.on('messageDelete', (msg) => {
            if (!msg.author || msg.author.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[msg.author.id]) {
                const shouldNotify = watchlist.logEvent(msg.author.id, 'deletes', { content: msg.content?.slice(0, 100), channel: msg.channel?.name || msg.channelId });
                if (shouldNotify) addLog(`[Radar] ${msg.author.tag} deleted in #${msg.channel?.name}`, this.index);
            }
        });
        this.client.on('typingStart', (typing) => {
            if (!typing.user || typing.user.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[typing.user.id]) {
                watchlist.logEvent(typing.user.id, 'typing', { channel: typing.channel?.name || typing.channelId });
            }
        });
        this.client.on('messageReactionAdd', (reaction, user) => {
            if (!user || user.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[user.id]) {
                const emoji = reaction.emoji?.name || reaction.emoji?.id || '?';
                const shouldNotify = watchlist.logEvent(user.id, 'reactions', { action: 'add', emoji, message: reaction.message?.content?.slice(0, 100), channel: reaction.message?.channel?.name || reaction.message?.channelId });
                if (shouldNotify) addLog(`[Radar] ${user.tag} reacted ${emoji}`, this.index);
            }
        });
        this.client.on('messageReactionRemove', (reaction, user) => {
            if (!user || user.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (monitorAllowed && watchlist.users[user.id]) {
                const emoji = reaction.emoji?.name || reaction.emoji?.id || '?';
                watchlist.logEvent(user.id, 'reactions', { action: 'remove', emoji, message: reaction.message?.content?.slice(0, 100), channel: reaction.message?.channel?.name || reaction.message?.channelId });
            }
        });
        this.client.on('voiceStateUpdate', (oldState, newState) => {
            const member = newState.member || oldState.member;
            if (!member || member.user.bot) return;
            if (!watchlist.enabled) return;
            const monitorAllowed = watchlist.monitorBots.length === 0 || watchlist.monitorBots.includes(this.index);
            if (!monitorAllowed || !watchlist.users[member.id]) return;
            const oldCh = oldState.channel?.name || oldState.channelId;
            const newCh = newState.channel?.name || newState.channelId;
            if (!oldCh && newCh) {
                watchlist.logEvent(member.id, 'voice', { action: 'joined', channel: newCh, guild: newState.guild?.name || '' });
            } else if (oldCh && !newCh) {
                watchlist.logEvent(member.id, 'voice', { action: 'left', channel: oldCh, guild: oldState.guild?.name || '' });
            } else if (oldCh && newCh && oldCh !== newCh) {
                watchlist.logEvent(member.id, 'voice', { action: 'moved', channel: `${oldCh} \u2192 ${newCh}`, guild: newState.guild?.name || '' });
            }
        });
        this.client.on('messageCreate', (msg) => {
            if (!msg.author || msg.author.bot) return;
            if (msg.guild) return;
            this.dms.unshift({
                id: msg.id,
                from: msg.author.tag || msg.author.username,
                fromId: msg.author.id,
                content: msg.content || '',
                time: new Date(msg.createdTimestamp).toLocaleTimeString(),
                timestamp: msg.createdTimestamp,
                attachments: (msg.attachments || []).size || 0,
            });
            if (this.dms.length > 50) this.dms.pop();
        });
        this.client.login(this.token).catch(e => addLog(`[${this.index+1}] Login failed: ${e.message}`, this.index));
    }
    _startSilence(connection) {
        const SILENCE_FRAME = Buffer.from([0xf8, 0xff, 0xfe]);
        const makeSilence = () => new Readable({ read() { this.push(SILENCE_FRAME); } });
        const player = createAudioPlayer();
        const play = () => { try { player.play(createAudioResource(makeSilence())); } catch {} };
        connection.subscribe(player);
        play();
        if (this._silenceInterval) clearInterval(this._silenceInterval);
        this._silenceInterval = setInterval(() => {
            if (connection.state.status === VoiceConnectionStatus.Ready) play();
        }, 50000);
    }
    _stopSilence() { if (this._silenceInterval) { clearInterval(this._silenceInterval); this._silenceInterval = null; } }
    async joinVC() {
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) { addLog(`[${this.index+1}] Guild not found`, this.index); return; }
        const channel = guild.channels.cache.get(this.channelId);
        if (!channel) { addLog(`[${this.index+1}] Voice channel not found`, this.index); return; }
        try {
            if (this.connection) { this._stopSilence(); try { this.connection.destroy(); } catch {} this.connection = null; }
            this.connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfMute: this.muted,
                selfDeaf: this.deafened,
                group: "bot-" + this.index,
                leaveOnEmpty: false,
                leaveOnEnd: false,
                leaveOnIdle: false,
            });
            this._startSilence(this.connection);
            this.inVoice = true;
            this.channelName = channel.name;
            addLog(`[${this.index+1}] Joined: ${channel.name}`, this.index);
        } catch (err) { addLog(`[${this.index+1}] Failed to join: ${err.message}`, this.index); }
    }
    async joinChannel(channelId) {
        let guild = this.guildId ? this.client.guilds.cache.get(this.guildId) : null;
        let channel = guild ? guild.channels.cache.get(channelId) : null;
        if (!channel) {
            for (const [, g] of this.client.guilds.cache) {
                const ch = g.channels.cache.get(channelId);
                if (ch) { channel = ch; guild = g; break; }
            }
        }
        if (!channel) return 'Channel not found';
        if (!this.guildId) { this.guildId = guild.id; this.guildName = guild.name; this.saveAccount(); }
        try {
            if (this.connection) { this._stopSilence(); try { this.connection.destroy(); } catch {} this.connection = null; }
            this.connection = joinVoiceChannel({
                channelId: channel.id,
                guildId: channel.guild.id,
                adapterCreator: channel.guild.voiceAdapterCreator,
                selfMute: this.muted,
                selfDeaf: this.deafened,
                group: "bot-" + this.index,
                leaveOnEmpty: false,
                leaveOnEnd: false,
                leaveOnIdle: false,
            });
            this._startSilence(this.connection);
            this.inVoice = true;
            this.channelId = channelId;
            this.channelName = channel.name;
            addLog(`[${this.index+1}] Joined: ${channel.name}`, this.index);
            return 'ok';
        } catch (err) { return err.message; }
    }
    leaveVC() {
        this._stopSilence();
        if (this.connection) {
            try { this.connection.destroy(); } catch {}
            this.connection = null;
        }
        this.inVoice = false;
        this.channelName = null;
        addLog(`[${this.index+1}] Left voice`, this.index);
    }
    getVoiceChannels() {
        if (!this.guildId) return [];
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) return [];
        return guild.channels.cache
            .filter(c => c.type === 2 || c.type === 'GUILD_VOICE')
            .map(c => ({ id: c.id, name: c.name }));
    }
    getTextChannels() {
        if (!this.guildId) return [];
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) return [];
        return guild.channels.cache
            .filter(c => !c.isThread())
            .map(c => ({ id: c.id, name: c.name }));
    }
    async sendMessage(channelId, content) {
        const guild = this.client.guilds.cache.get(this.guildId);
        if (!guild) return 'Guild not found';
        const channel = guild.channels.cache.get(channelId);
        if (!channel) return 'Channel not found';
        try {
            await channel.send(content);
            addLog(`[${this.index+1}] Sent message to #${channel.name}`, this.index);
            return 'ok';
        } catch (err) { return err.message; }
    }
    setMute(val) {
        this.muted = val;
        if (this.connection) { try { this.connection.rejoin(); } catch {} }
        addLog(`[${this.index+1}] ${val ? 'Muted' : 'Unmuted'}`, this.index);
    }
    setDeaf(val) {
        this.deafened = val;
        if (this.connection) { try { this.connection.rejoin(); } catch {} }
        addLog(`[${this.index+1}] ${val ? 'Deafened' : 'Undeafened'}`, this.index);
    }
    setStream(val) {
        this.streaming = val;
        addLog(`[${this.index+1}] ${val ? 'Streaming ON' : 'Streaming OFF'}`, this.index);
    }
    setCam(val) {
        this.camera = val;
        addLog(`[${this.index+1}] ${val ? 'Camera ON' : 'Camera OFF'}`, this.index);
    }
    startSpam(channelId, content, interval) {
        this.stopSpam();
        this.spamInterval = setInterval(async () => {
            const guild = this.client.guilds.cache.get(this.guildId);
            if (!guild) return;
            const channel = guild.channels.cache.get(channelId);
            if (!channel) return;
            try { await channel.send(content); } catch {}
        }, interval);
        addLog(`[${this.index+1}] Spam started (#${channelId}, ${interval}ms)`, this.index);
    }
    stopSpam() {
        if (this.spamInterval) { clearInterval(this.spamInterval); this.spamInterval = null; }
    }
    setGuild(guildId) {
        this.guildId = guildId;
        this.guildName = this.client.guilds.cache.get(guildId)?.name || null;
        this.saveAccount();
    }
    setChannel(channelId) {
        this.channelId = channelId;
        this.saveAccount();
    }
    saveAccount() {
        const accounts = loadAccountsFile() || [];
        if (accounts[this.index]) {
            accounts[this.index].guildId = this.guildId || '';
            accounts[this.index].channelId = this.channelId || '';
            saveAccountsFile(accounts);
        }
    }
    async sendDM(userId, content) {
        try {
            const user = await this.client.users.fetch(userId);
            if (!user) return 'User not found';
            await user.send(content);
            addLog(`[${this.index+1}] DM sent to ${user.tag}`, this.index);
            return 'ok';
        } catch (err) { return err.message; }
    }
    async deleteDM(msgId) {
        try {
            const msg = await this.client.messages.fetch(msgId);
            if (!msg) return 'Message not found';
            await msg.delete();
            this.dms = this.dms.filter(m => m.id !== msgId);
            addLog(`[${this.index+1}] Deleted DM ${msgId}`, this.index);
            return 'ok';
        } catch (err) { return err.message; }
    }
    setSniper(targetUserId, channelId) {
        this.sniper = { targetUserId, channelId, active: true };
        addLog(`[${this.index+1}] Sniper set: watching ${targetUserId} in ${channelId}`, this.index);
    }
    clearSniper() {
        this.sniper = null;
        addLog(`[${this.index+1}] Sniper cleared`, this.index);
    }
    getGuilds() {
        return this.client.guilds.cache.map(g => ({ id: g.id, name: g.name }));
    }
    getGuildChannels(guildId) {
        const guild = this.client.guilds.cache.get(guildId);
        if (!guild) return { voice: [], text: [] };
        const voiceTypes = [2, 13, 'GUILD_VOICE', 'GUILD_STAGE_VOICE'];
        const voice = guild.channels.cache.filter(c => voiceTypes.includes(c.type)).map(c => ({ id: c.id, name: c.name }));
        const text = guild.channels.cache.filter(c => !voiceTypes.includes(c.type) && !c.isThread()).map(c => ({ id: c.id, name: c.name }));
        return { voice, text };
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
    const accounts = loadAccountsFile();
    if (accounts && accounts.length > 0) {
        addLog(`Loading ${accounts.length} tokens from accounts.json`, null);
        accounts.forEach((a, i) => {
            if (a.token) {
                addLog(`Loading bot #${i+1} from accounts.json`, null);
                const bot = new BotInstance(a.token, bots.length);
                bot.tokenVar = 'ACCOUNT_' + (i + 1);
                if (a.guildId) bot.guildId = a.guildId;
                if (a.channelId) bot.channelId = a.channelId;
                bots.push(bot);
            }
        });
        if (bots.length > 0) return;
    }
    const cfgPath = require('path').join(__dirname, 'config.json');
    if (fs.existsSync(cfgPath)) {
        addLog('Loading config.json', null);
        const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
        (cfg.bots || []).forEach((b, i) => {
            if (b.token && b.guildId && b.channelId) {
                addLog(`Loading bot #${i+1} from config`, null);
                const bot = new BotInstance(b.token, bots.length);
                bot.tokenVar = b.tokenVar || 'TOKEN_' + (bots.length + 1);
                if (b.muted) bot.muted = true;
                if (b.deafened) bot.deafened = true;
                if (b.streaming) bot.streaming = true;
                if (b.camera) bot.camera = true;
                bots.push(bot);
            }
        });
        return;
    }
    addLog('No accounts found in accounts.json — save tokens from dashboard', null);
}

function maskToken(t) {
    if (!t || t.length < 10) return '***';
    return t.slice(0, 6) + '...' + t.slice(-4);
}

function loadAccountsFile() {
    try {
        if (require('fs').existsSync(accountsFile)) {
            return JSON.parse(require('fs').readFileSync(accountsFile, 'utf8'));
        }
    } catch (e) { addLog(`Error reading accounts.json: ${e.message}`, null); }
    return null;
}

function saveAccountsFile(accounts) {
    try {
        require('fs').writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
        return true;
    } catch (e) { addLog(`Error saving accounts.json: ${e.message}`, null); return false; }
}

async function saveAndPushAccounts(accounts) {
    try {
        require('fs').writeFileSync(accountsFile, JSON.stringify(accounts, null, 2));
        addLog(`Saved ${accounts.length} accounts to accounts.json`, null);
        await pushToGitHub(accounts);
        return true;
    } catch (e) { addLog(`Error saving accounts: ${e.message}`, null); return false; }
}

async function pushToGitHub(accounts) {
    if (!GITHUB_TOKEN) { addLog('No GITHUB_TOKEN set, skipping push', null); return; }
    try {
        const https = require('https');
        const content = Buffer.from(JSON.stringify(accounts, null, 2)).toString('base64');
        const getSha = () => new Promise((resolve, reject) => {
            const opts = { hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}?ref=${GITHUB_DATA_BRANCH}`, headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'VC-KeepAlive' } };
            https.get(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).sha); } catch { resolve(null); } }); }).on('error', reject);
        });
        const sha = await getSha();
        const body = JSON.stringify({ message: 'Update accounts.json', content, branch: GITHUB_DATA_BRANCH, ...(sha ? { sha } : {}) });
        const push = () => new Promise((resolve, reject) => {
            const opts = { hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${GITHUB_FILE}`, method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'VC-KeepAlive', 'Content-Length': Buffer.byteLength(body) } };
            const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        await push();
        addLog('Pushed accounts.json to GitHub (data branch)', null);
    } catch (e) { addLog(`GitHub push failed: ${e.message}`, null); }
}

async function pushFileToGitHub(filename, data) {
    if (!GITHUB_TOKEN) return;
    try {
        const https = require('https');
        const content = Buffer.from(JSON.stringify(data, null, 2)).toString('base64');
        const getSha = () => new Promise((resolve, reject) => {
            const opts = { hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${filename}?ref=${GITHUB_DATA_BRANCH}`, headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'VC-KeepAlive' } };
            https.get(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { try { resolve(JSON.parse(d).sha); } catch { resolve(null); } }); }).on('error', reject);
        });
        const sha = await getSha();
        const body = JSON.stringify({ message: `Update ${filename}`, content, branch: GITHUB_DATA_BRANCH, ...(sha ? { sha } : {}) });
        const push = () => new Promise((resolve, reject) => {
            const opts = { hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${filename}`, method: 'PUT', headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'Content-Type': 'application/json; charset=utf-8', 'User-Agent': 'VC-KeepAlive', 'Content-Length': Buffer.byteLength(body) } };
            const req = https.request(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => resolve(d)); });
            req.on('error', reject);
            req.write(body);
            req.end();
        });
        await push();
    } catch (e) { addLog(`GitHub push ${filename} failed: ${e.message}`, null); }
}

function accountsToText(accounts) {
    return accounts.map(a => a.token).join('\n');
}

function textToAccounts(text) {
    return text.split('\n').filter(l => l.trim() && !l.startsWith('#')).map(line => {
        return { token: line.trim() };
    }).filter(a => a.token);
}

function serveStatus(res) {
    res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
    res.end(JSON.stringify({
        bots: bots.map((b, i) => ({
            connected: b.connected, inVoice: b.inVoice,
            muted: b.muted, deafened: b.deafened,
            streaming: b.streaming, camera: b.camera,
            stopped: b.stopped || false,
            user: b.user, guildName: b.guildName, channelName: b.channelName,
            guildId: b.guildId, channelId: b.channelId,
            token: maskToken(b.token),
            tokenVar: b.tokenVar || 'TOKEN_' + (i + 1),
            index: i,
            streamUrl: b.streamUrl || '',
        })),
        logs: allLogs
    }));
}

function handleCORS(res) {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
}

function readBody(req) {
    return new Promise((resolve) => {
        let body = '';
        req.on('data', c => body += c);
        req.on('end', () => resolve(body));
    });
}

const server = http.createServer(async (req, res) => {
    const parsed = url.parse(req.url, true);
    const p = parsed.pathname;
    const q = parsed.query;
    handleCORS(res);
    if (req.method === 'OPTIONS') return res.end();
    if (p === '/status') return serveStatus(res);
    if (p === '/accounts' && req.method === 'GET') {
        const accounts = loadAccountsFile() || [];
        const text = accountsToText(accounts);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
        return res.end(text);
    }
    if (p === '/accounts' && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const accounts = textToAccounts(body);
            const oldTokens = bots.map(b => b.token);
            const newTokens = accounts.map(a => a.token);
            const removed = oldTokens.filter(t => !newTokens.includes(t));
            const added = newTokens.filter(t => !oldTokens.includes(t));
            removed.forEach(t => {
                const idx = bots.findIndex(b => b.token === t);
                if (idx !== -1) { addLog(`Removing bot #${idx + 1}`, idx); bots[idx].destroy(); bots.splice(idx, 1); }
            });
            await saveAndPushAccounts(accounts);
            added.forEach(t => {
                const bot = new BotInstance(t, bots.length);
                bot.tokenVar = 'ACCOUNT_' + (bots.length + 1);
                const acct = accounts.find(a => a.token === t);
                if (acct?.guildId) bot.guildId = acct.guildId;
                if (acct?.channelId) bot.channelId = acct.channelId;
                bots.push(bot);
                addLog(`Added bot #${bots.length}`, bots.length - 1);
            });
            return res.end('ok');
        } catch (e) { return res.end('error: ' + e.message); }
        return res.end('error');
    }
    if (p === '/accounts/download') {
        const accounts = loadAccountsFile() || [];
        const text = accountsToText(accounts);
        res.writeHead(200, { 'Content-Type': 'text/plain', 'Content-Disposition': 'attachment; filename=accounts.txt', 'Access-Control-Allow-Origin': '*' });
        return res.end(text);
    }
    if (p === '/presence-config') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ bots: bots.map(b => ({ index: bots.indexOf(b), userId: b.client?.user?.id, presence: b.presence || null })) }));
    }
    const mReconn = p.match(/^\/reconnect\/(\d+)$/);
    const mRestart = p.match(/^\/restart\/(\d+)$/);
    const mStop = p.match(/^\/stop\/(\d+)$/);
    const mMute = p.match(/^\/mute\/(\d+)\/(\d+)$/);
    const mDeaf = p.match(/^\/deaf\/(\d+)\/(\d+)$/);
    const mStream = p.match(/^\/stream\/(\d+)\/(\d+)$/);
    const mCam = p.match(/^\/cam\/(\d+)\/(\d+)$/);
    const mJoinChannel = p.match(/^\/join\/(\d+)\/(\d+)$/);
    const mLeave = p.match(/^\/leave\/(\d+)$/);
    const mChannels = p.match(/^\/channels\/(\d+)$/);
    const mTextChannels = p.match(/^\/textchannels\/(\d+)$/);
    const mMessage = p.match(/^\/message\/(\d+)\/(\d+)$/);
    const mSpamStart = p.match(/^\/spam\/start\/(\d+)\/(\d+)$/);
    const mSpamStop = p.match(/^\/spam\/stop\/(\d+)$/);
    const mGuilds = p.match(/^\/guilds\/(\d+)$/);
    const mGuildChannels = p.match(/^\/guildchannels\/(\d+)\/(\d+)$/);
    const mSetGuild = p.match(/^\/setguild\/(\d+)\/(\d+)$/);
    const mSendDM = p.match(/^\/dm\/(\d+)$/);
    const mDMs = p.match(/^\/dms\/(\d+)$/);
    const mDeleteDM = p.match(/^\/dm\/delete\/(\d+)\/(\d+)$/);
    const mSniperSet = p.match(/^\/sniper\/(\d+)$/);
    const mSniperClear = p.match(/^\/sniper\/clear\/(\d+)$/);
    const mStreamUrl = p.match(/^\/streamurl\/(\d+)$/);
    const mWatchlist = p === '/api/watchlist';
    const mWatchlistAdd = p === '/api/watchlist/add';
    const mWatchlistRemove = p.match(/^\/api\/watchlist\/remove\/(\d+)$/);
    const mWatchlistPreset = p === '/api/watchlist/preset';
    const mWatchlistOverride = p === '/api/watchlist/override';
    const mWatchlistLogs = p.match(/^\/api\/watchlist\/logs\/(\d+)$/);
    const mWatchlistClear = p === '/api/watchlist/clear';
    const mWatchlistMonitorBots = p === '/api/watchlist/monitorbots';
    const mWatchlistExport = p === '/api/watchlist/export';
    const mWatchlistImport = p === '/api/watchlist/import';
    const mRadarToggle = p === '/api/watchlist/toggle';
    const mVoiceRadarToggle = p === '/api/voiceradar/toggle';
    const mVoiceRadarMonitorBots = p === '/api/voiceradar/monitorbots';
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
    if (mJoinChannel) {
        const idx=+mJoinChannel[1], cid=mJoinChannel[2];
        if (bots[idx]) { const r = await bots[idx].joinChannel(cid); return res.end(r); }
        return res.end('bot not found');
    }
    if (mLeave) {
        const idx=+mLeave[1];
        if (bots[idx]) { bots[idx].leaveVC(); return res.end('ok'); }
        return res.end('bot not found');
    }
    if (mChannels) {
        const idx=+mChannels[1];
        if (bots[idx]) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify(bots[idx].getVoiceChannels()));
        }
        return res.end('[]');
    }
    if (mTextChannels) {
        const idx=+mTextChannels[1];
        if (bots[idx]) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify(bots[idx].getTextChannels()));
        }
        return res.end('[]');
    }
    if (mMessage && req.method === 'POST') {
        const idx=+mMessage[1], cid=mMessage[2];
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (bots[idx] && data.content) {
                const r = await bots[idx].sendMessage(cid, data.content);
                return res.end(r);
            }
        } catch {}
        return res.end('error');
    }
    if (mSpamStart && req.method === 'POST') {
        const idx=+mSpamStart[1], cid=mSpamStart[2];
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (bots[idx] && data.content && data.interval) {
                bots[idx].startSpam(cid, data.content, data.interval);
                return res.end('ok');
            }
        } catch {}
        return res.end('error');
    }
    if (mSpamStop) {
        const idx=+mSpamStop[1];
        if (bots[idx]) { bots[idx].stopSpam(); return res.end('ok'); }
        return res.end('bot not found');
    }
    if (mGuilds) {
        const idx=+mGuilds[1];
        if (bots[idx]) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify(bots[idx].getGuilds()));
        }
        return res.end('[]');
    }
    if (mGuildChannels) {
        const idx=+mGuildChannels[1], gid=mGuildChannels[2];
        if (bots[idx]) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify(bots[idx].getGuildChannels(gid)));
        }
        return res.end('{"voice":[],"text":[]}');
    }
    if (mSetGuild) {
        const idx=+mSetGuild[1], gid=mSetGuild[2];
        if (bots[idx]) {
            bots[idx].setGuild(gid);
            addLog(`[${idx+1}] Set guild to ${gid}`, idx);
            return res.end('ok');
        }
        return res.end('bot not found');
    }
    if (mSendDM && req.method === 'POST') {
        const idx=+mSendDM[1];
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (bots[idx] && data.userId && data.content) {
                const r = await bots[idx].sendDM(data.userId, data.content);
                return res.end(r);
            }
        } catch {}
        return res.end('error');
    }
    if (mDMs) {
        const idx=+mDMs[1];
        if (bots[idx]) {
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify(bots[idx].dms || []));
        }
        return res.end('[]');
    }
    if (mDeleteDM) {
        const idx=+mDeleteDM[1], msgId=mDeleteDM[2];
        if (bots[idx]) {
            const r = await bots[idx].deleteDM(msgId);
            return res.end(r);
        }
        return res.end('bot not found');
    }
    if (mSniperSet && req.method === 'POST') {
        const idx=+mSniperSet[1];
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (bots[idx] && data.targetUserId && data.channelId) {
                bots[idx].setSniper(data.targetUserId, data.channelId);
                return res.end('ok');
            }
        } catch {}
        return res.end('error');
    }
    if (mSniperClear) {
        const idx=+mSniperClear[1];
        if (bots[idx]) { bots[idx].clearSniper(); return res.end('ok'); }
        return res.end('bot not found');
    }
    if (mStreamUrl && req.method === 'POST') {
        const idx=+mStreamUrl[1];
        const body = await readBody(req);
        try {
            const data = JSON.parse(body);
            if (bots[idx] && data.url !== undefined) {
                bots[idx].streamUrl = data.url;
                addLog(`[${idx+1}] Stream URL set`, idx);
                return res.end('ok');
            }
        } catch {}
        return res.end('error');
    }
    if (mWatchlist) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', data: watchlist.getWatchlist(), globalPreset: watchlist.globalPreset, globalOverridesEnabled: watchlist.globalOverridesEnabled, monitorBots: watchlist.monitorBots, enabled: watchlist.enabled, botCount: bots.length }));
    }
    if (mRadarToggle && req.method === 'POST') {
        const enabled = watchlist.toggleEnabled();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', enabled }));
    }
    if (mVoiceRadarToggle && req.method === 'POST') {
        const enabled = voiceRadar.toggleEnabled();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', enabled }));
    }
    if (mVoiceRadarMonitorBots && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { indices } = JSON.parse(body);
            voiceRadar.setMonitorBots(indices || []);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ status: 'success' }));
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistAdd && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { userId, label } = JSON.parse(body);
            if (!userId) return res.end('{"status":"error","message":"User ID required"}');
            const user = watchlist.addUser(userId, label);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ status: 'success', data: user }));
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistRemove) {
        const uid = mWatchlistRemove[1];
        const ok = watchlist.removeUser(uid);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: ok ? 'success' : 'error', message: ok ? 'Removed' : 'Not found' }));
    }
    if (mWatchlistPreset && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { preset, userId } = JSON.parse(body);
            if (userId) watchlist.setUserPreset(userId, preset);
            else watchlist.setGlobalPreset(preset);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistOverride && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { userId, type, enabled, notify } = JSON.parse(body);
            watchlist.setOverride(userId, type, enabled, notify);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistLogs) {
        const uid = mWatchlistLogs[1];
        const limit = parseInt(q.limit) || 50;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', data: watchlist.getUserLogs(uid, limit) }));
    }
    if (mWatchlistClear && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { userId } = JSON.parse(body);
            watchlist.clearLogs(userId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistMonitorBots && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { indices } = JSON.parse(body);
            watchlist.monitorBots = Array.isArray(indices) ? indices : [];
            watchlist.save();
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (mWatchlistExport) {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', data: watchlist.exportData() }));
    }
    if (mWatchlistImport && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { data } = JSON.parse(body);
            watchlist.importData(data);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (p === '/api/voiceradar' && req.method === 'GET') {
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', channels: voiceRadar.getChannels(), enabled: voiceRadar.enabled, monitorBots: voiceRadar.monitorBots, botCount: bots.length }));
    }
    if (p === '/api/voiceradar/add' && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { channelId, guildName, channelName } = JSON.parse(body);
            if (!channelId) return res.end('{"status":"error","message":"Channel ID required"}');
            const ch = voiceRadar.addChannel(channelId, guildName || 'Unknown', channelName || channelId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end(JSON.stringify({ status: 'success', data: ch }));
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    if (p.match(/^\/api\/voiceradar\/remove\/[\w-]+$/) && req.method === 'DELETE') {
        const chId = p.split('/').pop();
        voiceRadar.removeChannel(chId);
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end('{"status":"success"}');
    }
    if (p.match(/^\/api\/voiceradar\/logs\/[\w-]+$/) && req.method === 'GET') {
        const chId = p.split('/').pop();
        const limit = parseInt(q.limit) || 100;
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
        return res.end(JSON.stringify({ status: 'success', data: voiceRadar.getLogs(chId, limit) }));
    }
    if (p === '/api/voiceradar/clear' && req.method === 'POST') {
        const body = await readBody(req);
        try {
            const { channelId } = JSON.parse(body);
            voiceRadar.clearLogs(channelId);
            res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8', 'Access-Control-Allow-Origin': '*' });
            return res.end('{"status":"success"}');
        } catch (e) { return res.end('{"status":"error","message":"' + e.message + '"}'); }
    }
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    res.end(require('fs').readFileSync(require('path').join(__dirname, 'dashboard.html'), 'utf8'));
});

process.on('uncaughtException', e => {
    try { addLog(`Server error: ${e.message}`, null); } catch {}
});
process.on('unhandledRejection', e => {
    try { addLog(`Server reject: ${e.message}`, null); } catch {}
});
server.listen(PORT, () => console.log('Web panel on port ' + PORT));
async function startupPull() {
    const https = require('https');
    addLog(`Startup pull: GITHUB_TOKEN=${GITHUB_TOKEN ? 'SET' : 'MISSING'} GITHUB_REPO=${GITHUB_REPO}`, null);
    const pullFile = async (filename) => {
        if (!GITHUB_TOKEN) return;
        const fs = require('fs');
        const filePath = require('path').join(__dirname, filename);
        try {
            const data = await new Promise((resolve, reject) => {
                const opts = { hostname: 'api.github.com', path: `/repos/${GITHUB_REPO}/contents/${filename}?ref=${GITHUB_DATA_BRANCH}`, headers: { 'Authorization': `token ${GITHUB_TOKEN}`, 'User-Agent': 'VC-KeepAlive' } };
                https.get(opts, res => { let d = ''; res.on('data', c => d += c); res.on('end', () => { addLog(`Startup pull: ${filename} response ${res.statusCode}`, null); try { const j = JSON.parse(d); if (j.content) { resolve(Buffer.from(j.content, 'base64').toString('utf8')); } else { addLog(`Startup pull: ${filename} no content: ${d.substring(0, 100)}`, null); resolve(null); } } catch (e) { addLog(`Startup pull: ${filename} parse error: ${e.message}`, null); resolve(null); } }); }).on('error', (e) => { addLog(`Startup pull: ${filename} error: ${e.message}`, null); reject(e); });
            });
            if (data) {
                fs.writeFileSync(filePath, data);
                addLog(`Startup pull: ${filename} saved (${data.length} bytes)`, null);
            }
        } catch (e) { addLog(`Failed to pull ${filename}: ${e.message}`, null); }
    };
    await pullFile('accounts.json');
    await pullFile('voice-radar.json');
    await pullFile('watchlist.json');
    loadBots();
}
startupPull();
