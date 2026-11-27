import { TOKEN, AMOUNT, SELECTOR, isAddress } from "./airdrop.js?v=philosophy-2";
import { t, getLocale } from "./i18n.js";

export const CLAIM_TOPIC = "0xd8138f8a3f377c5259ca548e70e4c2de94f129f5a11036a15b69513cba2b426a";
export const AIRDROP = "0x8f06c8dcf69b8b66da126612b0bc1a44cc94cb51";
const RPC = "https://ethereum-rpc.publicnode.com";
const hex = (number) => `0x${number.toString(16)}`;
const uint = (word) => {
  if (!/^0x[0-9a-f]{64}$/i.test(word || "")) throw new Error("Invalid ABI integer");
  return BigInt(word);
};
export function formatPih(amount, locale = getLocale()) {
  const value = BigInt(amount);
  const whole = (value / 10n ** 18n).toLocaleString(locale);
  const fraction = (value % 10n ** 18n).toString().padStart(18, "0").replace(/0+$/, "");
  return fraction ? `${whole}${locale.startsWith("ru") ? "," : "."}${fraction}` : whole;
}
export function summarizeClaims(logs, address, fromBlock, toBlock) {
  const recipients = new Set(), seen = new Set();
  let distributed = 0n;
  for (const log of logs) {
    if (log.removed) continue;
    if (log.address?.toLowerCase() !== address.toLowerCase() || log.topics?.length !== 2 || log.topics[0] !== CLAIM_TOPIC || !/^0x0{24}[0-9a-f]{40}$/i.test(log.topics[1])) throw new Error("Invalid claim event");
    const block = Number(BigInt(log.blockNumber));
    if (block < fromBlock || block > toBlock || !/^0x[0-9a-f]{64}$/i.test(log.transactionHash) || !/^0x[0-9a-f]+$/i.test(log.logIndex)) throw new Error("Invalid log provenance");
    const key = `${log.transactionHash.toLowerCase()}:${BigInt(log.logIndex)}`;
    if (seen.has(key)) continue;
    const amount = uint(log.data);
    if (amount !== AMOUNT) throw new Error("Unexpected claim amount");
    const recipient = log.topics[1].slice(-40).toLowerCase();
    if (recipients.has(recipient)) throw new Error("Duplicate recipient event");
    seen.add(key); recipients.add(recipient); distributed += amount;
  }
  return { claimed: recipients.size, distributed };
}
export function createStatsReader(fetcher = fetch) {
  let cached = null;
  async function request(endpoint, method, params) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12000);
    try {
      const response = await fetcher(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, signal: controller.signal, body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }) });
      if (!response.ok) throw new Error("RPC unavailable");
      const data = await response.json();
      if (data.error || !("result" in data)) throw new Error("RPC error");
      return data.result;
    } finally { clearTimeout(timeout); }
  }
  return async function load(config) {
    if (!isAddress(config.contract) || config.contract.toLowerCase() !== AIRDROP || config.token.toLowerCase() !== TOKEN || config.chainId !== "0x1" || !Number.isSafeInteger(config.deploymentBlock) || config.deploymentBlock < 1) throw new Error("Invalid statistics configuration");
    let lastError;
    for (let attempt = 0; attempt < 2; attempt++) {
      const endpoint = RPC;
      const rpc = (method, params) => request(endpoint, method, params);
      try {
        if (BigInt(await rpc("eth_chainId", [])) !== 1n) throw new Error("Wrong statistics chain");
        const latest = await rpc("eth_getBlockByNumber", ["latest", false]);
        const block = Number(BigInt(latest.number)) - 2;
        if (!Number.isSafeInteger(block) || block < config.deploymentBlock) throw new Error("No confirmed deployment block");
        const tag = hex(block);
        const snapshot = await rpc("eth_getBlockByNumber", [tag, false]);
        if (!snapshot || !/^0x[0-9a-f]{64}$/i.test(snapshot.hash) || Number(BigInt(snapshot.number)) !== block) throw new Error("Invalid block snapshot");
        let logs = [], start = config.deploymentBlock;
        if (cached?.address === config.contract.toLowerCase() && cached.block <= block) {
          const anchor = await rpc("eth_getBlockByNumber", [hex(cached.block), false]);
          if (anchor?.hash === cached.hash) { logs = [...cached.logs]; start = cached.block + 1; }
        }
        for (let from = start; from <= block; from += 1000) {
          const batch = await rpc("eth_getLogs", [{ address: config.contract, topics: [CLAIM_TOPIC], fromBlock: hex(from), toBlock: hex(Math.min(from + 999, block)) }]);
          if (!Array.isArray(batch)) throw new Error("Invalid logs response");
          logs.push(...batch);
        }
        const call = (to, data) => rpc("eth_call", [{ to, data }, tag]);
        const [balance, available, token, amount] = await Promise.all([
          call(TOKEN, "0x70a08231" + config.contract.slice(2).toLowerCase().padStart(64, "0")),
          call(config.contract, SELECTOR.available), call(config.contract, SELECTOR.token), call(config.contract, SELECTOR.amount),
        ]);
        if (token.slice(-40).toLowerCase() !== TOKEN.slice(2) || uint(amount) !== AMOUNT || uint(available) !== uint(balance) / AMOUNT) throw new Error("Contract statistics mismatch");
        // Pin all values and logs to one canonical block, including across reorgs.
        const canonical = await rpc("eth_getBlockByNumber", [tag, false]);
        if (canonical?.hash !== snapshot.hash) throw new Error("Block changed while loading");
        const totals = summarizeClaims(logs, config.contract, config.deploymentBlock, block);
        cached = { address: config.contract.toLowerCase(), block, hash: snapshot.hash, logs };
        return { ...totals, remaining: uint(balance), available: uint(available), block, blockHash: snapshot.hash, checkedAt: Date.now(), endpoint };
      } catch (error) {
        lastError = error;
        if (attempt === 0) await new Promise((resolve) => setTimeout(resolve, 500));
      }
    }
    throw lastError;
  };
}

