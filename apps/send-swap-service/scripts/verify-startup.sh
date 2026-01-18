#!/bin/bash
#
# Verification Script: Service Startup with All Chain Wallets
#
# This script helps verify that the send-swap-service starts successfully
# with all chain wallets properly initialized.
#
# Prerequisites:
# 1. Set MNEMONIC environment variable in the root .env file
# 2. Dependencies installed (yarn install from monorepo root)
# 3. Database available (docker compose up send-swap-db)
#
# Expected Startup Logs (in order):
# ===============================
# 1. "Initializing wallets..."
# 2. "Initializing HD wallet..."
# 3. "HD wallet initialized successfully (device: xxx)"
# 4. "Verifying address generation for all chain types..."
# 5. "EVM deposit address: 0x..."  (Ethereum/EVM chains)
# 6. "BTC deposit address: bc1..." (Bitcoin - SegWit format)
# 7. "ATOM deposit address: cosmos1..." (Cosmos SDK chains)
# 8. "Solana deposit address: ..." (Solana)
# 9. "Address generation verified for all chain types"
# 10. "All wallets initialized successfully"
# 11. "Send-swap service is running on: http://localhost:3004"
#
# Expected Cron Job Logs (every 30 seconds):
# ==========================================
# - "[DepositMonitorService] Starting deposit check..."
# - "[DepositMonitorService] No quotes to monitor" (if no active quotes)
#   OR "[DepositMonitorService] Found X quotes to monitor for deposits"
# - "[DepositMonitorService] Deposit check completed"
#
# These logs confirm the deposit monitoring cron job is running correctly.
#
# Verification Checklist:
# ======================
# [ ] Service starts without errors
# [ ] EVM address generated (0x prefix, 42 characters)
# [ ] BTC address generated (bc1 prefix for SegWit)
# [ ] ATOM address generated (cosmos1 prefix)
# [ ] Solana address generated (base58 encoded)
# [ ] Health endpoint responds: curl http://localhost:3004/health
# [ ] Cron job logs appear every 30 seconds (Starting deposit check...)
# [ ] Quote monitoring status logged (No quotes or Found X quotes)
#

set -e

echo "=========================================="
echo "Send-Swap-Service Startup Verification"
echo "=========================================="
echo ""

# Check if we're in the right directory
if [[ ! -f "package.json" ]] || [[ ! -d "src/wallet" ]]; then
    echo "Error: Please run this script from apps/send-swap-service directory"
    exit 1
fi

# Check for MNEMONIC in root .env
if [[ -f "../../.env" ]]; then
    if grep -q "^MNEMONIC=" ../../.env && ! grep -q "^MNEMONIC=$" ../../.env; then
        echo "[OK] MNEMONIC found in root .env"
    else
        echo "[WARNING] MNEMONIC is not set or empty in ../../.env"
        echo "         Please set MNEMONIC=<your-12-or-24-word-phrase>"
    fi
else
    echo "[WARNING] Root .env file not found"
    echo "         Create ../../.env with MNEMONIC=<your-mnemonic>"
fi

echo ""
echo "Starting service with wallet verification..."
echo "Press Ctrl+C to stop"
echo ""
echo "Look for these key log messages:"
echo "  - 'HD wallet initialized successfully'"
echo "  - 'EVM deposit address:'"
echo "  - 'BTC deposit address:'"
echo "  - 'ATOM deposit address:'"
echo "  - 'Solana deposit address:'"
echo "  - 'All wallets initialized successfully'"
echo ""
echo "After ~30 seconds, look for cron job logs:"
echo "  - 'Starting deposit check...'"
echo "  - 'No quotes to monitor' or 'Found X quotes to monitor'"
echo "  - 'Deposit check completed'"
echo ""
echo "=========================================="
echo ""

# Start the service
yarn start:dev
