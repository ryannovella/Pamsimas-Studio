@echo off
title Pamsimas Studio - Laporan Word Monev
cd /d "%~dp0"

echo ========================================================
echo   PAMSIMAS STUDIO - GENERATOR LAPORAN WORD MONEV
echo   Direktori: %CD%
echo ========================================================

:: Injeksi Gemini API Key dari file .env jika ada
if exist "%~dp0.env" (
    for /f "usebackq tokens=1,* delims==" %%i in ("%~dp0.env") do (
        if /i "%%i"=="GEMINI_API_KEY" set "GEMINI_API_KEY=%%j"
    )
)

:: Bersihkan proses di port 8501 jika ada sebelumnya
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8501" ^| findstr "LISTENING"') do (
    taskkill /f /pid %%a >nul 2>&1
)

:: Buka browser otomatis setelah 2 detik
start "" cmd /c "timeout /t 2 /nobreak >nul && start http://localhost:8501"

echo Memulai server aplikasi di http://localhost:8501 ...
echo Tekan Ctrl+C untuk menghentikan server.
echo.

python server.py
pause
