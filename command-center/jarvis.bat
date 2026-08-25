@echo off
color 0A
echo ==========================================
echo      🚀 INITIALIZING JARVIS SYSTEM...
echo ==========================================
timeout /t 1 >nul

echo [1/3] Waking up Node Backend...
start "Jarvis Backend" cmd /k "cd /d "F:\Jarvis 🤖\command-center\backend" && npm run dev"
timeout /t 2 >nul

echo [2/3] Starting Python Ears (Mic)...
start "Jarvis Ears" cmd /k "cd /d "F:\Jarvis 🤖\command-center\backend" && "F:\Jarvis 🤖\.venv\Scripts\python.exe" listener.py"
timeout /t 2 >nul

echo [3/3] Starting React Frontend...
:: 👇 Agar tera frontend kisi aur folder me hai, toh yeh path change kar lena
start "Jarvis UI" cmd /k "cd /d "F:\Jarvis 🤖\command-center\frontend" && npm run dev"

echo ==========================================
echo      ✅ ALL SYSTEMS ONLINE, BOSS!
echo ==========================================
timeout /t 3 >nul
exit