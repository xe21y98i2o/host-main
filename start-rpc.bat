@echo off
cd /d "%~dp0"
set RAILWAY_URL=https://host-production-1e7e.up.railway.app
node rpc-client.js
pause
