import { WRAPPED_SOL_MINT } from "@jup-ag/core";
import { Environment, getConfig, MarginfiClient, MarginfiGroup, USDC_DECIMALS } from "@mrgnlabs/marginfi-client-v2";
import MarginfiAccount, { MarginRequirementType } from "@mrgnlabs/marginfi-client-v2/src/account";
import { PriceBias } from "@mrgnlabs/marginfi-client-v2/src/bank";
import { createSyncNativeInstruction } from "@mrgnlabs/mrgn-common/src/spl";
import { loadKeypair, nativeToUi, NodeWallet, sleep, uiToNative } from "@mrgnlabs/mrgn-common";
import { getOrca, Orca, OrcaPool, OrcaPoolConfig } from "@orca-so/sdk";
import { BN } from "@project-serum/anchor";
import { associatedAddress } from "@project-serum/anchor/dist/cjs/utils/token";
import { ASSOCIATED_TOKEN_PROGRAM_ID, Token, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Connection, LAMPORTS_PER_SOL, PublicKey, SystemProgram, Transaction } from "@solana/web3.js";
import BigNumber from "bignumber.js";
import Decimal from "decimal.js";

const DUST_THRESHOLD = new BigNumber(10).pow(USDC_DECIMALS - 2);
const USDC_MINT = new PublicKey("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SLEEP_INTERVAL = Number.parseInt(process.env.SLEEP_INTERVAL ?? "5000");
const MIN_SOL_BALANCE = Number.parseFloat(process.env.MIN_SOL_BALANCE ?? "1") * LAMPORTS_PER_SOL;

type OrcaPoolMap = Map<string, OrcaPool>;

class OrcaTrader {
  private poolMap: OrcaPoolMap;
  private orca: Orca;
  private wallet: NodeWallet;

  constructor(connection: Connection, wallet: NodeWallet) {
    this.wallet = wallet;
    this.orca = getOrca(connection);
    this.poolMap = OrcaTrader.buildOrcaPoolMap(this.orca);
  }

  async trade(
    inputMint: PublicKey,
    outputMint: PublicKey,
    amountIn: BN | BigNumber,
    minAmountOut: BN | BigNumber = new BigNumber(0)
  ) {
    const debug = getDebugLogger("orca-trader");

    debug("Trading %d %s for %s, min amount out", amountIn, inputMint.toBase58(), outputMint.toBase58(), minAmountOut);

    const pool = this.poolMap.get(getOrcaPoolKey(inputMint, outputMint));

    if (!pool) {
      throw new Error("No pool found");
    }

    let tokenA = pool.getTokenA();
    let tokenB = pool.getTokenB();

    const inputOrcaToken = tokenA.mint.equals(inputMint) ? tokenA : tokenB;

    let tx = await pool.swap(
      this.wallet.payer,
      inputOrcaToken,
      new Decimal(amountIn.toNumber()),
      new Decimal(minAmountOut.toNumber())
    );
    let sig = await tx.execute();

    debug("Tx signature: %s", sig);
  }

  private static buildOrcaPoolMap(orca: Orca): OrcaPoolMap {
    const debug = getDebugLogger("orca-trader");
    let map = new Map<string, OrcaPool>();

    Object.values(OrcaPoolConfig).forEach((poolAddress) => {
      let pool = orca.getPool(poolAddress);
      map.set(getOrcaPoolKey(pool.getTokenA().mint, pool.getTokenB().mint), pool);
    });

    debug("Build orcal pool map with %d pools", map.size);

    return map;
  }
}

function getOrcaPoolKey(keyA: PublicKey, keyB: PublicKey): string {
  const bigInt1 = BigInt("0x" + keyA.toBuffer().toString("hex"));
  const bigInt2 = BigInt("0x" + keyB.toBuffer().toString("hex"));

  return (bigInt1 + bigInt2).toString();
}

class Liquidator {
  connection: Connection;
  account: MarginfiAccount;
  group: MarginfiGroup;
  client: MarginfiClient;
  orcaTrader: OrcaTrader;
  wallet: NodeWallet;

  constructor(
    connection: Connection,
    account: MarginfiAccount,
    group: MarginfiGroup,
    client: MarginfiClient,
    wallet: NodeWallet
  ) {
    this.connection = connection;
    this.account = account;
    this.group = group;
    this.client = client;
    this.wallet = wallet;
    this.orcaTrader = new OrcaTrader(connection, wallet);
  }

  /**
   * 1. step of the account re-balancing

   * Withdraw all non-usdc deposits from account and sell them to usdc.
   * This step will only withdraw up until the free collateral threshold, if some collateral is tied up the bot will deposit
   * in a later stage the borrowed liabilities and usdc to untie the remaining collateral.
   */
  private async sellNonUsdcDeposits() {
    const debug = getDebugLogger("sell-non-usdc-deposits");
    debug("Starting non-usdc deposit sell step (1/3)");
    let balancesWithNonUsdcDeposits = this.account.activeBalances
      .map((balance) => {
        let bank = this.group.getBankByPk(balance.bankPk)!;
        let { assets } = balance.getQuantity(bank);

        return { assets, bank };
      })
      .filter(({ assets, bank }) => !bank.mint.equals(USDC_MINT) && assets.gt(DUST_THRESHOLD));

    for (let { bank } of balancesWithNonUsdcDeposits) {
      let maxWithdrawAmount = this.account.getMaxWithdrawForBank(bank);

      if (maxWithdrawAmount.eq(0)) {
        debug("No untied %s to withdraw", bank.label);
        continue;
      }

      debug("Withdrawing %d %s", maxWithdrawAmount, bank.label);
      let withdrawSig = await this.account.withdraw(maxWithdrawAmount, bank);

      debug("Withdraw tx: %s", withdrawSig);

      await this.account.reload();

      debug("Swapping %s to USDC", bank.mint);

      const balance = await this.getTokenAccountBalance(bank.mint);

      await this.orcaTrader.trade(bank.mint, USDC_MINT, balance);
    }
  }

  /**
   * 2. step of the account re-balancing
   *
   * At this stage we assume that the lending account has not more untied non-usdc collateral.
   * Only usdc collateral and liabilities are left.
   *
   * We first calculate the cost of paying down the liability in usdc, if we don't have enough usdc in the token account,
   * we withdraw any additional usdc we need from the lending account.
   *
   * We then buy liability with the usdc we have available and deposit the usdc and liability to the lending account.
   *
   * Depositing the liability should unlock any tied up collateral.
   *
   */
  private async repayAllDebt() {
    const debug = getDebugLogger("repay-all-debt");
    debug("Starting debt repayment step (2/3)");
    const balancesWithNonUsdcLiabilities = this.account.activeBalances
      .map((balance) => {
        let bank = this.group.getBankByPk(balance.bankPk)!;
        let { liabilities } = balance.getQuantity(bank);

        return { liabilities, bank };
      })
      .filter(({ liabilities, bank }) => liabilities.gt(DUST_THRESHOLD) && !bank.mint.equals(USDC_MINT));

    for (let { liabilities, bank } of balancesWithNonUsdcLiabilities) {
      debug("Repaying %d %s", nativeToUi(liabilities, bank.mintDecimals), bank.label);
      let availableUsdcInTokenAccount = await this.getTokenAccountBalance(USDC_MINT);

      await this.group.reload();
      const usdcBank = this.group.getBankByMint(USDC_MINT)!;
      await usdcBank.reloadPriceData(this.connection);
      const availableUsdcLiquidity = this.account.getMaxBorrowForBank(usdcBank);

      await bank.reloadPriceData(this.connection);
      const liabUsdcValue = bank.getLiabilityUsdValue(
        liabilities,
        MarginRequirementType.Equity,
        // We might need to use a Higher price bias to account for worst case scenario.
        PriceBias.None
      );

      // We can possibly withdraw some usdc from the lending account if we are short.
      let usdcBuyingPower = BigNumber.min(availableUsdcInTokenAccount, liabUsdcValue);
      const missingUsdc = liabUsdcValue.minus(usdcBuyingPower);

      if (missingUsdc.gt(0)) {
        const usdcToWithdraw = BigNumber.min(missingUsdc, availableUsdcLiquidity);
        debug("Withdrawing %d USDC", usdcToWithdraw);
        const withdrawSig = await this.account.withdraw(usdcToWithdraw, usdcBank);
        debug("Withdraw tx: %s", withdrawSig);
        await this.account.reload();
      }

      availableUsdcInTokenAccount = await this.getTokenAccountBalance(USDC_MINT);

      usdcBuyingPower = BigNumber.min(availableUsdcInTokenAccount, liabUsdcValue);

      debug("Swapping %d USDC to %s", usdcBuyingPower, bank.label);

      await this.orcaTrader.trade(USDC_MINT, bank.mint, usdcBuyingPower);

      if (bank.mint.equals(WRAPPED_SOL_MINT)) {
        debug("Asset is SOL, wrapping before depositing, min sol in wallet %s", nativeToUi(MIN_SOL_BALANCE, 9));
        const balance = await this.connection.getBalance(this.wallet.publicKey);
        const ataBalance = await this.getTokenAccountBalance(WRAPPED_SOL_MINT);

        const transferAmount = BigNumber.min(
          new BigNumber(Math.max(balance - MIN_SOL_BALANCE, 0)),
          liabilities.minus(new BigNumber(uiToNative(ataBalance, bank.mintDecimals).toString()))
        );

        debug("Wrapping %s SOL", nativeToUi(transferAmount, bank.mintDecimals));

        const ata = await associatedAddress({ mint: bank.mint, owner: this.wallet.publicKey });
        const ataAccount = await this.connection.getAccountInfo(ata);

        const tx = new Transaction();

        if (!ataAccount) {
          debug("Creatign WSOL ata account");
          tx.add(
            Token.createAssociatedTokenAccountInstruction(
              ASSOCIATED_TOKEN_PROGRAM_ID,
              TOKEN_PROGRAM_ID,
              WRAPPED_SOL_MINT,
              ata,
              this.wallet.publicKey,
              this.wallet.publicKey
            )
          );
        }

        tx.add(
          SystemProgram.transfer({
            fromPubkey: this.wallet.publicKey,
            toPubkey: ata,
            lamports: parseInt(transferAmount.toFixed(0, BigNumber.ROUND_FLOOR)),
          }),
          createSyncNativeInstruction(ata)
        );

        const sig = await this.client.processTransaction(tx, [this.wallet.payer]);

        debug("Wrapping tx: %s", sig);
      }

      const liabBalance = await this.getTokenAccountBalance(bank.mint);

      debug("Got %s of %s, depositing to marginfi", liabBalance, bank.mint);

      const depositSig = await this.account.repay(liabBalance, bank);
      debug("Deposit tx: %s", depositSig);
    }
  }

  /**
   * 3. step of the account re-balancing
   *
   * At this stage we assume that the lending account has not more untied non-usdc collateral, and we have repaid all liabilities
   * given our current purchasing power.
   *
   * We can now deposit the remaining usdc in the lending account to untie the collateral.
   *
   * Assuming everything went well the account should be balanced now, however if that is not the case
   * the re-balancing mechanism will start again.
   */
  private async depositRemainingUsdc() {
    const debug = getDebugLogger("deposit-remaining-usdc");
    debug("Starting remaining usdc deposit step (3/3)");

    const usdcBalance = await this.getTokenAccountBalance(USDC_MINT);

    const usdcBank = this.group.getBankByMint(USDC_MINT)!;
    const depositTx = await this.account.deposit(usdcBalance, usdcBank);
    debug("Deposit tx: %s", depositTx);
  }

  private async rebalancingStage() {
    const debug = getDebugLogger("rebalancing-stage");
    debug("Starting rebalancing stage");
    await this.sellNonUsdcDeposits();
    await this.repayAllDebt();
    await this.depositRemainingUsdc();
  }

  async start() {
    console.log("Starting liquidator");

    console.log("Liquidator account: %s", this.account.publicKey);
    console.log("Program id: %s", this.client.program.programId);
    console.log("Group: %s", this.group.publicKey);

    console.log("Start with DEBUG=mfi:* to see more logs");

    await this.mainLoop();
  }

  private async mainLoop() {
    const debug = getDebugLogger("main-loop");
    try {
      await this.swapNonUsdcInTokenAccounts();
      while (true) {
        debug("Started main loop iteration");
        if (await this.needsToBeRebalanced()) {
          await this.rebalancingStage();
          continue;
        }

        await this.liquidationStage();
      }
    } catch (e) {
      console.error(e);
      await sleep(SLEEP_INTERVAL);
      await this.mainLoop();
    }
  }

  private async getTokenAccountBalance(mint: PublicKey): Promise<BigNumber> {
    const tokenAccount = await associatedAddress({ mint, owner: this.wallet.publicKey });
    try {
      return new BigNumber((await this.connection.getTokenAccountBalance(tokenAccount)).value.uiAmount!);
    } catch (e) {
      return new BigNumber(0);
    }
  }

  private async swapNonUsdcInTokenAccounts() {
    const debug = getDebugLogger("swap-non-usdc-in-token-accounts");
    debug("Swapping any remaining non-usdc to usdc");
    const banks = this.group.banks.values();
    for (let bankInterEntry = banks.next(); !bankInterEntry.done; bankInterEntry = banks.next()) {
      const bank = bankInterEntry.value;
      if (bank.mint.equals(USDC_MINT)) {
        continue;
      }

      let amount = await this.getTokenAccountBalance(bank.mint);

      if (amount.eq(0)) {
        continue;
      }

      const balance = this.account.getBalance(bank.publicKey);
      const { liabilities } = balance.getQuantityUi(bank);

      if (liabilities.gt(0)) {
        debug("Account has %d liabilities in %s", liabilities, bank.label);
        const depositAmount = BigNumber.min(amount, liabilities);

        debug("Paying off %d %s liabilities", depositAmount, bank.label);
        await this.account.repay(depositAmount, bank, amount.gte(liabilities));

        amount = await this.getTokenAccountBalance(bank.mint);
      }

      if (bank.mint.equals(WRAPPED_SOL_MINT)) {
        debug("Unwrapping remaining %s SOL", amount);
        const ata = await associatedAddress({ mint: WRAPPED_SOL_MINT, owner: this.wallet.publicKey });
        const ix = Token.createCloseAccountInstruction(
          TOKEN_PROGRAM_ID,
          ata,
          this.wallet.publicKey,
          this.wallet.publicKey,
          []
        );

        const sig = await this.client.processTransaction(new Transaction().add(ix), [this.wallet.payer]);
        debug("Unwrap tx: %s", sig);
      }

      debug("Swapping %d %s to USDC", amount, bank.label);

      await this.orcaTrader.trade(bank.mint, USDC_MINT, amount);
    }

    const usdcBalance = await this.getTokenAccountBalance(USDC_MINT);

    if (usdcBalance.eq(0)) {
      debug("No USDC to deposit");
      return;
    }

    debug("Depositing %d USDC", usdcBalance);

    const tx = await this.account.deposit(usdcBalance, this.group.getBankByMint(USDC_MINT)!);

    debug("Deposit tx: %s", tx);
  }

  private async needsToBeRebalanced(): Promise<boolean> {
    const debug = getDebugLogger("rebalance-check");

    debug("Checking if liquidator needs to be rebalanced");
    await this.group.reload();
    await this.account.reload();

    const lendingAccountToRebalance = this.account.activeBalances
      .map((lendingAccount) => {
        const bank = this.group.getBankByPk(lendingAccount.bankPk)!;
        const { assets, liabilities } = lendingAccount.getQuantity(bank);

        return { bank, assets, liabilities };
      })
      .filter(({ bank, assets, liabilities }) => {
        return (assets.gt(DUST_THRESHOLD) && !bank.mint.equals(USDC_MINT)) || liabilities.gt(DUST_THRESHOLD);
      });

    const lendingAccountToRebalanceExists = lendingAccountToRebalance.length > 0;
    debug("Liquidator account needs to be rebalanced: %s", lendingAccountToRebalanceExists ? "true" : "false");

    if (lendingAccountToRebalanceExists) {
      debug("Lending accounts to rebalance:");
      lendingAccountToRebalance.forEach(({ bank, assets, liabilities }) => {
        debug(`Bank: ${bank.label}, Assets: ${assets}, Liabilities: ${liabilities}`);
      });
    }

    return lendingAccountToRebalanceExists;
  }

  private async liquidationStage() {
    const debug = getDebugLogger("liquidation-stage");
    debug("Started liquidation stage");
    const addresses = await this.client.getAllMarginfiAccountAddresses();
    debug("Found %s accounts", addresses.length);

    for (let i = 0; i < addresses.length; i++) {
      const liquidatedAccount = await this.processAccount(addresses[i]);

      debug("Account %s liquidated: %s, Sleeping for %s", addresses[i], liquidatedAccount, SLEEP_INTERVAL);
      await sleep(SLEEP_INTERVAL);

      if (liquidatedAccount) {
        debug("Account liquidated, stopping to rebalance");
        break;
      }
    }
  }

  private async processAccount(account: PublicKey): Promise<boolean> {
    const client = this.client;
    const group = this.group;
    const liquidatorAccount = this.account;

    const debug = getDebugLogger(`process-account:${account.toBase58()}`);

    debug("Processing account %s", account);
    const marginfiAccount = await MarginfiAccount.fetch(account, client);
    if (marginfiAccount.canBeLiquidated()) {
      const { assets, liabilities } = marginfiAccount.getHealthComponents(MarginRequirementType.Maint);

      const maxLiabilityPaydown = liabilities.minus(assets);
      debug("Account can be liquidated, max liability paydown: %d", maxLiabilityPaydown);
    } else {
      debug("Account cannot be liquidated");
      return false;
    }

    if (!marginfiAccount.canBeLiquidated()) {
      debug("Account is healthy");
      return false;
    }

    let maxLiabilityPaydownUsdValue = new BigNumber(0);
    let bestLiabAccountIndex = 0;

    // Find the biggest liability account that can be covered by liquidator
    // within the liquidators liquidation capacity
    for (let i = 0; i < marginfiAccount.activeBalances.length; i++) {
      const balance = marginfiAccount.activeBalances[i];
      const bank = group.getBankByPk(balance.bankPk)!;
      const maxLiabCoverage = liquidatorAccount.getMaxBorrowForBank(bank);
      const liquidatorLiabPayoffCapacityUsd = bank.getUsdValue(maxLiabCoverage, PriceBias.None, undefined, false);
      debug("Max borrow for bank: %d ($%d)", maxLiabCoverage, liquidatorLiabPayoffCapacityUsd);
      const { liabilities: liquidateeLiabUsdValue } = balance.getUsdValue(bank, MarginRequirementType.Equity);

      debug("Balance: liab: $%d, max coverage: %d", liquidateeLiabUsdValue, liquidatorLiabPayoffCapacityUsd);

      const liabUsdValue = BigNumber.min(liquidateeLiabUsdValue, liquidatorLiabPayoffCapacityUsd);

      if (liabUsdValue.gt(maxLiabilityPaydownUsdValue)) {
        maxLiabilityPaydownUsdValue = liabUsdValue;
        bestLiabAccountIndex = i;
      }
    }

    debug(
      "Max liability paydown USD value: %d, mint: %s",
      maxLiabilityPaydownUsdValue,
      group.getBankByPk(marginfiAccount.activeBalances[bestLiabAccountIndex].bankPk)!.mint
    );

    let maxCollateralUsd = new BigNumber(0);
    let bestCollateralIndex = 0;

    // Find the biggest collateral account
    for (let i = 0; i < marginfiAccount.activeBalances.length; i++) {
      const balance = marginfiAccount.activeBalances[i];
      const bank = group.getBankByPk(balance.bankPk)!;

      const { assets: collateralUsdValue } = balance.getUsdValue(bank, MarginRequirementType.Equity);
      if (collateralUsdValue.gt(maxCollateralUsd)) {
        maxCollateralUsd = collateralUsdValue;
        bestCollateralIndex = i;
      }
    }

    debug(
      "Max collateral USD value: %d, mint: %s",
      maxCollateralUsd,
      group.getBankByPk(marginfiAccount.activeBalances[bestCollateralIndex].bankPk)!.mint
    );

    // This conversion is ignoring the liquidator discount, but the amounts still in legal bounds, as the liability paydown
    // is discounted meaning, the liquidation won't fail because of a too big paydown.
    const collateralToLiquidateUsdValue = BigNumber.min(maxCollateralUsd, maxLiabilityPaydownUsdValue);

    debug("Collateral to liquidate USD value: %d", collateralToLiquidateUsdValue);

    const collateralBankPk = marginfiAccount.activeBalances[bestCollateralIndex].bankPk;
    const collateralBank = group.getBankByPk(collateralBankPk)!;
    const collateralQuantity = collateralBank.getQuantityFromUsdValue(collateralToLiquidateUsdValue, PriceBias.None);

    const liabBankPk = marginfiAccount.activeBalances[bestLiabAccountIndex].bankPk;
    const liabBank = group.getBankByPk(liabBankPk)!;

    debug("Liquidating %d %s for %s", collateralQuantity, collateralBank.label, liabBank.label);
    const sig = await liquidatorAccount.lendingAccountLiquidate(
      marginfiAccount,
      collateralBank,
      collateralQuantity,
      liabBank
    );
    debug("Liquidation tx: %s", sig);

    return true;
  }
}

async function main() {
  if (!process.env.LIQUIDATOR_PK) {
    throw new Error("LIQUIDATOR_PK not set");
  }

  if (!process.env.KEYPAIR_PATH) {
    throw new Error("KEYPAIR_PATH not set");
  }

  if (!process.env.RPC_ENDPOINT) {
    throw new Error("RPC_ENDPOINT not set");
  }

  const wallet = new NodeWallet(loadKeypair(process.env.KEYPAIR_PATH));
  const connection = new Connection(process.env.RPC_ENDPOINT!, "confirmed");
  const config = getConfig((process.env.MRGN_ENV as Environment) ?? "production");
  const client = await MarginfiClient.fetch(config, wallet, connection);
  const group = await MarginfiGroup.fetch(config, client.program);

  const liquidatorAccount = await MarginfiAccount.fetch(new PublicKey(process.env.LIQUIDATOR_PK!), client);
  const liquidator = new Liquidator(connection, liquidatorAccount, group, client, wallet);

  await liquidator.start();
}

main().catch((e) => console.log(e));

function getDebugLogger(context: string) {
  return require("debug")(`mfi:liquidator:${context}`);
}
