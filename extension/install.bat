
@echo off
chcp 65001 >nul
setlocal enabledelayedexpansion
title KIM Extension Installer
:: Устанавливаем размер окна (ширина 85, высота 30) и цвет (белый на синем)
mode con: cols=85 lines=30
color 1F
cls

:: --- Логотип / Заголовок ---
echo.
echo   =================================================================================
echo   #                                                                               #
echo   #                KIM: KCS IFTTT Mass Mapper - INSTALLER                         #
echo   #                                                                               #
echo   =================================================================================
echo.
echo   Добро пожаловать в мастер установки.
echo.
echo   Этот скрипт автоматически:
echo    1. Надет файлы расширения.
echo    2. Скопирует их в системную папку.
echo    3. Подготовит путь для быстрой вставки.
echo    4. Откроет Chrome для завершения настройки.
echo.
echo   ---------------------------------------------------------------------------------
echo.
echo   Нажмите любую клавишу, чтобы начать установку...
pause >nul
cls

:: --- Шаг 1: Поиск файлов ---
echo.
echo   [1/5] Поиск исходных файлов...
timeout /t 1 >nul

set "SCRIPT_DIR=%~dp0"
if "%SCRIPT_DIR:~-1%"=="\" set "SCRIPT_DIR=%SCRIPT_DIR:~0,-1%"

set "SRC_DIR="
if exist "%SCRIPT_DIR%\manifest.json" (
  set "SRC_DIR=%SCRIPT_DIR%"
) else if exist "%SCRIPT_DIR%\KIM_Extension\manifest.json" (
  set "SRC_DIR=%SCRIPT_DIR%\KIM_Extension"
)

if not defined SRC_DIR goto :no_manifest
echo         [OK] Файлы найдены.
echo.

:: --- Шаг 2: Создание папок ---
echo   [2/5] Подготовка целевой папки...
timeout /t 1 >nul

set "DEST_ROOT=%LOCALAPPDATA%\KIM_Extension"
set "DEST_DIR=%DEST_ROOT%\KIM_Extension"

if not exist "%DEST_ROOT%" mkdir "%DEST_ROOT%" >nul 2>&1
echo         [OK] Папка создана.
echo.

:: --- Шаг 3: Копирование ---
echo   [3/5] Копирование файлов...
robocopy "%SRC_DIR%" "%DEST_DIR%" /MIR /R:1 /W:1 /NFL /NDL /NJH /NJS >nul

if not exist "%DEST_DIR%\manifest.json" goto :copy_fail
echo         [OK] Копирование завершено успешно.
echo.

:: --- Шаг 4: Буфер обмена ---
echo   [4/5] Сохранение пути в буфер обмена...
echo | set /p="%DEST_DIR%" | clip
echo         [OK] Путь скопирован! (Готов к Ctrl+V)
echo.

:: --- Шаг 5: Запуск Chrome ---
echo   [5/5] Запуск Chrome...
timeout /t 1 >nul
call :open_chrome

:: --- ФИНАЛЬНЫЙ ЭКРАН ---
cls
color 0A
:: Меняем цвет на зеленый, чтобы привлечь внимание к успеху
echo.
echo   =================================================================================
echo                                  УСТАНОВКА ЗАВЕРШЕНА!
echo   =================================================================================
echo.
echo   Мы сделали всё, что могли автоматически. Теперь ваша очередь:
echo.
echo   [ШАГ 1] В браузере (должен открыться) перейдите на страницу:
echo           chrome://extensions/
echo           (Если не открылась - скопируйте эту строку и вставьте в адресную строку)
echo.
echo   [ШАГ 2] В правом верхнем углу включите тумблер:
echo           [ Developer mode / Режим разработчика ]
echo.
echo   [ШАГ 3] Нажмите кнопку слева:
echo           [ Load unpacked / Загрузить распакованное ]
echo.
echo   [ШАГ 4] В открывшемся окне выбора папки:
echo           Нажмите Ctrl+V (Вставить), затем Enter.
echo.
echo   ---------------------------------------------------------------------------------
echo   Путь к папке уже находится в вашем буфере обмена.
echo   ---------------------------------------------------------------------------------
echo.
echo   Нажмите любую клавишу для выхода...
pause >nul
exit /b 0

:: --- ФУНКЦИИ ---

:open_chrome
set "CHROME_EXE="
for /f "tokens=2*" %%A in ('reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| find /i "REG_SZ"') do set "CHROME_EXE=%%B"
if not defined CHROME_EXE (
  for /f "tokens=2*" %%A in ('reg query "HKLM\Software\Microsoft\Windows\CurrentVersion\App Paths\chrome.exe" /ve 2^>nul ^| find /i "REG_SZ"') do set "CHROME_EXE=%%B"
)
if not defined CHROME_EXE (
  if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "CHROME_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
)
if defined CHROME_EXE (
  set "CHROME_EXE=%CHROME_EXE:"=%"
  start "" "%CHROME_EXE%" --new-window "chrome://extensions/"
)
exit /b

:no_manifest
color 4F
cls
echo.
echo   =================================================================================
echo                                     ОШИБКА
echo   =================================================================================
echo.
echo   Не найден файл manifest.json!
echo   Убедитесь, что install.bat лежит рядом с файлами расширения.
echo.
pause
exit /b 1

:copy_fail
color 4F
cls
echo.
echo   =================================================================================
echo                                     ОШИБКА
echo   =================================================================================
echo.
echo   Не удалось скопировать файлы.
echo   Возможно, папка занята или нет прав доступа.
echo.
pause
exit /b 2