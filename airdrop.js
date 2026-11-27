export const TOKEN = "0x687fe7d7247a63e338ff7d089b9434c155b200d8";
export const AMOUNT = 1_000_000_000_000n;
export const SELECTOR = Object.freeze({
  claim: "0x4e71d92d", claimed: "0xc884ef83", available: "0xee5e2b8a",
  token: "0x82bfefc8", amount: "0x270ef385",
});
const RPCS = ["https://ethereum-rpc.publicnode.com", "https://eth.llamarpc.com"];
export const isAddress = (value) => /^0x[0-9a-fA-F]{40}$/.test(value || "");
export function claimedData(account) {
  if (!isAddress(account)) throw new Error("Некорректный адрес кошелька.");
  return SELECTOR.claimed + account.slice(2).toLowerCase().padStart(64, "0");
}
export function formatEth(wei) {
  const value = BigInt(wei);
  return `${value / 10n ** 18n}.${(value % 10n ** 18n).toString().padStart(18, "0").slice(0, 10)}`;
}
export function validateConfig(config) {
  if (config.chainId !== "0x1" || config.token?.toLowerCase() !== TOKEN || BigInt(config.claimAmount) !== AMOUNT) {
    throw new Error("Настройки раздачи не соответствуют PIH в Ethereum.");
  }
  if (config.contract !== null && (!isAddress(config.contract) || /^0x0{40}$/i.test(config.contract))) {
    throw new Error("Некорректный адрес контракта раздачи.");
  }
  return config;
}
export function errorMessage(error) {
  if (Number(error?.code) === 4001) return "Действие отменено в кошельке.";
  if (/insufficient funds/i.test(error?.message || "")) return "В кошельке не хватает ETH на газ.";
  return error?.message || "Не удалось выполнить действие. Попробуйте ещё раз.";
}

