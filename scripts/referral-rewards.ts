import { PrismaClient as SwapPrismaClient } from '../apps/swap-service/node_modules/.prisma/client';
import { PrismaClient as UserPrismaClient } from '../apps/user-service/node_modules/.prisma/client';
import * as fs from 'fs';
import * as path from 'path';

type ReferralRewardDistribution = {
  id: string;
  name: string;
  startDate: Date;
  endDate: Date;
  createdAt: Date;
  rewards: ReferralReward[];
  totalVolume: string;
  totalFoxDistributed: string;
  safeTxData: SafeTransactionData;
};

type ReferralReward = {
  referralCode: string;
  ownerAddress: string;
  totalVolumeUsd: string;
  percentageOfTotal: string;
  foxReward: string;
  swapCount: number;
  uniqueReferees: number;
};

type SafeTransactionData = {
  to: string[];
  value: string[];
  data: string[];
  operation: number[];
};

const swapPrisma = new SwapPrismaClient();
const userPrisma = new UserPrismaClient();

const RFOX_STAKING_CONTRACT = process.env.RFOX_STAKING_CONTRACT || '0x...';

async function getFoxPriceUsd(): Promise<number> {
  return 0.10;
}

async function calculateReferralRewards(
  startDate: Date,
  endDate: Date,
  totalFoxToDistribute: number,
  distributionName: string,
): Promise<ReferralRewardDistribution> {
  console.log(`Calculating referral rewards from ${startDate.toISOString()} to ${endDate.toISOString()}`);
  console.log(`Total FOX to distribute: ${totalFoxToDistribute}`);

  const swaps = await swapPrisma.swap.findMany({
    where: {
      createdAt: {
        gte: startDate,
        lte: endDate,
      },
      referralCode: {
        not: null,
      },
      isReferralEligible: true,
      sellAmountUsd: {
        not: null,
      },
    },
    select: {
      referralCode: true,
      sellAmountUsd: true,
      sellAccountId: true,
    },
  });

  console.log(`Found ${swaps.length} eligible swaps with referral codes`);

  const referralStats = new Map<
    string,
    {
      totalVolumeUsd: number;
      swapCount: number;
      referees: Set<string>;
      ownerAddress?: string;
    }
  >();

  for (const swap of swaps) {
    if (!swap.referralCode || !swap.sellAmountUsd) continue;

    const volumeUsd = parseFloat(swap.sellAmountUsd);
    const existing = referralStats.get(swap.referralCode);

    if (existing) {
      existing.totalVolumeUsd += volumeUsd;
      existing.swapCount += 1;
      existing.referees.add(swap.sellAccountId);
    } else {
      referralStats.set(swap.referralCode, {
        totalVolumeUsd: volumeUsd,
        swapCount: 1,
        referees: new Set([swap.sellAccountId]),
      });
    }
  }

  const referralCodes = Array.from(referralStats.keys());
  const referralCodeData = await userPrisma.referralCode.findMany({
    where: {
      code: {
        in: referralCodes,
      },
    },
  });

  for (const codeData of referralCodeData) {
    const stats = referralStats.get(codeData.code);
    if (stats) {
      stats.ownerAddress = codeData.ownerAddress;
    }
  }

  const totalVolume = Array.from(referralStats.values()).reduce(
    (sum, stats) => sum + stats.totalVolumeUsd,
    0,
  );

  console.log(`Total referral volume: $${totalVolume.toFixed(2)}`);
  console.log(`Unique referral codes with volume: ${referralStats.size}`);

  const rewards: ReferralReward[] = [];
  const safeTxData: SafeTransactionData = {
    to: [],
    value: [],
    data: [],
    operation: [],
  };

  for (const [code, stats] of referralStats.entries()) {
    if (!stats.ownerAddress) {
      console.warn(`Warning: No owner address found for referral code ${code}`);
      continue;
    }

    const percentageOfTotal = totalVolume > 0 ? (stats.totalVolumeUsd / totalVolume) * 100 : 0;
    const foxReward = totalVolume > 0 ? (stats.totalVolumeUsd / totalVolume) * totalFoxToDistribute : 0;

    rewards.push({
      referralCode: code,
      ownerAddress: stats.ownerAddress,
      totalVolumeUsd: stats.totalVolumeUsd.toFixed(2),
      percentageOfTotal: percentageOfTotal.toFixed(4),
      foxReward: foxReward.toFixed(6),
      swapCount: stats.swapCount,
      uniqueReferees: stats.referees.size,
    });

    const foxRewardWei = BigInt(Math.floor(foxReward * 1e18));
    safeTxData.to.push(RFOX_STAKING_CONTRACT);
    safeTxData.value.push('0');
    safeTxData.data.push(
      `0x${encodeDepositFunctionData(stats.ownerAddress, foxRewardWei.toString())}`,
    );
    safeTxData.operation.push(0);
  }

  rewards.sort((a, b) => parseFloat(b.totalVolumeUsd) - parseFloat(a.totalVolumeUsd));

  const distribution: ReferralRewardDistribution = {
    id: `dist_${Date.now()}`,
    name: distributionName,
    startDate,
    endDate,
    createdAt: new Date(),
    rewards,
    totalVolume: totalVolume.toFixed(2),
    totalFoxDistributed: totalFoxToDistribute.toFixed(6),
    safeTxData,
  };

  return distribution;
}

