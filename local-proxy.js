const http = require('http');
const https = require('https');
const url = require('url');
const fs = require('fs');
const path = require('path');

const RAILWAY_URL = process.env.RAILWAY_URL || 'https://thisisarep-production.up.railway.app';
const PORT = 3000;

function proxyRequest(req, res, targetPath) {
    const u = new URL(RAILWAY_URL + targetPath);
    const mod = u.protocol === 'https:' ? https : http;
    let body = [];
    req.on('data', chunk => body.push(chunk));
    req.on('end', () => {
        const bodyBuf = Buffer.concat(body);
        const opts = {
            hostname: u.hostname,
            port: u.port || (u.protocol === 'https:' ? 443 : 80),
            path: u.pathname + u.search,
            method: req.method,
            timeout: 15000,
            headers: { 'Accept': 'application/json', 'Content-Length': bodyBuf.length, 'Content-Type': req.headers['content-type'] || 'application/json' },
        };
        let sent = false;
        const proxy = mod.request(opts, r => {
            let resBody = '';
            r.on('data', c => resBody += c);
            r.on('end', () => {
                if (sent) return;
                sent = true;
                res.writeHead(r.statusCode, {
                    'Content-Type': r.headers['content-type'] || 'text/plain',
                    'Access-Control-Allow-Origin': '*',
                });
                res.end(resBody);
            });
        });
        proxy.on('error', e => {
            if (sent) return;
            sent = true;
            res.writeHead(502, { 'Content-Type': 'text/plain', 'Access-Control-Allow-Origin': '*' });
            res.end('Proxy error: ' + e.message);
        });
        proxy.on('timeout', () => { proxy.destroy(); if (!sent) { sent = true; res.writeHead(504); res.end('Timeout'); } });
        proxy.write(bodyBuf);
        proxy.end();
    });
}

const server = http.createServer((req, res) => {
    const p = url.parse(req.url).pathname;
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', '*');
    if (req.method === 'OPTIONS') return res.end();

    if (p === '/' || p === '/index.html') {
        const dashboardHTML = fs.readFileSync(path.join(__dirname, 'dashboard.html'), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
        res.end(dashboardHTML);
        return;
    }

    proxyRequest(req, res, p);
});

server.listen(PORT, () => {
    console.log(`Local control panel: http://localhost:${PORT}`);
    console.log(`Proxying to: ${RAILWAY_URL}`);
});
