# DISABLED: continuous sync was removed for low-resource operation.
# Daily backup runs sync-service.mjs --once at 02:00 (and on startup catch-up if missed).
# This script is kept so any leftover scheduled task exits immediately without starting node.
$ErrorActionPreference = "Continue"
Write-Host "LegalMind continuous sync is DISABLED. Use: npm run dr:backup (daily one-shot)."
exit 0