export async function startStats({ win = window, doc = document, fetcher = fetch } = {}) {
  const status = doc.getElementById("stats-status"), refresh = doc.getElementById("stats-refresh");
  const load = createStatsReader(fetcher);
  let config, snapshot = null, failed = false, busy = false;
  function render() {
    if (snapshot) {
      for (const [key, value] of Object.entries({ claimed: BigInt(snapshot.claimed).toLocaleString(getLocale()), distributed: formatPih(snapshot.distributed), remaining: formatPih(snapshot.remaining), available: snapshot.available.toLocaleString(getLocale()) })) doc.getElementById(`stats-${key}`).textContent = value;
      status.textContent = t(failed ? "statsStale" : "statsSnapshot", { block: snapshot.block.toLocaleString(getLocale()), time: new Date(snapshot.checkedAt).toLocaleString(getLocale(), { dateStyle: "medium", timeStyle: "short" }) });
    } else status.textContent = t(failed ? "statsError" : "statsLoading");
  }
  async function update() {
    if (busy) return;
    busy = true; refresh.disabled = true;
    try {
      if (!config) {
        const response = await fetcher("airdrop-config.json", { cache: "no-store" });
        if (!response.ok) throw new Error("Configuration unavailable");
        config = await response.json();
      }
      snapshot = await load(config); failed = false;
    } catch { failed = true; }
    finally { busy = false; refresh.disabled = false; render(); }
  }
  refresh.addEventListener("click", update);
  win.addEventListener("pih-language-change", render);
  const timer = win.setInterval(() => { if (doc.visibilityState !== "hidden") update(); }, 60000);
  win.addEventListener("pagehide", () => win.clearInterval(timer), { once: true });
  await update();
  return { update };
}
