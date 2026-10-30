@echo off
setlocal
cd /d "%~dp0"

echo.
echo   高考顺 . 采集器扩展 - 安装助手
echo   ================================
echo.
echo   这是一个本地扩展：不需要应用商店、不需要登录、不联网。
echo.
echo   接下来会打开两个窗口：
echo     1. Chrome 的扩展管理页
echo     2. 扩展所在文件夹（tools\extension）
echo.
echo   在扩展管理页里：
echo     [1] 打开右上角「开发者模式」
echo     [2] 点「加载已解压的扩展程序」
echo     [3] 选中弹出的 tools\extension 文件夹
echo.
echo   装完刷新任意网页，右下角会出现「高考顺 · 采集器」。
echo.

start "" chrome "chrome://extensions"
start "" explorer "%~dp0tools\extension"

echo   扩展目录：%~dp0tools\extension
echo.
echo   提示：这个文件夹里只要 manifest.json 和 collector.js 两个文件，
echo         以后改了用户脚本，运行 node tools/build-extension.mjs 重新生成即可。
echo.
pause
