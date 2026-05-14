set shell := ["sh", "-c"]

# 列出所有可用指令
default:
    @just --list

# 啟動開發 server（port 8080，預設不開瀏覽器）
dev:
    @echo "\033[36m[Nord] Running gfx-lab dev server...\033[0m"
    live-server --port 8080 .

# 觸發 live-server 重新載入（touch index.html）
refresh:
    @echo "\033[34m[Nord] Triggering workspace refresh...\033[0m"
    touch index.html

# 檢查工具版本
check:
    @live-server --version 2>&1 || true
    @just --version
