# Referral Rewards System

## Overview

The referral rewards system tracks swap volume from referred users and distributes FOX rewards to referrers through the RFOX staking pool.

## Architecture

### Database Schema

**user-service:**
- `ReferralCode`: Stores referral codes with owner addresses
- `ReferralUsage`: Tracks which addresses have used referral codes (one code per address)

**swap-service:**
- `Swap.referralCode`: Optional field to track which code was used for a swap
- `Swap.sellAmountUsd`: USD value at the time of the swap
- `Swap.isReferralEligible`: Boolean to exclude certain swaps from rewards

### API Endpoints

**POST /referrals/codes**
Create a new referral code
```json
{
  "code": "SHAPESHIFTER",
  "ownerAddress": "0x1234...",
  "maxUses": 100,
  "expiresAt": "2024-12-31T23:59:59Z"
}
```

**POST /referrals/use**
Apply a referral code to an address
```json
{
  "code": "SHAPESHIFTER",
  "refereeAddress": "0x5678..."
}
```

**GET /referrals/codes/:code**
Get referral code details including usage stats

**GET /referrals/owner/:ownerAddress**
Get all referral codes for an address

**GET /referrals/usage/:refereeAddress**
Check if an address has used a referral code

## Rewards Calculation

The rewards calculation script queries swap data for a given period and calculates volume-weighted FOX distributions.

### Usage

```bash
# Calculate rewards for a period
yarn referral-rewards calculate 2024-01-01 2024-01-31 10000 "January 2024"

# Generate Safe multisig transaction file
yarn referral-rewards generate dist_1234567890

# View distribution stats
yarn referral-rewards stats dist_1234567890
```

### Calculation Formula

For each referrer:
```
foxReward = (referrerVolume / totalVolume) * totalFoxDistributed
```

### Output Files

Distributions are saved to `distributions/` directory:
- `dist_xxxxx_Distribution_Name.json`: Full distribution data
- `dist_xxxxx_safe_batch.json`: Safe multisig transaction batch

### Safe Multisig Integration

The script generates a JSON file compatible with Safe's batch transaction interface:
1. Import the `*_safe_batch.json` file into Safe UI
2. Review the transactions (one deposit per referrer)
3. Sign and execute the multisig transaction

Each transaction calls the RFOX staking contract's deposit function with:
- User address (referrer's address)
- Amount in FOX wei (calculated reward amount)

## Environment Variables

```bash
RFOX_STAKING_CONTRACT=0x... # RFOX staking contract address
```

## Integration with Swap Flow

When a user makes a swap:
1. Frontend checks if user has used a referral code (GET /referrals/usage/:address)
2. If yes, include referral code in swap creation
3. Backend stores swap with referral code and USD value
4. Swap becomes eligible for rewards distribution

## Future Enhancements

- [ ] Automated price fetching for FOX and swap assets
- [ ] Multi-tier reward structures
- [ ] Time-based vesting periods
- [ ] Dashboard for referrers to track earnings
- [ ] Automated distribution scheduling
