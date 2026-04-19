@echo off
REM ============================================================
REM  github-sync.bat
REM  One-click upload + update for the MIDSA Quote App repo.
REM
REM  Usage:
REM    github-sync.bat                     (auto-timestamped commit)
REM    github-sync.bat "your message"      (custom commit message)
REM
REM  First run -> initializes git, sets remote, pushes everything.
REM  Later runs -> stages any changes, commits, pushes.
REM
REM  Safety:
REM   - Respects .gitignore (node_modules, dist, .env are excluded).
REM   - Never force-pushes. Never deletes anything.
REM   - If the remote has diverged, rebases local commits on top and
REM     re-pushes. If rebase hits a conflict, it bails so you can fix.
REM ============================================================
setlocal EnableDelayedExpansion

REM ---- Always operate from the folder this .bat lives in --------
cd /d "%~dp0"

REM ---- Config --------------------------------------------------
set "REMOTE_URL=https://github.com/aningamatthew21-gif/Q2.git"
set "BRANCH=main"

echo.
echo ============================================================
echo   MIDSA Quote App  --  GitHub Sync
echo   Target: %REMOTE_URL%
echo   Branch: %BRANCH%
echo ============================================================
echo.

REM ---- Check git is available ----------------------------------
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Git is not installed or not on PATH.
    echo         Install Git from https://git-scm.com/download/win and try again.
    pause
    exit /b 1
)

REM ---- Timestamp for default commit message --------------------
for /f "usebackq delims=" %%i in (`powershell -NoProfile -Command "Get-Date -Format 'yyyy-MM-dd HH:mm:ss'"`) do set "NOW=%%i"

REM ---- Commit message: use arg if given, else timestamp --------
set "COMMIT_MSG=%~1"
if "%COMMIT_MSG%"=="" set "COMMIT_MSG=Auto sync %NOW%"

REM ---- Initialize repo if this is the first run ----------------
if not exist ".git" (
    echo [INFO] No git repo found. Initializing...
    git init
    if errorlevel 1 goto :fail
    git branch -M %BRANCH%
    git remote add origin %REMOTE_URL%
    if errorlevel 1 goto :fail
    echo [INFO] Repo initialized with remote "origin" -^> %REMOTE_URL%
    echo.
) else (
    echo [INFO] Existing git repo detected.
    REM Make sure origin is set to the right URL; fix if missing
    git remote get-url origin >nul 2>&1
    if errorlevel 1 (
        echo [INFO] Remote "origin" not set -- adding it now.
        git remote add origin %REMOTE_URL%
    )
)

REM ---- Stage everything (respects .gitignore) ------------------
echo [INFO] Staging changes (respecting .gitignore)...
git add -A
if errorlevel 1 goto :fail

REM ---- Show a quick summary of what will be committed ----------
echo.
echo ---------------  CHANGES TO BE COMMITTED  -------------------
git status --short
echo -------------------------------------------------------------
echo.

REM ---- Commit only if there is something staged ----------------
git diff --cached --quiet
if errorlevel 1 (
    echo [INFO] Committing: "%COMMIT_MSG%"
    git commit -m "%COMMIT_MSG%"
    if errorlevel 1 goto :fail
) else (
    echo [INFO] Nothing new to commit -- will still try to push in case local is ahead.
)

REM ---- Push -----------------------------------------------------
echo.
echo [INFO] Pushing to origin/%BRANCH%...
git push -u origin %BRANCH%
if not errorlevel 1 goto :done

echo.
echo [WARN] Push rejected. The remote likely has commits we don't have.
echo        Pulling with --rebase so nothing is overwritten...
git pull --rebase origin %BRANCH%
if errorlevel 1 (
    echo.
    echo [ERROR] Rebase hit a conflict. Resolve conflicts manually:
    echo           1. Edit the conflicted files
    echo           2. git add ^<files^>
    echo           3. git rebase --continue
    echo         Then re-run this script.
    pause
    exit /b 1
)

echo [INFO] Rebase clean. Pushing again...
git push -u origin %BRANCH%
if errorlevel 1 goto :fail

:done
echo.
echo ============================================================
echo   SUCCESS -- repo is in sync with GitHub.
echo   View it at: https://github.com/aningamatthew21-gif/Q2
echo ============================================================
echo.
pause
exit /b 0

:fail
echo.
echo [ERROR] A git command failed. See the messages above.
echo         Common causes:
echo           - Not authenticated. Run: git config --global credential.helper manager
echo             and sign in to GitHub when the credential prompt appears.
echo           - No internet connection.
echo           - Wrong remote URL -- current value:
git remote get-url origin 2>nul
echo.
pause
exit /b 1
