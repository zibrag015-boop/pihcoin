import { t, getLocale } from "./i18n.js";

class UiError extends Error {
  constructor(key) { super(key); this.uiKey = key; }
}

export const TOKEN = "0x687fe7d7247a63e338ff7d089b9434c155b200d8";
export const AMOUNT = 1_000_000_000_000n;
export const SELECTOR = Object.freeze({
  claim: "0x4e71d92d", claimed: "0xc884ef83", available: "0xee5e2b8a",
  token: "0x82bfefc8", amount: "0x270ef385",
});
const RPC = "https://ethereum-rpc.publicnode.com";
export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value || "");
export function claimedData(account) {
  if (!isAddress(account)) throw new UiError("invalidAddress");
  return SELECTOR.claimed + account.slice(2).toLowerCase().padStart(64, "0");
}
export function formatEth(wei) {
  const value = BigInt(wei);
  const amount = `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, "0").slice(0, 10)}`;
  return getLocale().startsWith("ru") ? amount.replace(".", ",") : amount;
}
export function validateConfig(config) {
  if (config.chainId !== "0x1" || config.token?.toLowerCase() !== TOKEN || BigInt(config.claimAmount) !== AMOUNT) {
    throw new UiError("invalidConfig");
  }
  if (config.contract !== null && (!isAddress(config.contract) || /^0x0{40}$/i.test(config.contract))) {
    throw new UiError("invalidContract");
  }
  return config;
}
export function errorMessage(error) {
  if (error instanceof UiError) return t(error.uiKey);
  if (Number(error?.code) === 4001) return t("canceled");
  if (/insufficient funds/i.test(error?.message || "")) return t("insufficientGas");
  return t("genericError");
}

