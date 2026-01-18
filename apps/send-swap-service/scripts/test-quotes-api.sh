#!/bin/bash
# Test script for Quote Creation API endpoint
# This script tests the POST /quotes endpoint with the correct request body

set -e

BASE_URL="${BASE_URL:-http://localhost:3004}"

echo "=== Testing Quote Creation API ==="
echo "Base URL: ${BASE_URL}"
echo ""

# Test 1: Create a quote with Chainflip (DIRECT swapper)
echo "Test 1: Creating quote with Chainflip (ETH -> BTC)"
echo "--------------------------------------------------------"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "sellAssetId": "eip155:1/slip44:60",
    "buyAssetId": "bip122:000000000019d6689c085ae165831e93/slip44:0",
    "sellAmountCryptoBaseUnit": "1000000000000000000",
    "receiveAddress": "bc1qtest123",
    "swapperName": "Chainflip",
    "expectedBuyAmountCryptoBaseUnit": "3000000",
    "sellAsset": { "symbol": "ETH", "name": "Ethereum", "precision": 18 },
    "buyAsset": { "symbol": "BTC", "name": "Bitcoin", "precision": 8 }
  }')

HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: ${HTTP_STATUS}"
echo "Response Body: ${BODY}" | head -c 500
echo ""

if [ "$HTTP_STATUS" -eq 201 ]; then
  echo "PASS: Quote created successfully (201)"
else
  echo "FAIL: Expected 201, got ${HTTP_STATUS}"
  exit 1
fi

echo ""

# Test 2: Create a quote with THORChain (SERVICE_WALLET swapper)
echo "Test 2: Creating quote with THORChain (ETH -> BTC)"
echo "--------------------------------------------------------"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "sellAssetId": "eip155:1/slip44:60",
    "buyAssetId": "bip122:000000000019d6689c085ae165831e93/slip44:0",
    "sellAmountCryptoBaseUnit": "1000000000000000000",
    "receiveAddress": "bc1qtest123",
    "swapperName": "THORChain",
    "expectedBuyAmountCryptoBaseUnit": "2900000",
    "sellAsset": { "symbol": "ETH", "name": "Ethereum", "precision": 18 },
    "buyAsset": { "symbol": "BTC", "name": "Bitcoin", "precision": 8 }
  }')

HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
BODY=$(echo "$RESPONSE" | sed '$d')

echo "HTTP Status: ${HTTP_STATUS}"
echo "Response Body: ${BODY}" | head -c 500
echo ""

if [ "$HTTP_STATUS" -eq 201 ]; then
  echo "PASS: Quote created successfully (201)"

  # Verify SERVICE_WALLET quote has gas overhead
  if echo "$BODY" | grep -q "gasOverheadBaseUnit"; then
    echo "PASS: Response includes gasOverheadBaseUnit"
  fi
else
  echo "FAIL: Expected 201, got ${HTTP_STATUS}"
  exit 1
fi

echo ""

# Test 3: Get a quote by ID
echo "Test 3: Getting quote by ID"
echo "--------------------------------------------------------"

# Extract quote ID from previous response
QUOTE_ID=$(echo "$BODY" | grep -o '"quoteId":"[^"]*"' | cut -d'"' -f4)

if [ -n "$QUOTE_ID" ]; then
  RESPONSE=$(curl -s -w "\n%{http_code}" -X GET "${BASE_URL}/quotes/${QUOTE_ID}")

  HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)
  BODY=$(echo "$RESPONSE" | sed '$d')

  echo "HTTP Status: ${HTTP_STATUS}"
  echo "Response Body: ${BODY}" | head -c 500
  echo ""

  if [ "$HTTP_STATUS" -eq 200 ]; then
    echo "PASS: Quote retrieved successfully (200)"
  else
    echo "FAIL: Expected 200, got ${HTTP_STATUS}"
    exit 1
  fi
else
  echo "SKIP: Could not extract quote ID from previous response"
fi

echo ""

# Test 4: Verify qrData in response
echo "Test 4: Verifying qrData format"
echo "--------------------------------------------------------"

RESPONSE=$(curl -s -X POST "${BASE_URL}/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "sellAssetId": "eip155:1/slip44:60",
    "buyAssetId": "bip122:000000000019d6689c085ae165831e93/slip44:0",
    "sellAmountCryptoBaseUnit": "2000000000000000000",
    "receiveAddress": "bc1qtest456",
    "swapperName": "Chainflip",
    "expectedBuyAmountCryptoBaseUnit": "6000000",
    "sellAsset": { "symbol": "ETH", "name": "Ethereum" },
    "buyAsset": { "symbol": "BTC", "name": "Bitcoin" }
  }')

if echo "$RESPONSE" | grep -q '"qrData":"ethereum:'; then
  echo "PASS: qrData contains ethereum: URI scheme"
else
  echo "FAIL: qrData missing or incorrect format"
  exit 1
fi

echo ""

# Test 5: Invalid swapper should fail
echo "Test 5: Testing invalid swapper rejection"
echo "--------------------------------------------------------"

RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "${BASE_URL}/quotes" \
  -H "Content-Type: application/json" \
  -d '{
    "sellAssetId": "eip155:1/slip44:60",
    "buyAssetId": "bip122:000000000019d6689c085ae165831e93/slip44:0",
    "sellAmountCryptoBaseUnit": "1000000000000000000",
    "receiveAddress": "bc1qtest123",
    "swapperName": "Zrx",
    "expectedBuyAmountCryptoBaseUnit": "3000000",
    "sellAsset": { "symbol": "ETH" },
    "buyAsset": { "symbol": "BTC" }
  }')

HTTP_STATUS=$(echo "$RESPONSE" | tail -n1)

if [ "$HTTP_STATUS" -eq 400 ]; then
  echo "PASS: Invalid swapper correctly rejected (400)"
else
  echo "FAIL: Expected 400 for invalid swapper, got ${HTTP_STATUS}"
fi

echo ""
echo "=== All Tests Completed ==="
