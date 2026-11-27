#!/usr/bin/env python3
"""Exercise deployment, funding, and claiming exclusively on a localhost Anvil fork."""
import json
import subprocess
import time
import urllib.request
from pathlib import Path
from decimal import Decimal

ROOT = Path(__file__).resolve().parents[1]
RPC = "http://127.0.0.1:18545"
OWNER = "0x5e3421f58f1cabd3afddadf05c84f1c37196ed28"
TOKEN = "0x687fe7d7247a63e338ff7d089b9434c155b200d8"
RECIPIENT = "0x1111111111111111111111111111111111111111"
AMOUNT = 10**12

def rpc(method, params):
    req = urllib.request.Request(RPC, data=json.dumps({"jsonrpc": "2.0", "method": method, "params": params, "id": 1}).encode(), headers={"Content-Type": "application/json"})
    with urllib.request.urlopen(req, timeout=45) as response:
        data = json.load(response)
    if "error" in data:
        raise RuntimeError(data["error"])
    return data["result"]

def word(value):
    return hex(value)[2:].rjust(64, "0")

def balance(account):
    return int(rpc("eth_call", [{"to": TOKEN, "data": "0x70a08231" + account[2:].rjust(64, "0")}, "latest"]), 16)

def send(sender, data, to=None):
    tx = {"from": sender, "data": data, "gas": hex(1_000_000), "gasPrice": hex(10**10)}
    if to:
        tx["to"] = to
    estimate = int(rpc("eth_estimateGas", [tx]), 16)
    txhash = rpc("eth_sendTransaction", [tx])
    for _ in range(180):
        receipt = rpc("eth_getTransactionReceipt", [txhash])
        if receipt:
            break
        time.sleep(0.25)
    else:
        raise RuntimeError("Local simulation receipt timed out")
    assert receipt["status"] == "0x1", "Local simulation reverted"
    return receipt, estimate

def main():
    assert "anvil" in rpc("web3_clientVersion", []).lower(), "Requires the disposable localhost Anvil fork"
    assert int(rpc("eth_chainId", []), 16) == 1, "Requires an Ethereum mainnet fork"
    subprocess.run([str(Path.home() / ".foundry/bin/forge"), "build", "--skip", "test"], cwd=ROOT, check=True)
    artifact = json.loads((ROOT / "out/PihAirdrop.sol/PihAirdrop.json").read_text())
    bytecode = "0x" + artifact["bytecode"]["object"].removeprefix("0x")
    actual_eth = int(rpc("eth_getBalance", [OWNER, "latest"]), 16)
    # Artificial balances and impersonation only affect this localhost simulation.
    for account in [OWNER, RECIPIENT]:
        rpc("anvil_impersonateAccount", [account])
        rpc("anvil_setBalance", [account, hex(10**18)])
    deployment, deploy_estimate = send(OWNER, bytecode)
    faucet = deployment["contractAddress"]
    funding, fund_estimate = send(OWNER, "0xa9059cbb" + faucet[2:].rjust(64, "0") + word(10**18), TOKEN)
    assert balance(faucet) == 10**18
    before = balance(RECIPIENT)
    award, claim_estimate = send(RECIPIENT, "0x4e71d92d", faucet)
    assert balance(RECIPIENT) - before == AMOUNT
    assert balance(faucet) == 10**18 - AMOUNT
    claimed_data = "0xc884ef83" + RECIPIENT[2:].rjust(64, "0")
    assert int(rpc("eth_call", [{"to": faucet, "data": claimed_data}, "latest"]), 16) == 1
    try:
        rpc("eth_call", [{"from": RECIPIENT, "to": faucet, "data": "0x4e71d92d"}, "latest"])
    except RuntimeError:
        repeated_reverted = True
    else:
        repeated_reverted = False
    assert repeated_reverted, "Repeat claim must revert"
    estimates = {"deployment": deploy_estimate, "funding": fund_estimate, "recipient_claim": claim_estimate}
    result = {"simulation_only": True, "real_eth_before_simulation": str(Decimal(actual_eth) / 10**18), "funding_pih": "1", "claim_pih": "0.000001", "gas_estimates": estimates, "owner_total_gas": deploy_estimate + fund_estimate, "repeat_claim_reverts": repeated_reverted}
    (ROOT / "simulation-results.json").write_text(json.dumps(result, indent=2) + "\n")
    print(json.dumps(result), flush=True)

if __name__ == "__main__":
    main()