export async function startAirdrop({ win = window, doc = document, fetcher = fetch, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const el = (id) => doc.getElementById(id);
  const ui = Object.fromEntries(["remaining", "account", "fee", "connect", "claim", "status", "transaction", "contract"].map((key) => [key, el(`airdrop-${key}`)]));
  const wallets = new Map();
  const choice = el("wallet-choice");
  let config, provider, account = null, busy = false, ready = false, generation = 0, pending = null;
  let lastStatus = { key: "loadingAirdrop", values: {} }, lastError = null, lastAvailable = null, lastFee = null;
  const message = (key, values = {}) => { lastError = null; lastStatus = { key, values }; ui.status.textContent = t(key, values); };
  const showError = (error) => { lastError = error; ui.status.textContent = errorMessage(error); };
  function renderLanguage() {
    ui.status.textContent = lastError ? errorMessage(lastError) : t(lastStatus.key, lastStatus.values);
    ui.account.textContent = account || t("notConnected");
    if (lastAvailable !== null) ui.remaining.textContent = t("claimsCount", { count: lastAvailable.toLocaleString(getLocale()) });
    else if (config?.contract === null) ui.remaining.textContent = t("soon");
    else if (lastError && !ready) ui.remaining.textContent = t("unableToCheck");
    ui.fee.textContent = lastFee === null ? t("feeAfterConnect") : t("feeEstimate", { fee: formatEth(lastFee) });
  }
  win.addEventListener("pih-language-change", renderLanguage);
  const pendingKey = () => `pih-airdrop-pending:${config.contract.toLowerCase()}`;
  function savePending(value) {
    pending = value;
    try {
      if (value) win.sessionStorage?.setItem(pendingKey(), JSON.stringify(value));
      else win.sessionStorage?.removeItem(pendingKey());
    } catch { /* Wallet access remains available when browser storage is disabled. */ }
  }
  function addWallet(id, name, wallet) {
    if (wallets.has(id)) return;
    wallets.set(id, wallet);
    const option = doc.createElement("option"); option.value = id; option.textContent = name;
    choice.append(option);
    choice.hidden = el("wallet-choice-label").hidden = wallets.size < 2;
    if (!provider) setProvider(wallet);
    if (ready) ui.connect.disabled = busy;
  }
  function setProvider(wallet) {
    if (typeof provider?.removeListener === "function") {
      provider.removeListener("accountsChanged", accountsChanged);
      provider.removeListener("chainChanged", chainChanged);
    }
    provider = wallet; account = null; generation++;
    ui.claim.disabled = true; ui.account.textContent = t("notConnected");
    if (typeof provider.on === "function") {
      provider.on("accountsChanged", accountsChanged);
      provider.on("chainChanged", chainChanged);
    }
  }
  function accountsChanged(accounts) {
    account = isAddress(accounts[0]) ? accounts[0] : null;
    refresh().catch((error) => showError(error));
  }
  function chainChanged() {
    refresh().catch((error) => showError(error));
  }
  win.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider: wallet } = event.detail || {};
    if (typeof info?.uuid === "string" && typeof wallet?.request === "function") addWallet(info.uuid, typeof info.name === "string" ? info.name.slice(0, 80) : t("walletDefault"), wallet);
  });
  win.dispatchEvent(new win.Event("eip6963:requestProvider"));
  if (typeof win.ethereum?.request === "function" && wallets.size === 0) addWallet("injected", t("browserWallet"), win.ethereum);
  choice.addEventListener("change", () => {
    if (busy) return;
    setProvider(wallets.get(choice.value));
    refresh().catch((error) => showError(error));
  });

  async function read(method, params) {
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = RPC;
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
          response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          if (!response.ok) throw new UiError("rpcError");
          const json = await response.json();
          if (json.error || !("result" in json)) throw new UiError("rpcError");
          return json.result;
        } finally { clearTimeout(timeout); }
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw lastError;
  }
  const call = (data) => read("eth_call", [{ to: config.contract, data }, "latest"]);
  async function refresh() {
    const current = ++generation;
    ui.claim.disabled = true;
    ui.account.textContent = account || t("notConnected");
    lastFee = null; ui.fee.textContent = t("feeAfterConnect");
    if (!ready) return;
    const available = BigInt(await call(SELECTOR.available));
    if (current !== generation) return;
    lastAvailable = available; ui.remaining.textContent = t("claimsCount", { count: available.toLocaleString(getLocale()) });
    ui.connect.disabled = busy || !provider;
    if (!account) {
      message(provider ? "connectHint" : "noWallet");
      return;
    }
    const chain = await provider.request({ method: "eth_chainId" });
    if (current !== generation) return;
    if (BigInt(chain) !== 1n) { message("wrongNetwork"); return; }
    const claimed = BigInt(await call(claimedData(account))) !== 0n;
    if (current !== generation) return;
    if (claimed) { message("alreadyClaimed"); return; }
    if (pending?.recipient.toLowerCase() === account.toLowerCase()) {
      const pendingReceipt = await read("eth_getTransactionReceipt", [pending.hash]);
      if (current !== generation) return;
      if (pendingReceipt && BigInt(pendingReceipt.status) === 0n) savePending(null);
      else {
        message("pendingClaim");
        return;
      }
    }
    if (available === 0n) { message("empty"); return; }
    const tx = { from: account, to: config.contract, data: SELECTOR.claim, value: "0x0", chainId: "0x1" };
    const [gas, price, balance] = await Promise.all([
      provider.request({ method: "eth_estimateGas", params: [tx] }),
      provider.request({ method: "eth_gasPrice" }),
      provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    ]);
    if (current !== generation) return;
    const fee = BigInt(gas) * BigInt(price);
    lastFee = fee; ui.fee.textContent = t("feeEstimate", { fee: formatEth(fee) });
    if (BigInt(balance) < fee) { message("topUpGas"); return; }
    ui.claim.disabled = busy;
    if (!busy) message("ready");
  }
  async function connect() {
    if (!ready || busy || !provider) return;
    busy = true; ui.connect.disabled = true; ui.claim.disabled = true; choice.disabled = true;
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!isAddress(accounts[0])) throw new UiError("noAccount");
      account = accounts[0];
      const chain = await provider.request({ method: "eth_chainId" });
      if (BigInt(chain) !== 1n) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
      busy = false;
      await refresh();
    } catch (error) { showError(error); }
    finally { busy = false; ui.connect.disabled = false; choice.disabled = false; }
  }
  async function claim() {
    if (!ready || busy || !provider || !account || ui.claim.disabled) return;
    busy = true; ui.connect.disabled = true; ui.claim.disabled = true; choice.disabled = true;
    const recipient = account;
    try {
      const [accounts, chain] = await Promise.all([
        provider.request({ method: "eth_accounts" }), provider.request({ method: "eth_chainId" }),
      ]);
      if (BigInt(chain) !== 1n || accounts[0]?.toLowerCase() !== recipient.toLowerCase()) throw new UiError("accountChanged");
      if (BigInt(await call(claimedData(recipient))) !== 0n) throw new UiError("alreadyClaimed");
      const tx = { from: recipient, to: config.contract, data: SELECTOR.claim, value: "0x0", chainId: "0x1" };
      await provider.request({ method: "eth_estimateGas", params: [tx] });
      message("confirmWallet");
      const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new UiError("invalidHash");
      savePending({ recipient, hash });
      ui.transaction.href = `https://etherscan.io/tx/${hash}`; ui.transaction.hidden = false;
      message("pending");
      let receipt;
      for (let i = 0; i < 120; i++) {
        receipt = await read("eth_getTransactionReceipt", [hash]);
        if (receipt) break;
        await pause(3000);
      }
      if (!receipt) throw new UiError("pendingTimeout");
      savePending(null);
      if (BigInt(receipt.status) !== 1n) throw new UiError("reverted");
      // Confirm the token award, not merely a successful transaction receipt.
      if (BigInt(await call(claimedData(recipient))) === 0n) throw new UiError("unconfirmedAward");
      busy = false; await refresh();
      message("success", { recipient });
    } catch (error) {
      busy = false;
      try { await refresh(); } catch { /* Retain the original transaction error. */ }
      showError(error);
    } finally { busy = false; ui.connect.disabled = false; choice.disabled = false; }
  }
  ui.connect.addEventListener("click", connect);
  ui.claim.addEventListener("click", claim);
  try {
    const response = await fetcher("airdrop-config.json", { cache: "no-store" });
    if (!response.ok) throw new UiError("configError");
    config = validateConfig(await response.json());
    if (config.contract === null) {
      ui.remaining.textContent = t("soon");
      message("preparing");
      return { connect, claim, refresh };
    }
    try {
      const stored = JSON.parse(win.sessionStorage?.getItem(pendingKey()) || "null");
      if (isAddress(stored?.recipient) && /^0x[0-9a-fA-F]{64}$/.test(stored?.hash || "")) {
        pending = stored;
        ui.transaction.href = `https://etherscan.io/tx/${stored.hash}`;
        ui.transaction.hidden = false;
      }
    } catch { /* Ignore missing or invalid browser storage. */ }
    const [code, token, amount] = await Promise.all([
      read("eth_getCode", [config.contract, "latest"]), call(SELECTOR.token), call(SELECTOR.amount),
    ]);
    if (code === "0x" || code === "0x0" || token.slice(-40).toLowerCase() !== TOKEN.slice(2) || BigInt(amount) !== AMOUNT) {
      throw new UiError("contractMismatch");
    }
    ready = true;
    ui.contract.href = `https://etherscan.io/address/${config.contract}`; ui.contract.hidden = false;
    await refresh();
  } catch (error) {
    ready = false; ui.connect.disabled = true; ui.claim.disabled = true;
    ui.remaining.textContent = t("unableToCheck"); showError(error);
  }
  return { connect, claim, refresh };
}