export async function startAirdrop({ win = window, doc = document, fetcher = fetch, pause = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const el = (id) => doc.getElementById(id);
  const ui = Object.fromEntries(["remaining", "account", "fee", "connect", "claim", "status", "transaction", "contract"].map((key) => [key, el(`airdrop-${key}`)]));
  const wallets = new Map();
  const choice = el("wallet-choice");
  let config, provider, account = null, busy = false, ready = false, generation = 0, pending = null;
  const message = (text) => { ui.status.textContent = text; };
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
    if (provider?.removeListener) {
      provider.removeListener("accountsChanged", accountsChanged);
      provider.removeListener("chainChanged", chainChanged);
    }
    provider = wallet; account = null; generation++;
    ui.claim.disabled = true; ui.account.textContent = "Не подключён";
    if (provider.on) {
      provider.on("accountsChanged", accountsChanged);
      provider.on("chainChanged", chainChanged);
    }
  }
  function accountsChanged(accounts) {
    account = isAddress(accounts[0]) ? accounts[0] : null;
    refresh().catch((error) => message(errorMessage(error)));
  }
  function chainChanged() {
    refresh().catch((error) => message(errorMessage(error)));
  }
  win.addEventListener("eip6963:announceProvider", (event) => {
    const { info, provider: wallet } = event.detail || {};
    if (info?.uuid && wallet?.request) addWallet(info.uuid, info.name || "Кошелёк", wallet);
  });
  win.dispatchEvent(new win.Event("eip6963:requestProvider"));
  if (win.ethereum?.request && wallets.size === 0) addWallet("injected", "Кошелёк браузера", win.ethereum);
  choice.addEventListener("change", () => {
    if (busy) return;
    setProvider(wallets.get(choice.value));
    refresh().catch((error) => message(errorMessage(error)));
  });

  async function read(method, params) {
    let lastError;
    for (const endpoint of RPCS) {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        let response;
        try {
          response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal,
            body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
          if (!response.ok) throw new Error("Не удалось связаться с Ethereum.");
          const json = await response.json();
          if (json.error || !("result" in json)) throw new Error(json.error?.message || "Ошибка ответа Ethereum.");
          return json.result;
        } finally { clearTimeout(timeout); }
      } catch (error) { lastError = error; }
    }
    throw lastError;
  }
  const call = (data) => read("eth_call", [{ to: config.contract, data }, "latest"]);
  async function refresh() {
    const current = ++generation;
    ui.claim.disabled = true;
    ui.account.textContent = account || "Не подключён";
    ui.fee.textContent = "Появится после подключения";
    if (!ready) return;
    const available = BigInt(await call(SELECTOR.available));
    if (current !== generation) return;
    ui.remaining.textContent = `${available.toLocaleString("ru-RU")} получений`;
    ui.connect.disabled = busy || !provider;
    if (!account) {
      message(provider ? "Подключите кошелёк, чтобы получить PIH." : "Откройте страницу в браузере кошелька Ethereum или установите расширение кошелька.");
      return;
    }
    const chain = await provider.request({ method: "eth_chainId" });
    if (current !== generation) return;
    if (BigInt(chain) !== 1n) { message("Переключитесь на Ethereum: нажмите «Подключить кошелёк»."); return; }
    const claimed = BigInt(await call(claimedData(account))) !== 0n;
    if (current !== generation) return;
    if (claimed) { message("Этот адрес уже получил 0,000001 PIH."); return; }
    if (pending?.recipient.toLowerCase() === account.toLowerCase()) {
      const pendingReceipt = await read("eth_getTransactionReceipt", [pending.hash]);
      if (current !== generation) return;
      if (pendingReceipt && BigInt(pendingReceipt.status) === 0n) savePending(null);
      else {
        message("Получение уже отправлено. Проверьте подтверждение по ссылке на транзакцию; повторная отправка отключена.");
        return;
      }
    }
    if (available === 0n) { message("Запас PIH закончился. Получение станет доступно после пополнения."); return; }
    const tx = { from: account, to: config.contract, data: SELECTOR.claim, value: "0x0", chainId: "0x1" };
    const [gas, price, balance] = await Promise.all([
      provider.request({ method: "eth_estimateGas", params: [tx] }),
      provider.request({ method: "eth_gasPrice" }),
      provider.request({ method: "eth_getBalance", params: [account, "latest"] }),
    ]);
    if (current !== generation) return;
    const fee = BigInt(gas) * BigInt(price);
    ui.fee.textContent = `≈ ${formatEth(fee)} ETH; итоговая сумма — в кошельке`;
    if (BigInt(balance) < fee) { message("Нужно пополнить ETH в подключённом кошельке для оплаты газа."); return; }
    ui.claim.disabled = busy;
    if (!busy) message("Готово к получению. Газ оплачивается в ETH; токены PIH бесплатные.");
  }
  async function connect() {
    if (!ready || busy || !provider) return;
    busy = true; ui.connect.disabled = true; ui.claim.disabled = true; choice.disabled = true;
    try {
      const accounts = await provider.request({ method: "eth_requestAccounts" });
      if (!isAddress(accounts[0])) throw new Error("Кошелёк не предоставил адрес.");
      account = accounts[0];
      const chain = await provider.request({ method: "eth_chainId" });
      if (BigInt(chain) !== 1n) await provider.request({ method: "wallet_switchEthereumChain", params: [{ chainId: "0x1" }] });
      busy = false;
      await refresh();
    } catch (error) { message(errorMessage(error)); }
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
      if (BigInt(chain) !== 1n || accounts[0]?.toLowerCase() !== recipient.toLowerCase()) throw new Error("Кошелёк или сеть изменились. Подключите кошелёк заново.");
      if (BigInt(await call(claimedData(recipient))) !== 0n) throw new Error("Этот адрес уже получил PIH.");
      const tx = { from: recipient, to: config.contract, data: SELECTOR.claim, value: "0x0", chainId: "0x1" };
      await provider.request({ method: "eth_estimateGas", params: [tx] });
      message("Подтвердите получение и комиссию в кошельке.");
      const hash = await provider.request({ method: "eth_sendTransaction", params: [tx] });
      if (!/^0x[0-9a-fA-F]{64}$/.test(hash)) throw new Error("Кошелёк вернул некорректный хеш транзакции. Проверьте его историю.");
      savePending({ recipient, hash });
      ui.transaction.href = `https://etherscan.io/tx/${hash}`; ui.transaction.hidden = false;
      message("Транзакция отправлена. Ждём подтверждения Ethereum…");
      let receipt;
      for (let i = 0; i < 120; i++) {
        receipt = await read("eth_getTransactionReceipt", [hash]);
        if (receipt) break;
        await pause(3000);
      }
      if (!receipt) throw new Error("Подтверждение ещё ожидается. Проверьте транзакцию по ссылке; повторно отправлять её не нужно.");
      savePending(null);
      if (BigInt(receipt.status) !== 1n) throw new Error("Транзакция не выполнена. Комиссия сети могла быть списана; проверьте её по ссылке.");
      // Confirm the token award, not merely a successful transaction receipt.
      if (BigInt(await call(claimedData(recipient))) === 0n) throw new Error("Транзакция подтверждена, но выдачу PIH пока не удалось подтвердить. Проверьте ссылку.");
      busy = false; await refresh();
      message(`Получено 0,000001 PIH на ${recipient}.`);
    } catch (error) {
      busy = false;
      try { await refresh(); } catch { /* Retain the original transaction error. */ }
      message(errorMessage(error));
    } finally { busy = false; ui.connect.disabled = false; choice.disabled = false; }
  }
  ui.connect.addEventListener("click", connect);
  ui.claim.addEventListener("click", claim);
  try {
    const response = await fetcher("airdrop-config.json", { cache: "no-store" });
    if (!response.ok) throw new Error("Не удалось загрузить настройки раздачи.");
    config = validateConfig(await response.json());
    if (config.contract === null) {
      ui.remaining.textContent = "Скоро";
      message("Раздача готовится к запуску. Получение пока недоступно.");
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
      throw new Error("Не удалось подтвердить контракт раздачи PIH.");
    }
    ready = true;
    ui.contract.href = `https://etherscan.io/address/${config.contract}`; ui.contract.hidden = false;
    await refresh();
  } catch (error) {
    ready = false; ui.connect.disabled = true; ui.claim.disabled = true;
    ui.remaining.textContent = "Не удалось проверить"; message(errorMessage(error));
  }
  return { connect, claim, refresh };
}

if (typeof window !== "undefined" && typeof document !== "undefined") {
  startAirdrop().catch((error) => {
    document.getElementById("airdrop-status").textContent = errorMessage(error);
  });
}