function encodeDepositFunctionData(userAddress: string, amount: string): string {
  const functionSelector = '47e7ef24';
  const addressParam = userAddress.slice(2).padStart(64, '0');
  const amountParam = BigInt(amount).toString(16).padStart(64, '0');
  return `${functionSelector}${addressParam}${amountParam}`;
}

async function saveDistribution(distribution: ReferralRewardDistribution): Promise<void> {
  const outputDir = path.join(__dirname, '../distributions');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const filename = `${distribution.id}_${distribution.name.replace(/\s+/g, '_')}.json`;
  const filepath = path.join(outputDir, filename);

  fs.writeFileSync(filepath, JSON.stringify(distribution, null, 2));
  console.log(`Distribution saved to: ${filepath}`);
}

async function generateSafeTransactionFile(distributionId: string): Promise<void> {
  const distributionFile = path.join(__dirname, `../distributions/${distributionId}.json`);

  if (!fs.existsSync(distributionFile)) {
    throw new Error(`Distribution file not found: ${distributionFile}`);
  }

  const distribution: ReferralRewardDistribution = JSON.parse(
    fs.readFileSync(distributionFile, 'utf-8'),
  );

  const safeFile = path.join(
    __dirname,
    `../distributions/${distributionId}_safe_batch.json`,
  );

  fs.writeFileSync(safeFile, JSON.stringify(distribution.safeTxData, null, 2));
  console.log(`Safe transaction batch file saved to: ${safeFile}`);
  console.log(`\nTo execute this distribution:`);
  console.log(`1. Import the batch file into Safe UI`);
  console.log(`2. Review the ${distribution.rewards.length} transactions`);
  console.log(`3. Sign and execute the multisig transaction`);
}

async function printDistributionStats(distributionId: string): Promise<void> {
  const distributionFile = path.join(__dirname, `../distributions/${distributionId}.json`);

  if (!fs.existsSync(distributionFile)) {
    throw new Error(`Distribution file not found: ${distributionFile}`);
  }

  const distribution: ReferralRewardDistribution = JSON.parse(
    fs.readFileSync(distributionFile, 'utf-8'),
  );

  console.log('\n=== Distribution Summary ===');
  console.log(`Name: ${distribution.name}`);
  console.log(`Period: ${distribution.startDate} to ${distribution.endDate}`);
  console.log(`Total Volume: $${distribution.totalVolume}`);
  console.log(`Total FOX Distributed: ${distribution.totalFoxDistributed}`);
  console.log(`Number of Referrers: ${distribution.rewards.length}`);
  console.log('\n=== Top 10 Referrers ===');

  distribution.rewards.slice(0, 10).forEach((reward, index) => {
    console.log(`${index + 1}. ${reward.referralCode} (${reward.ownerAddress})`);
    console.log(`   Volume: $${reward.totalVolumeUsd} (${reward.percentageOfTotal}%)`);
    console.log(`   FOX Reward: ${reward.foxReward}`);
    console.log(`   Swaps: ${reward.swapCount} | Unique Referees: ${reward.uniqueReferees}`);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    switch (command) {
      case 'calculate': {
        const startDate = new Date(args[1]);
        const endDate = new Date(args[2]);
        const totalFox = parseFloat(args[3]);
        const name = args[4] || `Distribution ${startDate.toISOString().split('T')[0]}`;

        const distribution = await calculateReferralRewards(startDate, endDate, totalFox, name);
        await saveDistribution(distribution);
        await printDistributionStats(distribution.id);
        break;
      }

      case 'generate': {
        const distributionId = args[1];
        await generateSafeTransactionFile(distributionId);
        break;
      }

      case 'stats': {
        const distributionId = args[1];
        await printDistributionStats(distributionId);
        break;
      }

      default:
        console.log('Usage:');
        console.log('  calculate <start-date> <end-date> <total-fox> [name]');
        console.log('    Example: calculate 2024-01-01 2024-01-31 10000 "January 2024"');
        console.log('');
        console.log('  generate <distribution-id>');
        console.log('    Example: generate dist_1234567890');
        console.log('');
        console.log('  stats <distribution-id>');
        console.log('    Example: stats dist_1234567890');
        process.exit(1);
    }
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  } finally {
    await swapPrisma.$disconnect();
    await userPrisma.$disconnect();
  }
}

main();
